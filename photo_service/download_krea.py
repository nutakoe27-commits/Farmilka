"""Download the selected LUSTIFY Krea Turbo FP8 bundle, with immutable hashes."""
import argparse
import hashlib
import json
import os
import shutil
import time
import urllib.error
import urllib.parse
from pathlib import Path

from .download_lustify import model_info, request_with_auth
from .krea import DIFFUSION_SHA256, FILE_ID, FILENAMES, MODEL_ID, REPOS, VERSION_ID, read_bundle, validate_plan
from .qwen_bundle import SDCPP_REVISION, check_format, file_hash, safe_path

PINNED_HF = {
    "text_encoder": {"revision": "1171f4dc7e325bf3734586942e737872506c73e1",
                     "bytes": 5242467968, "sha256": "54bd5144df0bbc25dd6ccadfcb826b521445a1b06ae5a42570bdd2974ca87094"},
    "vae": {"revision": "123acf1cc74bccbb9bfff8ac1ee72edc08c2341d",
            "bytes": 253815318, "sha256": "2fc39d31359a4b0a64f55876d8ff7fa8d780956ae2cb13463b0223e15148976b"},
}


def prepare_plan(model):
    if model.get("id") != MODEL_ID or model.get("type") != "Checkpoint":
        raise RuntimeError("Unexpected Civitai model")
    versions = [v for v in model.get("modelVersions", []) if v.get("id") == VERSION_ID]
    if len(versions) != 1 or versions[0].get("baseModel") != "Krea 2":
        raise RuntimeError("LUSTIFY Krea version not found")
    files = [f for f in versions[0].get("files", []) if f.get("id") == FILE_ID]
    if len(files) != 1:
        raise RuntimeError("LUSTIFY Turbo FP8 file not found")
    file = files[0]
    if (file.get("type") != "Model" or file.get("metadata", {}).get("fp") != "fp8"
            or str(file.get("hashes", {}).get("SHA256", "")).lower() != DIFFUSION_SHA256):
        raise RuntimeError("LUSTIFY Turbo FP8 metadata changed")
    url = file.get("downloadUrl", "")
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname != "civitai.com"
            or not parsed.path.startswith("/api/download/models/") or parsed.username or parsed.password
            or any(k.lower() in {"token", "authorization", "api_key"}
                   for k, _ in urllib.parse.parse_qsl(parsed.query))):
        raise RuntimeError("Unexpected Civitai download URL")
    name = file.get("name", "")
    if name != Path(name).name or not name.endswith(".safetensors"):
        raise RuntimeError("Invalid Civitai filename")
    size = int(float(file.get("sizeKB", 0)) * 1024)
    components = {"diffusion": {"file_id": FILE_ID, "filename": name, "path": "diffusion/" + name,
                                "bytes": size, "sha256": DIFFUSION_SHA256}}
    for role, pinned in PINNED_HF.items():
        components[role] = {**pinned, "repo_id": REPOS[role], "filename": FILENAMES[role],
                            "path": role + "/" + FILENAMES[role]}
    plan = {"schema": 1, "model_id": MODEL_ID, "version_id": VERSION_ID,
            "model_name": model.get("name"), "version_name": versions[0].get("name"),
            "sdcpp_revision": SDCPP_REVISION, "components": components,
            "license": {k: model.get(k) for k in ("allowCommercialUse", "allowNoCredit",
                                                    "allowDerivatives", "allowDifferentLicense")}}
    validate_plan(plan)
    return plan, url


def download_civitai(item, url, target, state):
    final = safe_path(target, item["path"])
    final.parent.mkdir(parents=True, exist_ok=True)
    if final.is_file() and final.stat().st_size == item["bytes"] and file_hash(final) == item["sha256"]:
        return
    partial = final.with_name(final.name + ".partial")
    existing = partial.stat().st_size if partial.is_file() else 0
    digest = hashlib.sha256()
    if existing:
        with partial.open("rb") as f:
            for chunk in iter(lambda: f.read(4 * 1024 * 1024), b""):
                digest.update(chunk)
    if not existing or digest.hexdigest() != item["sha256"]:
        try:
            response = request_with_auth(url, state, offset=existing)
        except urllib.error.HTTPError as exc:
            if exc.code != 416 or not existing:
                raise
            existing, digest = 0, hashlib.sha256()
            response = request_with_auth(url, state)
        with response:
            if existing and response.status != 206:
                existing, digest = 0, hashlib.sha256()
            if existing and not response.headers.get("Content-Range", "").startswith(f"bytes {existing}-"):
                raise RuntimeError("Unexpected download range")
            with partial.open("ab" if existing else "wb") as output:
                received, last = existing, time.monotonic()
                while chunk := response.read(4 * 1024 * 1024):
                    output.write(chunk)
                    digest.update(chunk)
                    received += len(chunk)
                    if time.monotonic() - last > 10:
                        print(f"Downloaded {received / 1024**3:.2f} GiB", flush=True)
                        last = time.monotonic()
    if partial.stat().st_size != item["bytes"] or digest.hexdigest() != item["sha256"]:
        partial.unlink(missing_ok=True)
        raise RuntimeError("LUSTIFY download size or SHA256 mismatch")
    check_format(partial, format_suffix=".safetensors")
    partial.replace(final)


def download_bundle(plan, url, target, state, hf_download):
    validate_plan(plan)
    target.mkdir(parents=True, exist_ok=True)
    # Hugging Face temporary files can coexist with the final file.
    remaining = sum(i["bytes"] for i in plan["components"].values()
                    if not safe_path(target, i["path"]).is_file())
    if shutil.disk_usage(target).free < remaining + 3 * 1024**3:
        raise RuntimeError("Not enough disk space for the Krea bundle")
    (target / "bundle.json").unlink(missing_ok=True)
    for role in ("diffusion", "text_encoder", "vae"):
        item = plan["components"][role]
        print(f"Downloading {role}", flush=True)
        if role == "diffusion":
            download_civitai(item, url, target, state)
        else:
            hf_download(repo_id=item["repo_id"], filename=item["filename"], revision=item["revision"],
                        token=False, local_dir=target / role)
            path = safe_path(target, item["path"])
            if path.stat().st_size != item["bytes"] or file_hash(path) != item["sha256"]:
                raise RuntimeError(f"Size or SHA256 mismatch for {role}")
            check_format(path)
    temporary = target / "bundle.json.tmp"
    temporary.write_text(json.dumps(plan, indent=2) + "\n")
    temporary.replace(target / "bundle.json")
    read_bundle(target)
    print("LUSTIFY Krea bundle verified; actual GPU generation is not yet tested")


def main():
    from huggingface_hub import hf_hub_download

    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    target = Path(os.environ.get("KREA_MODEL_DIR", "models/lustify-krea"))
    if args.verify:
        read_bundle(target, verify=True)
        print("LUSTIFY Krea bundle SHA256: PASS")
        return
    if not args.plan and (target / "bundle.json").is_file():
        read_bundle(target, verify=True)
        print("Reusing verified LUSTIFY Krea bundle")
        return
    state = {"token": os.environ.get("CIVITAI_TOKEN")}
    try:
        plan, url = prepare_plan(model_info(state))
        target.mkdir(parents=True, exist_ok=True)
        (target / "download-plan.json").write_text(json.dumps(plan, indent=2) + "\n")
        print(json.dumps(plan, indent=2), flush=True)
        if not args.plan:
            download_bundle(plan, url, target, state, hf_hub_download)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"Civitai returned HTTP {exc.code}") from None
    except urllib.error.URLError as exc:
        raise SystemExit(f"Civitai connection failed: {type(exc.reason).__name__}") from None


if __name__ == "__main__":
    main()
