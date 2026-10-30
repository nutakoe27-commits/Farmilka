"""LUSTIFY SDXL checkpoint using the shared private stable-diffusion.cpp server."""
import base64
import io
import json
import re
from pathlib import Path

from PIL import Image

from .qwen_bundle import check_format, file_hash, safe_path
from .qwen_gguf import QwenGGUFEngine
from .settings import WorkerSettings

LUSTIFY_MODEL_ID = 573152


def read_lustify_manifest(directory: Path, *, verify=False) -> dict:
    path = directory / "bundle.json"
    if not path.is_file():
        raise RuntimeError("LUSTIFY checkpoint is missing; use the model downloader")
    manifest = json.loads(path.read_text())
    if manifest.get("schema") != 1 or manifest.get("model_id") != LUSTIFY_MODEL_ID:
        raise RuntimeError("The model directory does not contain the selected LUSTIFY checkpoint")
    if not isinstance(manifest.get("version_id"), int) or manifest["version_id"] <= 0:
        raise RuntimeError("LUSTIFY model version is missing")
    if not str(manifest.get("base_model", "")).upper().startswith("SDXL"):
        raise RuntimeError("LUSTIFY model must be a full SDXL checkpoint")
    name = manifest.get("filename", "")
    if not name or name != Path(name).name or Path(name).suffix.lower() != ".safetensors":
        raise RuntimeError("Unexpected checkpoint filename")
    if not re.fullmatch(r"[0-9a-f]{64}", manifest.get("sha256", "")):
        raise RuntimeError("Checkpoint SHA256 is missing")
    checkpoint = safe_path(directory, name)
    if not checkpoint.is_file() or checkpoint.stat().st_size != manifest.get("bytes"):
        raise RuntimeError("LUSTIFY checkpoint is missing or incomplete")
    check_format(checkpoint)
    if verify and file_hash(checkpoint) != manifest["sha256"]:
        raise RuntimeError("LUSTIFY checkpoint checksum mismatch")
    return manifest


def server_command(settings: WorkerSettings, manifest: dict) -> list[str]:
    checkpoint = str(safe_path(settings.lustify_model_dir, manifest["filename"]))
    return [
        str(settings.qwen_server_binary), "--model", checkpoint,
        "--backend", "cuda0", "--offload-to-cpu", "--vae-tiling",
        "--flash-attn", "on", "--steps", str(settings.lustify_steps),
        "--cfg-scale", str(settings.lustify_cfg), "--sampling-method", "euler_a",
        "--scheduler", "discrete", "--listen-ip", "127.0.0.1",
        "--listen-port", str(settings.qwen_backend_port),
        "--log-level", "error", "--disable-image-metadata",
    ]


def generation_payload(settings: WorkerSettings, job: dict, reference: Image.Image | None) -> dict:
    if job["width"] % 64 or job["height"] % 64:
        raise ValueError("SDXL dimensions must be multiples of 64")
    payload = {
        "prompt": job["prompt"], "width": job["width"], "height": job["height"],
        "seed": job["seed"], "batch_count": 1, "embed_image_metadata": False,
        "output_format": "png",
        "sample_params": {
            "scheduler": "discrete", "sample_method": "euler_a",
            "sample_steps": settings.lustify_steps,
            "guidance": {"txt_cfg": settings.lustify_cfg},
        },
    }
    if reference is not None:
        buffer = io.BytesIO()
        reference.save(buffer, "PNG")
        payload["init_image"] = base64.b64encode(buffer.getvalue()).decode("ascii")
        payload["strength"] = settings.lustify_strength
        payload["image_preprocess"] = "target=init,mode=crop-resize,filter=lanczos,antialias=true"
    return payload


class LustifyEngine(QwenGGUFEngine):
    """Same backend lifecycle as Qwen; SDXL has different model and img2img inputs."""

    backend_label = "LUSTIFY"
    ready_message = "LUSTIFY backend loaded its pinned SDXL checkpoint"

    def load_bundle(self):
        return read_lustify_manifest(self.settings.lustify_model_dir)

    def make_server_command(self):
        return server_command(self.settings, self.bundle)

    def make_generation_payload(self, job, reference):
        return generation_payload(self.settings, job, reference)
