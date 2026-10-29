"""Model identities and cache validation; no GPU dependencies required."""
import json
from pathlib import Path

KLEIN_REPO = "black-forest-labs/FLUX.2-klein-4B"
FLUX1_REPO = "black-forest-labs/FLUX.1-dev"
HEARTSYNC_REPO = "Heartsync/Flux-NSFW-uncensored"
HEARTSYNC_REVISION = "328160f16bc4072cf2bb7ee162d77f3b9b5f786c"
LORA_FILENAME = "lora.safetensors"
KLEIN_PATTERNS = ["model_index.json", "scheduler/*", "tokenizer/*", "text_encoder/*",
                  "transformer/*", "vae/*", "LICENSE*", "README.md"]
FLUX1_PATTERNS = [*KLEIN_PATTERNS, "tokenizer_2/*", "text_encoder_2/*"]
LORA_PATTERNS = [LORA_FILENAME, "README.md", "LICENSE*"]
IGNORE_PATTERNS = ["*.bin", "*.pt", "*.pth", "*.ckpt", "*.onnx", "*.msgpack", "*.h5"]


def read_manifest(directory: Path, repo_id: str, *, marker="model_index.json") -> dict:
    path = directory / "download-manifest.json"
    if not path.is_file():
        raise RuntimeError(f"Missing model manifest in {directory}; run the model downloader")
    manifest = json.loads(path.read_text())
    if manifest.get("repo_id") != repo_id:
        raise RuntimeError(f"Model directory does not contain {repo_id}")
    if not (directory / marker).is_file():
        raise RuntimeError(f"Missing {marker} in {directory}; repair the pinned download")
    return manifest
