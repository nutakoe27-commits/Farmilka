"""Inspect the publisher's small Krea Edit workflow without downloading weights."""
import hashlib
import json
import os
import re
import urllib.error
import urllib.parse

from photo_service.download_lustify import request_with_auth

VERSION_ID = 3159388
FILE_ID = 3040376
VERSION_URL = f"https://civitai.com/api/v1/model-versions/{VERSION_ID}"
FILE_PATTERN = re.compile(r"[\w .+@()\-]+\.(?:safetensors|gguf|ckpt|pt|pth|bin)", re.IGNORECASE)


def collect_files(workflow):
    found = set()

    def inspect(value):
        if isinstance(value, dict):
            if isinstance(value.get("type"), str):
                widgets = json.dumps(value.get("widgets_values", []), ensure_ascii=False)
                for name in FILE_PATTERN.findall(widgets):
                    found.add((value["type"], name.strip()))
            for child in value.values():
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)

    inspect(workflow)
    return sorted(found)


def collect_lora_settings(workflow):
    found = []
    allowed = {"on", "lora", "strength", "strengthTwo", "model_strength", "clip_strength"}

    def inspect(value):
        if isinstance(value, dict):
            if isinstance(value.get("type"), str) and "lora" in value["type"].lower():
                settings = []

                def collect(entry):
                    if isinstance(entry, dict):
                        safe = {k: v for k, v in entry.items() if k in allowed and (
                            isinstance(v, (int, float, bool)) or
                            (k == "lora" and isinstance(v, str) and FILE_PATTERN.fullmatch(v)))}
                        if safe:
                            settings.append(safe)
                        for child in entry.values():
                            if isinstance(child, (dict, list)):
                                collect(child)
                    elif isinstance(entry, list):
                        for child in entry:
                            collect(child)

                collect(value.get("widgets_values", []))
                found.append({"type": value["type"], "mode": value.get("mode"), "settings": settings})
            for child in value.values():
                inspect(child)
        elif isinstance(value, list):
            for child in value:
                inspect(child)

    inspect(workflow)
    return found


def inspect_workflow(state):
    with request_with_auth(VERSION_URL, state) as response:
        data = response.read(8 * 1024 * 1024 + 1)
    if len(data) > 8 * 1024 * 1024:
        raise RuntimeError("Unexpected metadata size")
    version = json.loads(data)
    if version.get("id") != VERSION_ID or version.get("baseModel") != "Krea 2":
        raise RuntimeError("Unexpected workflow version")
    files = [f for f in version.get("files", []) if f.get("id") == FILE_ID and f.get("type") == "Config"]
    if len(files) != 1:
        raise RuntimeError("Expected workflow config not found")
    item = files[0]
    expected = str(item.get("hashes", {}).get("SHA256", "")).lower()
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise RuntimeError("Workflow checksum missing")
    url = item.get("downloadUrl", "")
    parsed = urllib.parse.urlsplit(url)
    if (parsed.scheme != "https" or parsed.hostname != "civitai.com" or parsed.username or parsed.password
            or not parsed.path.startswith("/api/download/models/")
            or any(k.lower() in {"token", "authorization", "api_key"}
                   for k, _ in urllib.parse.parse_qsl(parsed.query))):
        raise RuntimeError("Unexpected workflow download address")
    with request_with_auth(url, state) as response:
        data = response.read(1024 * 1024 + 1)
    if len(data) > 1024 * 1024 or hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError("Workflow size or SHA256 check failed")
    workflow = json.loads(data)
    return version.get("name"), expected, collect_files(workflow), collect_lora_settings(workflow)


def main():
    try:
        name, checksum, files, loras = inspect_workflow({"token": os.environ.get("CIVITAI_TOKEN")})
        print(f"Workflow: {name}; SHA-256: {checksum} (PASS)")
        print("Referenced files:")
        for kind, filename in files:
            print(f"  {kind}: {filename}")
        if not files:
            print("  No filenames were found in node widgets.")
        print("LoRA node settings:")
        print(json.dumps(loras, ensure_ascii=False, indent=2))
        print("\nPossible identity adapter repository:")
        try:
            from huggingface_hub import HfApi
            info = HfApi(token=False).model_info("conradlocke/krea2-identity-edit", files_metadata=True)
            card = getattr(info, "card_data", None)
            print(f"revision={info.sha} gated={info.gated} license={card.get('license') if card else None}")
            for file in info.siblings:
                if file.rfilename.lower().endswith((".safetensors", ".gguf")):
                    print(f"  file={file.rfilename} bytes={file.size} lfs={file.lfs}")
        except Exception as error:
            print(f"  Hugging Face lookup failed: {type(error).__name__}")
        print("No model weights were downloaded.")
    except urllib.error.HTTPError as error:
        raise SystemExit(f"Civitai returned HTTP {error.code}") from None
    except urllib.error.URLError as error:
        raise SystemExit(f"Civitai connection failed: {type(error.reason).__name__}") from None


if __name__ == "__main__":
    main()
