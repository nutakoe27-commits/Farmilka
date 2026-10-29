"""Download model files at immutable revisions without printing credentials."""
import argparse
import fnmatch
import json
import os
import shutil
from pathlib import Path

from .model_files import (
    FLUX1_PATTERNS, FLUX1_REPO, HEARTSYNC_REPO, HEARTSYNC_REVISION,
    IGNORE_PATTERNS, KLEIN_PATTERNS, KLEIN_REPO, LORA_FILENAME, LORA_PATTERNS,
)


def download_snapshot(api, downloader, repo_id, target: Path, patterns, *,
                      revision=None, refresh=False, marker="model_index.json"):
    target.mkdir(parents=True, exist_ok=True)
    manifest_path = target / "download-manifest.json"
    previous = json.loads(manifest_path.read_text()) if manifest_path.is_file() else None
    if previous and previous.get("repo_id") != repo_id:
        raise RuntimeError(f"Refusing to overwrite a different model in {target}")
    if previous and not refresh and (revision is None or revision == previous["revision"]):
        if (target / marker).is_file():
            print(f"Using pinned local model: {repo_id}, revision {previous['revision']}")
            return previous
        revision = previous["revision"]
    info = api.model_info(repo_id, revision=revision or "main", files_metadata=True)
    selected = [f for f in info.siblings
                if any(fnmatch.fnmatchcase(f.rfilename, p) for p in patterns)
                and not any(fnmatch.fnmatchcase(f.rfilename, p) for p in IGNORE_PATTERNS)]
    changing_revision = bool(previous and previous.get("revision") != info.sha)
    needed = sum((f.size or 0) for f in selected
                 if changing_revision or not (target / f.rfilename).is_file()
                 or (f.size is not None and (target / f.rfilename).stat().st_size != f.size))
    if shutil.disk_usage(target).free < needed + 2 * 1024**3:
        raise RuntimeError(f"Not enough free disk space for {repo_id}: need about {needed / 1024**3 + 2:.1f} GiB")
    # An interrupted repair or refresh must not leave a false completion marker.
    manifest_path.unlink(missing_ok=True)
    downloader(
        repo_id=repo_id, revision=info.sha, local_dir=target,
        allow_patterns=patterns, ignore_patterns=IGNORE_PATTERNS,
    )
    if not (target / marker).is_file():
        raise RuntimeError(f"Download did not provide {marker}; no completion manifest written")
    manifest = {"repo_id": repo_id, "revision": info.sha}
    temporary = target / "download-manifest.json.tmp"
    temporary.write_text(json.dumps(manifest, indent=2) + "\n")
    temporary.replace(manifest_path)
    print(f"Model cached: {repo_id}, revision {info.sha}")
    return manifest


def main():
    from huggingface_hub import HfApi, snapshot_download

    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["flux", "flux_lora"],
                        default="flux_lora" if os.environ.get("ENGINE") == "flux_lora" else "flux")
    parser.add_argument("--revision", default=None, help="Base model commit SHA or ref")
    parser.add_argument("--lora-revision", default=HEARTSYNC_REVISION)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()
    api = HfApi()  # Reuses HF_TOKEN when supplied; no token file is written.
    if args.engine == "flux":
        download_snapshot(
            api, snapshot_download, KLEIN_REPO,
            Path(os.environ.get("MODEL_DIR", "models/flux2-klein-4b")),
            KLEIN_PATTERNS, revision=args.revision, refresh=args.refresh,
        )
    else:
        download_snapshot(
            api, snapshot_download, FLUX1_REPO,
            Path(os.environ.get("FLUX1_MODEL_DIR", "models/flux1-dev")),
            FLUX1_PATTERNS, revision=args.revision, refresh=args.refresh,
        )
        download_snapshot(
            api, snapshot_download, HEARTSYNC_REPO,
            Path(os.environ.get("HEARTSYNC_LORA_DIR", "models/heartsync-flux1")),
            LORA_PATTERNS, revision=args.lora_revision, refresh=args.refresh, marker=LORA_FILENAME,
        )


if __name__ == "__main__":
    main()
