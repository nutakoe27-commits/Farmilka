"""Resolve once to an immutable model revision and download standard safetensors."""
import argparse
import json
import os
from pathlib import Path

REPO_ID = "black-forest-labs/FLUX.2-klein-4B"


def main():
    from huggingface_hub import HfApi, snapshot_download

    parser = argparse.ArgumentParser()
    parser.add_argument("--revision", default=None, help="An exact HF commit SHA, or a ref to resolve")
    parser.add_argument("--refresh", action="store_true", help="Resolve a newer revision explicitly")
    args = parser.parse_args()
    target = Path(os.environ.get("MODEL_DIR", "models/flux2-klein-4b"))
    target.mkdir(parents=True, exist_ok=True)
    manifest_path = target / "download-manifest.json"
    previous = json.loads(manifest_path.read_text()) if manifest_path.is_file() else None
    if previous and not args.refresh and args.revision is None:
        if previous.get("repo_id") != REPO_ID:
            raise RuntimeError("Model directory contains a different repository")
        if (target / "model_index.json").is_file():
            print(f"Using pinned local model: {REPO_ID}, revision {previous['revision']}")
            return
        revision = previous["revision"]
    else:
        revision = HfApi().model_info(REPO_ID, revision=args.revision or "main").sha
    # HF uses normal certificate verification and its cache integrity checks.
    # No pickle weights or custom repository Python code are needed.
    snapshot_download(
        repo_id=REPO_ID, revision=revision, local_dir=target,
        allow_patterns=[
            "model_index.json", "scheduler/*", "tokenizer/*", "text_encoder/*",
            "transformer/*", "vae/*", "LICENSE*", "README.md",
        ],
        ignore_patterns=["*.bin", "*.pt", "*.pth", "*.ckpt", "*.onnx", "*.msgpack", "*.h5"],
    )
    manifest = {"repo_id": REPO_ID, "revision": revision}
    temporary = target / "download-manifest.json.tmp"
    temporary.write_text(json.dumps(manifest, indent=2) + "\n")
    temporary.replace(manifest_path)
    print(f"Model cached: {REPO_ID}, revision {revision}")


if __name__ == "__main__":
    main()
