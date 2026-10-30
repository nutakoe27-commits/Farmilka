"""Resolve actual filenames, download one quantization, then publish a bundle.

Public repositories are queried anonymously, including PirateFace. HF tokens are
never sent to the third-party site. No Python code from model repos is executed.
"""
import argparse
import json
import os
import re
import shutil
from pathlib import Path, PurePosixPath

from .qwen_bundle import (
    DEFAULT_FILES, DIFFUSION_REPO, ENDPOINTS, QWEN_REPO, ROLES, SDCPP_REVISION, VAE_REPO,
    check_format, file_hash, read_bundle, safe_path, validate_plan,
)


def choose_file(role: str, siblings, explicit=None):
    names = [f.rfilename for f in siblings]
    if explicit:
        if explicit not in names:
            raise RuntimeError(f"Requested {role} file is absent: {explicit}")
        candidates = [explicit]
    else:
        # The publisher recommends AD-Q4_K for its custom per-tensor layout.
        # A generic Q4_K_M is a different quantization, not a silent substitute.
        candidates = [n for n in names if PurePosixPath(n).name == DEFAULT_FILES[role]]
    if len(candidates) != 1:
        raise RuntimeError(f"Cannot uniquely select {role}: {candidates}. "
                           "Inspect the model card and pass an explicit --file option; no substitute model was downloaded")
    name = candidates[0]
    if PurePosixPath(name).suffix.lower() not in (".gguf", ".safetensors"):
        raise RuntimeError("Only data weights in GGUF/safetensors format are allowed")
    safe_path(Path("/tmp/qwen-path-check"), name)
    return next(f for f in siblings if f.rfilename == name)


def resolve_plan(api_factory, source: str, explicit: dict) -> dict:
    repositories = {
        "diffusion": (ENDPOINTS[source], DIFFUSION_REPO),
        "text_encoder": (ENDPOINTS[source], QWEN_REPO),
        "vision": (ENDPOINTS[source], QWEN_REPO),
        "vae": (ENDPOINTS["huggingface"], VAE_REPO),
    }
    infos, components = {}, {}
    for role, (endpoint, repo) in repositories.items():
        key = (endpoint, repo)
        if key not in infos:
            infos[key] = api_factory(endpoint).model_info(repo, files_metadata=True)
        info = infos[key]
        if not re.fullmatch(r"[0-9a-f]{40}", info.sha):
            raise RuntimeError(f"Hub did not return an immutable revision for {repo}")
        file = choose_file(role, info.siblings, explicit.get(role))
        if not file.size or file.size <= 0:
            raise RuntimeError(f"Missing file size: {repo}/{file.rfilename}")
        lfs = getattr(file, "lfs", None)
        upstream_hash = lfs.get("sha256") if isinstance(lfs, dict) else getattr(lfs, "sha256", None)
        card = getattr(info, "card_data", None)
        components[role] = {
            "repo_id": repo, "endpoint": endpoint, "revision": info.sha,
            "filename": file.rfilename, "path": f"{role}/{file.rfilename}",
            "bytes": file.size, "upstream_sha256": upstream_hash,
            "license": card.get("license") if card else None,
        }
    return {"schema": 1, "repo_id": QWEN_REPO, "sdcpp_revision": SDCPP_REVISION,
            "components": components}


def download_bundle(plan: dict, target: Path, downloader):
    validate_plan(plan)
    target.mkdir(parents=True, exist_ok=True)
    needed = 0
    for item in plan["components"].values():
        path = safe_path(target, item["path"])
        if not path.is_file() or path.stat().st_size != item["bytes"]:
            needed += item["bytes"]
    # Leave space for incomplete transfers and API files. Same-sized old files
    # could be a different revision, so also reserve the largest component.
    reserve = max(i["bytes"] for i in plan["components"].values()) + 3 * 1024**3
    if shutil.disk_usage(target).free < needed + reserve:
        raise RuntimeError(f"Not enough free space: need {((needed + reserve) / 1024**3):.1f} GiB")
    (target / "bundle.json").unlink(missing_ok=True)
    (target / "download-plan.json").write_text(json.dumps(plan, indent=2) + "\n")
    for role in ROLES:
        item = plan["components"][role]
        print(f"Downloading {role}: {item['repo_id']}/{item['filename']} @ {item['revision']}", flush=True)
        downloader(repo_id=item["repo_id"], filename=item["filename"],
                   revision=item["revision"], endpoint=item["endpoint"], token=False,
                   local_dir=target / role)
        path = safe_path(target, item["path"])
        if path.stat().st_size != item["bytes"]:
            raise RuntimeError(f"Incomplete download: {role}")
        check_format(path)
        item["sha256"] = file_hash(path)
        if item["upstream_sha256"] and item["sha256"] != item["upstream_sha256"]:
            raise RuntimeError(f"Upstream checksum mismatch: {role}")
    temporary = target / "bundle.json.tmp"
    temporary.write_text(json.dumps(plan, indent=2) + "\n")
    temporary.replace(target / "bundle.json")
    read_bundle(target)
    print("Qwen bundle verified and saved. GPU generation must still be tested.")


def prepare_plan(target: Path, factory, source: str, explicit: dict, *, refresh=False):
    path = target / "download-plan.json"
    if path.is_file() and not refresh and not any(explicit.values()):
        plan = json.loads(path.read_text())
        validate_plan(plan)
        if plan["components"]["diffusion"]["endpoint"] != ENDPOINTS[source]:
            raise RuntimeError("A plan from another endpoint already exists; use --refresh to change it")
        print("Reusing the pinned download plan; interrupted downloads keep the same revisions")
        return plan
    plan = resolve_plan(factory, source, explicit)
    validate_plan(plan)
    target.mkdir(parents=True, exist_ok=True)
    temporary = target / "download-plan.json.tmp"
    temporary.write_text(json.dumps(plan, indent=2) + "\n")
    temporary.replace(path)
    return plan


def inspect_repository(api, downloader, endpoint):
    info = api.model_info(QWEN_REPO, files_metadata=True)
    card = downloader(repo_id=QWEN_REPO, filename="README.md", revision=info.sha,
                      endpoint=endpoint, token=False)
    report = {"repository": QWEN_REPO, "endpoint": endpoint, "revision": info.sha,
              "gated": info.gated, "card": dict(info.card_data or {}),
              "files": [{"name": f.rfilename, "bytes": f.size} for f in info.siblings],
              "readme": Path(card).read_text()}
    print(json.dumps(report, ensure_ascii=False, indent=2))


def main():
    from huggingface_hub import HfApi, hf_hub_download

    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=list(ENDPOINTS), default="huggingface")
    parser.add_argument("--inspect", action="store_true", help="Print public model card and filenames; do not download weights")
    parser.add_argument("--plan", action="store_true", help="Resolve exact components and sizes without weight downloads")
    parser.add_argument("--verify", action="store_true", help="Verify local bundle hashes offline")
    parser.add_argument("--refresh", action="store_true")
    for role in ROLES:
        parser.add_argument(f"--{role.replace('_', '-')}-file")
    args = parser.parse_args()
    target = Path(os.environ.get("QWEN_MODEL_DIR", "models/qwen-image-2.1-turbo"))
    factory = lambda endpoint: HfApi(endpoint=endpoint, token=False)
    if args.inspect:
        inspect_repository(factory(ENDPOINTS[args.source]), hf_hub_download, ENDPOINTS[args.source])
        return
    if args.verify:
        read_bundle(target, verify=True)
        print("Pinned Qwen bundle: all four SHA256 checks PASS")
        return
    if not args.plan and (target / "bundle.json").is_file() and not args.refresh:
        read_bundle(target, verify=True)
        print("Reusing verified pinned Qwen bundle offline; use --refresh to change revisions")
        return
    plan = prepare_plan(target, factory, args.source,
                        {r: getattr(args, r + "_file") for r in ROLES}, refresh=args.refresh)
    print(json.dumps(plan, indent=2))
    print(f"Selected weights: {sum(i['bytes'] for i in plan['components'].values()) / 1024**3:.2f} GiB", flush=True)
    if not args.plan:
        download_bundle(plan, target, hf_hub_download)


if __name__ == "__main__":
    main()
