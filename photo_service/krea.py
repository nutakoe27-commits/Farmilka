"""LUSTIFY Krea 2 Turbo, text-to-image through the private sd.cpp server."""
import json
import re
from pathlib import Path

from .qwen_bundle import SDCPP_REVISION, check_format, file_hash, safe_path
from .qwen_gguf import QwenGGUFEngine

MODEL_ID = 573152
VERSION_ID = 3112728
FILE_ID = 2997637  # Turbo FP8, confirmed by Civitai API and model page
DIFFUSION_SHA256 = "94d92700fc45200ef053895ec5655d4f64a69b924c1efaa457521dfc22bd5e00"
REPOS = {"text_encoder": "Comfy-Org/Krea-2", "vae": "Comfy-Org/Wan_2.1_ComfyUI_repackaged"}
FILENAMES = {"text_encoder": "text_encoders/qwen3vl_4b_fp8_scaled.safetensors",
             "vae": "split_files/vae/wan_2.1_vae.safetensors"}
ROLES = ("diffusion", "text_encoder", "vae")


def validate_plan(plan):
    if plan.get("schema") != 1 or plan.get("model_id") != MODEL_ID or plan.get("version_id") != VERSION_ID:
        raise RuntimeError("Unexpected LUSTIFY Krea bundle")
    if plan.get("sdcpp_revision") != SDCPP_REVISION or set(plan.get("components", {})) != set(ROLES):
        raise RuntimeError("Incomplete Krea bundle or wrong backend revision")
    for role in ROLES:
        item = plan["components"][role]
        if not re.fullmatch(r"[0-9a-f]{64}", item.get("sha256", "")):
            raise RuntimeError("Missing component checksum")
        if not isinstance(item.get("bytes"), int) or item["bytes"] <= 0:
            raise RuntimeError("Invalid component size")
        if not str(item.get("path", "")).startswith(role + "/"):
            raise RuntimeError("Invalid component path")
        safe_path(Path("/tmp/krea-path-check"), item["path"])
        if role == "diffusion":
            if item.get("file_id") != FILE_ID or item["sha256"] != DIFFUSION_SHA256:
                raise RuntimeError("Unexpected LUSTIFY Turbo FP8 file")
        elif (item.get("repo_id") != REPOS[role] or item.get("filename") != FILENAMES[role]
              or not re.fullmatch(r"[0-9a-f]{40}", item.get("revision", ""))):
            raise RuntimeError(f"Unexpected source for {role}")


def read_bundle(directory, *, verify=False):
    path = directory / "bundle.json"
    if not path.is_file():
        raise RuntimeError("LUSTIFY Krea bundle is missing")
    plan = json.loads(path.read_text())
    validate_plan(plan)
    for role in ROLES:
        item = plan["components"][role]
        component = safe_path(directory, item["path"])
        if not component.is_file() or component.stat().st_size != item["bytes"]:
            raise RuntimeError(f"Missing or incomplete {role}")
        check_format(component)
        if verify and file_hash(component) != item["sha256"]:
            raise RuntimeError(f"Checksum mismatch for {role}")
    return plan


def server_command(settings, plan):
    paths = {r: str(safe_path(settings.krea_model_dir, plan["components"][r]["path"])) for r in ROLES}
    return [str(settings.qwen_server_binary), "--diffusion-model", paths["diffusion"],
            "--llm", paths["text_encoder"], "--vae", paths["vae"], "--backend", "cuda0",
            "--offload-to-cpu", "--vae-tiling", "--flash-attn", "on", "--steps", "8",
            "--cfg-scale", "1.0", "--sampling-method", "euler", "--listen-ip", "127.0.0.1",
            "--listen-port", str(settings.qwen_backend_port), "--log-level", "error",
            "--disable-image-metadata"]


def generation_payload(job, reference):
    if reference is not None:
        raise ValueError("LUSTIFY Krea text mode does not support reference images")
    return {"prompt": job["prompt"], "width": job["width"], "height": job["height"],
            "seed": job["seed"], "batch_count": 1, "embed_image_metadata": False,
            "output_format": "png", "sample_params": {"sample_method": "euler", "sample_steps": 8,
                "guidance": {"txt_cfg": 1.0}}}


class KreaEngine(QwenGGUFEngine):
    backend_label = "LUSTIFY Krea"
    ready_message = "LUSTIFY Krea backend loaded all three pinned components"

    def load_bundle(self):
        return read_bundle(self.settings.krea_model_dir)

    def make_server_command(self):
        return server_command(self.settings, self.bundle)

    def make_generation_payload(self, job, reference):
        return generation_payload(job, reference)
