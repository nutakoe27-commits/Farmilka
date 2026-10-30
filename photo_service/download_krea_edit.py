"""Download the pinned Krea identity edit adapter without touching existing weights."""
import argparse
import json
import os
import shutil
from pathlib import Path

from .krea_edit import BYTES, FILENAME, REPO, REVISION, SHA256, manifest, read_edit_bundle
from .qwen_bundle import check_format, file_hash


def download(target: Path, hf_download):
    target.mkdir(parents=True, exist_ok=True)
    destination = target / "lora" / FILENAME
    if shutil.disk_usage(target).free < BYTES + 2 * 1024**3:
        raise RuntimeError("Not enough disk space for the edit adapter")
    (target / "bundle.json").unlink(missing_ok=True)
    hf_download(repo_id=REPO, filename=FILENAME, revision=REVISION,
                token=False, local_dir=target / "lora")
    if not destination.is_file() or destination.stat().st_size != BYTES or file_hash(destination) != SHA256:
        raise RuntimeError("Edit adapter size or SHA256 mismatch")
    check_format(destination)
    temporary = target / "bundle.json.tmp"
    temporary.write_text(json.dumps(manifest(), indent=2) + "\n")
    temporary.replace(target / "bundle.json")
    read_edit_bundle(target)
    print("Krea edit adapter SHA256: PASS; GPU edit generation has not been tested")


def main():
    from huggingface_hub import hf_hub_download

    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    target = Path(os.environ.get("KREA_EDIT_DIR", "models/lustify-krea-edit"))
    if args.verify or (target / "bundle.json").is_file():
        read_edit_bundle(target, verify=True)
        print("Krea edit adapter SHA256: PASS")
        return
    download(target, hf_hub_download)


if __name__ == "__main__":
    main()
