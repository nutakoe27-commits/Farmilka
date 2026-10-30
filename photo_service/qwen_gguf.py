"""Persistent, private stable-diffusion.cpp backend for AtomicChat Qwen 2.1."""
import atexit
import base64
import io
import logging
import os
import subprocess
import tempfile
import time

import httpx
from PIL import Image

from .qwen_bundle import ROLES, TURBO_SIGMAS, read_bundle, safe_path
from .settings import WorkerSettings

log = logging.getLogger("photo-worker")


class QwenOutOfMemoryError(RuntimeError):
    pass


def generation_payload(job: dict, reference: Image.Image | None) -> dict:
    payload = {
        "prompt": job["prompt"], "width": job["width"], "height": job["height"],
        "seed": job["seed"], "batch_count": 1, "embed_image_metadata": False,
        "output_format": "png",
        "sample_params": {
            "sample_method": "euler", "sample_steps": 8,
            "custom_sigmas": TURBO_SIGMAS,
            "guidance": {"txt_cfg": 1.0},
        },
    }
    if reference is not None:
        buffer = io.BytesIO()
        reference.save(buffer, "PNG")
        payload["ref_images"] = [base64.b64encode(buffer.getvalue()).decode("ascii")]
    return payload


def server_command(settings: WorkerSettings, bundle: dict) -> list[str]:
    paths = {r: str(safe_path(settings.qwen_model_dir, bundle["components"][r]["path"])) for r in ROLES}
    return [
        str(settings.qwen_server_binary),
        "--diffusion-model", paths["diffusion"], "--llm", paths["text_encoder"],
        "--llm_vision", paths["vision"], "--vae", paths["vae"],
        "--backend", "cuda0", "--offload-to-cpu", "--vae-tiling",
        "--flash-attn", "on", "--sigmas", "qwen-image-2.1-turbo",
        "--steps", "8", "--cfg-scale", "1.0", "--sampling-method", "euler",
        "--listen-ip", "127.0.0.1", "--listen-port", str(settings.qwen_backend_port),
        "--log-level", "error", "--disable-image-metadata",
    ]


class QwenGGUFEngine:
    backend_label = "Qwen"
    ready_message = "Qwen backend loaded all four pinned components"

    def load_bundle(self):
        return read_bundle(self.settings.qwen_model_dir)

    def make_server_command(self):
        return server_command(self.settings, self.bundle)

    def make_generation_payload(self, job, reference):
        return generation_payload(job, reference)

    def __init__(self, settings: WorkerSettings):
        self.settings = settings
        self.bundle = self.load_bundle()
        self.process = None
        self.backend_log = None
        self.client = httpx.Client(
            base_url=f"http://127.0.0.1:{settings.qwen_backend_port}",
            timeout=30, trust_env=False,
        )
        atexit.register(self.close)
        try:
            probe = subprocess.run([str(settings.qwen_server_binary), "--list-devices"],
                                   capture_output=True, text=True, timeout=30, check=True)
            if "cuda" not in probe.stdout.lower():
                raise RuntimeError("stable-diffusion.cpp cannot see a CUDA device; run scripts/qwen_probe.py")
            self._start()
        except BaseException:
            self.close()
            raise

    def _start(self):
        if self.process is not None:
            if self.process.poll() is None:
                return
            self._stop_backend()
        # Avoid attaching to another process on the same port and claiming its
        # weights as our model. The backend is never published outside this container.
        try:
            self.client.get("/sdcpp/v1/models/status", timeout=1)
        except httpx.TransportError:
            pass
        else:
            raise RuntimeError(f"{self.backend_label} private backend port is already in use")
        # Keep diagnostic output private; never echo model prompts into
        # the application's normal logs. sd-server runs at error log level.
        self.backend_log = tempfile.TemporaryFile(mode="w+b")
        environment = os.environ.copy()
        for name in ("API_TOKEN", "WORKER_TOKEN", "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "CIVITAI_TOKEN"):
            environment.pop(name, None)
        self.process = subprocess.Popen(
            self.make_server_command(),
            stdin=subprocess.DEVNULL, stdout=self.backend_log, stderr=subprocess.STDOUT,
            env=environment,
        )
        deadline = time.monotonic() + self.settings.qwen_load_timeout
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(f"{self.backend_label} backend exited during model loading; inspect the model diagnostics")
            try:
                response = self.client.get("/sdcpp/v1/models/status", timeout=2)
                if response.is_success and response.json().get("state") == "ready":
                    log.info("%s", self.ready_message)
                    return
            except httpx.TransportError:
                pass
            time.sleep(0.5)
        self._stop_backend()
        raise TimeoutError(f"{self.backend_label} backend did not become ready within QWEN_LOAD_TIMEOUT")

    def _stop_backend(self):
        if self.process is not None:
            if self.process.poll() is None:
                self.process.terminate()
                try:
                    self.process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    self.process.kill()
                    self.process.wait(timeout=10)
            self.process = None
        if self.backend_log is not None:
            self.backend_log.close()
            self.backend_log = None

    def close(self):
        self._stop_backend()
        self.client.close()

    def render(self, job: dict, reference: Image.Image | None) -> Image.Image:
        path = None
        try:
            self._start()
            response = self.client.post("/sdcpp/v1/img_gen", json=self.make_generation_payload(job, reference))
            response.raise_for_status()
            backend_id = response.json()["id"]
            # Use the fixed native route, never a URL returned by the backend.
            if not backend_id or not all(c.isalnum() or c in "_-" for c in backend_id):
                raise RuntimeError(f"Invalid {self.backend_label} backend job ID")
            path = f"/sdcpp/v1/jobs/{backend_id}"
            deadline = time.monotonic() + self.settings.qwen_job_timeout
            while time.monotonic() < deadline:
                if self.process.poll() is not None:
                    raise RuntimeError(f"{self.backend_label} backend exited during generation")
                response = self.client.get(path)
                response.raise_for_status()
                status = response.json()
                if status["status"] == "completed":
                    encoded = status["result"]["images"][0]["b64_json"]
                    if len(encoded) > 16 * 1024 * 1024:
                        raise RuntimeError(f"{self.backend_label} backend returned an oversized image")
                    with Image.open(io.BytesIO(base64.b64decode(encoded, validate=True))) as image:
                        if image.format != "PNG" or image.size != (job["width"], job["height"]):
                            raise RuntimeError(f"{self.backend_label} backend returned unexpected output dimensions or format")
                        return image.convert("RGB")
                if status["status"] in ("failed", "cancelled"):
                    message = str(status.get("error", "")).lower()
                    if "out of memory" in message or "out_of_memory" in message:
                        raise QwenOutOfMemoryError(f"{self.backend_label} CUDA ran out of memory")
                    raise RuntimeError(f"{self.backend_label} backend failed to generate an image")
                time.sleep(1)
            raise TimeoutError(f"{self.backend_label} generation exceeded QWEN_JOB_TIMEOUT")
        except BaseException:
            # A timed-out native job must never keep consuming the GPU after its
            # queue lease is released. The next request starts a fresh backend.
            if path is not None:
                try:
                    self.client.post(path + "/cancel", timeout=2)
                except httpx.HTTPError:
                    pass
            self._stop_backend()
            raise
