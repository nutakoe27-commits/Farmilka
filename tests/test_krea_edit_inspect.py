import hashlib
import io
import json

import pytest

from scripts import inspect_krea_edit


def test_inspects_only_model_filenames_and_checks_workflow_hash(monkeypatch):
    workflow = {"nodes": [
        {"type": "LoraLoader", "mode": 0,
         "widgets_values": [{"lora": "krea_edit.safetensors", "on": True, "strength": 0.75, "token": "secret"}]},
        {"type": "TextEncoder", "widgets_values": ["qwen.gguf"]},
        {"type": "Prompt", "widgets_values": ["Do not print my prompt"]},
    ]}
    payload = json.dumps(workflow).encode()
    sha = hashlib.sha256(payload).hexdigest()
    metadata = {"id": 3159388, "name": "KREA 2 Edit", "baseModel": "Krea 2", "files": [{
        "id": 3040376, "type": "Config", "hashes": {"SHA256": sha},
        "downloadUrl": "https://civitai.com/api/download/models/3159388",
    }]}
    responses = iter([io.BytesIO(json.dumps(metadata).encode()), io.BytesIO(payload)])
    monkeypatch.setattr(inspect_krea_edit, "request_with_auth", lambda *args: next(responses))
    name, actual, files, loras = inspect_krea_edit.inspect_workflow({})
    assert name == "KREA 2 Edit" and actual == sha
    assert files == [("LoraLoader", "krea_edit.safetensors"), ("TextEncoder", "qwen.gguf")]
    assert loras == [{"type": "LoraLoader", "mode": 0,
                      "settings": [{"lora": "krea_edit.safetensors", "on": True, "strength": 0.75}]}]


def test_rejects_untrusted_download_address_before_fetching(monkeypatch):
    metadata = {"id": 3159388, "baseModel": "Krea 2", "files": [{
        "id": 3040376, "type": "Config", "hashes": {"SHA256": "a" * 64},
        "downloadUrl": "https://example.com/models/workflow.json?token=secret",
    }]}
    monkeypatch.setattr(inspect_krea_edit, "request_with_auth",
                        lambda *args: io.BytesIO(json.dumps(metadata).encode()))
    with pytest.raises(RuntimeError, match="Unexpected workflow download address"):
        inspect_krea_edit.inspect_workflow({})
