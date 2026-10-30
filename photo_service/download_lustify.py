"""Inspect and download one verified LUSTIFY SDXL checkpoint from Civitai."""
import argparse
import getpass
import hashlib
import json
import os
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from .lustify import LUSTIFY_MODEL_ID, read_lustify_manifest
from .qwen_bundle import check_format

MODEL_URL = f"https://civitai.com/api/v1/models/{LUSTIFY_MODEL_ID}"


def usable_version(version: dict) -> bool:
    base = str(version.get("baseModel") or "").upper()
    name = str(version.get("name") or "").lower()
    return base.startswith("SDXL") and not any(
        word in base.lower() or word in name
        for word in ("lightning", "turbo", "dmd", "lcm", "hyper")
    )


def choose_checkpoint(model: dict, version_id=None, file_id=None) -> tuple[dict, dict]:
    if (model.get("id") != LUSTIFY_MODEL_ID or model.get("type") != "Checkpoint"
            or "lustify" not in str(model.get("name") or "").lower()):
        raise RuntimeError("The Civitai item is not the selected full LUSTIFY checkpoint")
    versions = [v for v in model.get("modelVersions", []) if usable_version(v)]
    if version_id is not None:
        versions = [v for v in versions if v.get("id") == version_id]
    if not versions:
        raise RuntimeError("No matching standard SDXL version; inspect the model card first")
    version = max(versions, key=lambda v: (str(v.get("createdAt") or ""), v.get("id") or 0))
    files = [f for f in version.get("files", [])
             if f.get("type") == "Model" and str(f.get("name") or "").lower().endswith(".safetensors")]
    if file_id is not None:
        files = [f for f in files if f.get("id") == file_id]
    if len(files) > 1:
        primary = [f for f in files if f.get("primary") is True]
        if len(primary) == 1:
            files = primary
    if len(files) != 1:
        raise RuntimeError("Cannot select one safetensors checkpoint; specify --file-id after inspection")
    file = files[0]
    filename = file.get("name", "")
    if filename != Path(filename).name or not filename:
        raise RuntimeError("Invalid Civitai checkpoint filename")
    checksum = str((file.get("hashes") or {}).get("SHA256") or "").lower()
    if not re.fullmatch(r"[0-9a-f]{64}", checksum):
        raise RuntimeError("Civitai did not provide a SHA256 for this file")
    parsed = urllib.parse.urlsplit(str(file.get("downloadUrl") or ""))
    if (parsed.scheme != "https" or parsed.hostname != "civitai.com"
            or not parsed.path.startswith("/api/download/models/")
            or parsed.username or parsed.password
            or any(k.lower() in {"token", "authorization", "api_key"}
                   for k, _ in urllib.parse.parse_qsl(parsed.query))):
        raise RuntimeError("Unexpected Civitai download URL")
    return version, file


class HTTPSOnlyRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urllib.parse.urlsplit(newurl)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password:
            raise urllib.error.HTTPError(req.full_url, code, "Unsafe download redirect", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def open_url(url: str, *, token=None, offset=0):
    request = urllib.request.Request(url, headers={"User-Agent": "PhotoService/1.0"})
    # Do not send the Civitai bearer token to a redirected storage host.
    if token:
        request.add_unredirected_header("Authorization", "Bearer " + token)
    if offset:
        request.add_header("Range", f"bytes={offset}-")
    return urllib.request.build_opener(HTTPSOnlyRedirect()).open(request, timeout=120)


def request_with_auth(url: str, state: dict, *, offset=0):
    try:
        return open_url(url, token=state.get("token"), offset=offset)
    except urllib.error.HTTPError as exc:
        # HTTP 403 may be a region/CDN restriction, not missing credentials.
        if exc.code != 401 or state.get("token"):
            raise
        if not sys.stdin.isatty():
            raise RuntimeError("Civitai requires access; supply CIVITAI_TOKEN securely or run interactively") from None
        token = getpass.getpass("Civitai API token (hidden, not saved): ").strip()
        if not token:
            raise RuntimeError("No Civitai token supplied") from None
        state["token"] = token
        return open_url(url, token=token, offset=offset)


def model_info(state: dict) -> dict:
    with request_with_auth(MODEL_URL, state) as response:
        data = response.read(8 * 1024 * 1024 + 1)
    if len(data) > 8 * 1024 * 1024:
        raise RuntimeError("Civitai metadata response is unexpectedly large")
    return json.loads(data)


def make_plan(model: dict, version: dict, file: dict) -> dict:
    return {
        "schema": 1, "model_id": LUSTIFY_MODEL_ID, "model_name": model.get("name"),
        "version_id": version["id"], "version_name": version.get("name"),
        "base_model": version["baseModel"], "file_id": file.get("id"),
        "filename": file["name"], "estimated_size_kib": file.get("sizeKB"),
        "sha256": file["hashes"]["SHA256"].lower(),
        "license": {k: model.get(k) for k in ("allowCommercialUse", "allowNoCredit",
                                                 "allowDerivatives", "allowDifferentLicense")},
    }


def download_checkpoint(plan: dict, url: str, target: Path, state: dict):
    target.mkdir(parents=True, exist_ok=True)
    filename = plan["filename"]
    if filename != Path(filename).name or Path(filename).suffix.lower() != ".safetensors":
        raise RuntimeError("Invalid checkpoint filename")
    final = target / filename
    partial = target / (filename + ".partial")
    existing = partial.stat().st_size if partial.is_file() else 0
    estimated = int(float(plan.get("estimated_size_kib") or 0) * 1024)
    required = max(0, estimated - existing) + 2 * 1024**3
    if shutil.disk_usage(target).free < required:
        raise RuntimeError(f"Not enough free space; need approximately {required / 1024**3:.1f} GiB")
    sha = hashlib.sha256()
    if existing:
        with partial.open("rb") as source:
            for chunk in iter(lambda: source.read(4 * 1024 * 1024), b""):
                sha.update(chunk)
    if not existing or sha.hexdigest() != plan["sha256"]:
        try:
            response = request_with_auth(url, state, offset=existing)
        except urllib.error.HTTPError as exc:
            if exc.code != 416 or not existing:
                raise
            # A stale partial file can be longer than the current remote file.
            # Restart without deleting the last verified bundle.
            existing, sha = 0, hashlib.sha256()
            response = request_with_auth(url, state)
        with response:
            if existing and response.status != 206:
                existing, sha = 0, hashlib.sha256()
            if existing:
                content_range = response.headers.get("Content-Range", "")
                if not content_range.startswith(f"bytes {existing}-"):
                    raise RuntimeError("The server returned an unexpected download range")
            with partial.open("ab" if existing else "wb") as out:
                received, last = existing, time.monotonic()
                while chunk := response.read(4 * 1024 * 1024):
                    out.write(chunk)
                    sha.update(chunk)
                    received += len(chunk)
                    if time.monotonic() - last >= 10:
                        print(f"Downloaded {received / 1024**3:.2f} GiB", flush=True)
                        last = time.monotonic()
    if sha.hexdigest() != plan["sha256"]:
        partial.unlink(missing_ok=True)
        raise RuntimeError("Checkpoint SHA256 mismatch; incomplete file removed")
    check_format(partial, format_suffix=".safetensors")
    # Keep the old bundle until a replacement is validated; remove its marker
    # immediately before atomically replacing the checkpoint.
    (target / "bundle.json").unlink(missing_ok=True)
    partial.replace(final)
    plan["bytes"] = final.stat().st_size
    temporary = target / "bundle.json.tmp"
    temporary.write_text(json.dumps(plan, indent=2) + "\n")
    temporary.replace(target / "bundle.json")
    read_lustify_manifest(target)
    print("LUSTIFY checkpoint verified and saved; GPU generation still needs testing")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--inspect", action="store_true")
    parser.add_argument("--plan", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--refresh", action="store_true")
    parser.add_argument("--version-id", type=int)
    parser.add_argument("--file-id", type=int)
    args = parser.parse_args()
    target = Path(os.environ.get("LUSTIFY_MODEL_DIR", "models/lustify"))
    if args.verify:
        read_lustify_manifest(target, verify=True)
        print("LUSTIFY checkpoint SHA256: PASS")
        return
    if not args.inspect and not args.plan and (target / "bundle.json").is_file() and not args.refresh:
        read_lustify_manifest(target, verify=True)
        print("Reusing verified LUSTIFY checkpoint offline; use --refresh to change versions")
        return
    state = {"token": os.environ.get("CIVITAI_TOKEN")}
    try:
        model = model_info(state)
        if args.inspect:
            summary = {k: model.get(k) for k in ("id", "name", "type", "allowCommercialUse",
                                                  "allowNoCredit", "allowDerivatives", "allowDifferentLicense")}
            summary["versions"] = [{"id": v.get("id"), "name": v.get("name"),
                                    "base_model": v.get("baseModel"),
                                    "files": [{k: f.get(k) for k in ("id", "name", "sizeKB", "type", "primary", "hashes")}
                                              for f in v.get("files", []) if f.get("type") == "Model"]}
                                   for v in model.get("modelVersions", [])]
            print(json.dumps(summary, indent=2, ensure_ascii=False))
            return
        plan_path = target / "download-plan.json"
        previous = None
        if (plan_path.is_file() and not args.refresh
                and args.version_id is None and args.file_id is None):
            previous = json.loads(plan_path.read_text())
        version, file = choose_checkpoint(
            model, previous.get("version_id") if previous else args.version_id,
            previous.get("file_id") if previous else args.file_id,
        )
        plan = make_plan(model, version, file)
        if previous and any(previous.get(k) != plan.get(k) for k in
                            ("model_id", "version_id", "file_id", "filename", "sha256")):
            raise RuntimeError("The selected Civitai file changed; inspect it or use --refresh")
        print(json.dumps(plan, indent=2, ensure_ascii=False), flush=True)
        target.mkdir(parents=True, exist_ok=True)
        temporary = target / "download-plan.json.tmp"
        temporary.write_text(json.dumps(plan, indent=2) + "\n")
        temporary.replace(plan_path)
        if not args.plan:
            download_checkpoint(plan, file["downloadUrl"], target, state)
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"Civitai returned HTTP {exc.code}; no token or signed download URL was printed") from None
    except urllib.error.URLError as exc:
        raise SystemExit(f"Civitai connection failed: {type(exc.reason).__name__}") from None


if __name__ == "__main__":
    main()
