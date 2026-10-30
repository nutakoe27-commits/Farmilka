"""Pinned Qwen 2.1 components. No GPU, Hub client, or remote code imports."""
import hashlib
import json
import re
from pathlib import Path, PurePosixPath

QWEN_REPO = "AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF"
DIFFUSION_REPO = "AtomicChat/Qwen-Image-2.1-Turbo-GGUF"
VAE_REPO = "Comfy-Org/Qwen-Image-2.1"
SDCPP_REVISION = "e239e4b0fd3de49834cec67031a44796ca465abc"
ENDPOINTS = {"pirateface": "https://pirateface.co", "huggingface": "https://huggingface.co"}
ROLES = ("diffusion", "text_encoder", "vision", "vae")
DEFAULT_FILES = {
    "diffusion": "Qwen-Image-2.1-Turbo-AD-Q4_K.gguf",
    "text_encoder": "Qwen-Image-2.1-Turbo-Uncensored-AD-Q4_K.gguf",
    "vision": "mmproj-Qwen-Image-2.1-Turbo-Uncensored-F16.gguf",
    "vae": "qwen_image_2.1_vae_bf16.safetensors",
}
TURBO_SIGMAS = [1.0, 0.978453, 0.95418, 0.926626, 0.89508,
                0.845148, 0.704534, 0.414568, 0.0]


def safe_path(root: Path, relative: str) -> Path:
    name = PurePosixPath(relative)
    if name.is_absolute() or ".." in name.parts or "\\" in relative or not name.parts:
        raise ValueError("Invalid component path")
    result = (root / str(name)).resolve()
    if not result.is_relative_to(root.resolve()):
        raise ValueError("Component path escapes model directory")
    return result


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def check_format(path: Path):
    with path.open("rb") as stream:
        if path.suffix.lower() == ".gguf":
            if stream.read(4) != b"GGUF":
                raise RuntimeError(f"Not a GGUF file: {path.name}")
        elif path.suffix.lower() == ".safetensors":
            length = int.from_bytes(stream.read(8), "little")
            if not 2 <= length <= 16 * 1024 * 1024:
                raise RuntimeError(f"Invalid safetensors header: {path.name}")
            header = json.loads(stream.read(length))
            if not isinstance(header, dict):
                raise RuntimeError("Invalid safetensors header")
        else:
            raise RuntimeError("Only GGUF and safetensors are supported")


def validate_plan(bundle: dict):
    if bundle.get("repo_id") != QWEN_REPO or bundle.get("schema") != 1:
        raise RuntimeError("This is not the requested AtomicChat Qwen 2.1 Turbo bundle")
    if bundle.get("sdcpp_revision") != SDCPP_REVISION:
        raise RuntimeError("Qwen bundle requires another stable-diffusion.cpp revision")
    if set(bundle.get("components", {})) != set(ROLES):
        raise RuntimeError("The Qwen bundle needs exactly four components")
    for role in ROLES:
        item = bundle["components"][role]
        if not re.fullmatch(r"[0-9a-f]{40}", item["revision"]):
            raise RuntimeError("Model revisions must be immutable commit SHAs")
        if item["endpoint"] not in ENDPOINTS.values():
            raise RuntimeError("Unknown model download endpoint")
        expected = {"diffusion": DIFFUSION_REPO, "text_encoder": QWEN_REPO,
                    "vision": QWEN_REPO, "vae": VAE_REPO}
        if item["repo_id"] != expected[role]:
            raise RuntimeError(f"Unexpected repository for Qwen component: {role}")
        if item["path"] != f"{role}/{item['filename']}" or item["bytes"] <= 0:
            raise RuntimeError("Invalid Qwen component path or size")
        safe_path(Path("/tmp/qwen-path-check"), item["path"])


def read_bundle(directory: Path, *, verify=False) -> dict:
    manifest = directory / "bundle.json"
    if not manifest.is_file():
        raise RuntimeError("Qwen bundle is missing; run photo_service.download_qwen first")
    bundle = json.loads(manifest.read_text())
    validate_plan(bundle)
    for role in ROLES:
        item = bundle["components"][role]
        if not re.fullmatch(r"[0-9a-f]{64}", item["sha256"]):
            raise RuntimeError("Model checksum is missing")
        path = safe_path(directory, item["path"])
        if not path.is_file() or path.stat().st_size != item["bytes"]:
            raise RuntimeError(f"Incomplete Qwen component: {role}; repair the download")
        check_format(path)
        if verify and file_hash(path) != item["sha256"]:
            raise RuntimeError(f"Checksum mismatch for Qwen component: {role}")
    return bundle
