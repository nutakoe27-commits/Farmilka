import base64
import hashlib
import io
import json
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import httpx
from fastapi.testclient import TestClient
from PIL import Image

from photo_service import download_lustify
from photo_service.lustify import (
    LUSTIFY_MODEL_ID, LustifyEngine, generation_payload, read_lustify_manifest, server_command,
)
from photo_service.api import create_app
from photo_service.settings import APISettings, WorkerSettings
from photo_service.worker import process_job


def content():
    header = b'{"tensor":{}}'
    return len(header).to_bytes(8, "little") + header + b"test weights"


def model_fixture():
    good = {"id": 43, "name": "lustify.safetensors", "type": "Model", "primary": True,
            "sizeKB": 1, "hashes": {"SHA256": hashlib.sha256(content()).hexdigest()},
            "downloadUrl": "https://civitai.com/api/download/models/101?type=Model"}
    return {"id": LUSTIFY_MODEL_ID, "name": "LUSTIFY!", "type": "Checkpoint",
            "allowCommercialUse": ["Image"], "modelVersions": [
                {"id": 102, "name": "v8 Lightning", "baseModel": "SDXL 1.0", "createdAt": "2026-02-01", "files": [good]},
                {"id": 101, "name": "v8", "baseModel": "SDXL 1.0", "createdAt": "2026-01-01", "files": [good]},
            ]}


def settings(tmp_path, **kw):
    return WorkerSettings(worker_token="b" * 48, engine="lustify", lustify_model_dir=tmp_path, **kw)


def test_default_selects_standard_sdxl_checkpoint_not_lightning():
    model = model_fixture()
    version, file = download_lustify.choose_checkpoint(model)
    assert version["id"] == 101 and file["id"] == 43
    plan = download_lustify.make_plan(model, version, file)
    assert plan["sha256"] == hashlib.sha256(content()).hexdigest()
    assert plan["license"]["allowCommercialUse"] == ["Image"]


@pytest.mark.parametrize("change", ["wrong_model", "workflow", "pickle", "missing_sha", "unsafe_url"])
def test_rejects_wrong_or_unverifiable_checkpoint(change):
    model = model_fixture()
    file = model["modelVersions"][1]["files"][0]
    if change == "wrong_model":
        model["id"] = 2503119
    elif change == "workflow":
        model["type"] = "Workflows"
    elif change == "pickle":
        file["name"] = "weights.ckpt"
    elif change == "missing_sha":
        file["hashes"] = {}
    else:
        file["downloadUrl"] = "https://example.com/evil.safetensors?token=secret"
    with pytest.raises(RuntimeError):
        download_lustify.choose_checkpoint(model)


def test_sd_server_arguments_and_img2img_use_correct_sdxl_inputs(tmp_path):
    config = settings(tmp_path)
    cmd = server_command(config, {"filename": "lustify.safetensors"})
    assert cmd[cmd.index("--model") + 1] == str(tmp_path / "lustify.safetensors")
    assert cmd[cmd.index("--listen-ip") + 1] == "127.0.0.1"
    assert "--sigmas" not in cmd and "--llm" not in cmd
    job = {"prompt": "A blue teapot", "width": 512, "height": 512, "seed": 42}
    plain = generation_payload(config, job, None)
    assert plain["sample_params"]["sample_steps"] == 25
    assert plain["sample_params"]["guidance"]["txt_cfg"] == 5.0
    assert "init_image" not in plain and "ref_images" not in plain
    edited = generation_payload(config, job, Image.new("RGB", (640, 480), "red"))
    image = Image.open(io.BytesIO(base64.b64decode(edited["init_image"])))
    assert image.size == (640, 480) and edited["strength"] == 0.6
    assert edited["image_preprocess"].startswith("target=init,")
    assert "ref_images" not in edited and "custom_sigmas" not in edited["sample_params"]


def test_sdxl_dimensions_must_be_64_aligned(tmp_path):
    with pytest.raises(ValueError, match="multiples of 64"):
        generation_payload(settings(tmp_path), {"prompt": "x", "width": 544, "height": 512, "seed": 0}, None)


class FakeResponse(io.BytesIO):
    def __init__(self, data, status=200, headers=None):
        super().__init__(data)
        self.status = status
        self.headers = headers or {}


def test_verified_download_publishes_and_reuses_checkpoint(tmp_path, monkeypatch):
    model = model_fixture()
    version, file = download_lustify.choose_checkpoint(model)
    plan = download_lustify.make_plan(model, version, file)
    fake_request = Mock(return_value=FakeResponse(content()))
    monkeypatch.setattr(download_lustify, "request_with_auth", fake_request)
    download_lustify.download_checkpoint(plan, file["downloadUrl"], tmp_path, {})
    saved = read_lustify_manifest(tmp_path, verify=True)
    assert saved["bytes"] == len(content()) and saved["version_id"] == 101
    path = tmp_path / saved["filename"]
    path.write_bytes(path.read_bytes()[:-1] + b"X")
    with pytest.raises(RuntimeError, match="checksum mismatch"):
        read_lustify_manifest(tmp_path, verify=True)


def test_resume_verifies_full_hash_before_publication(tmp_path, monkeypatch):
    model = model_fixture()
    version, file = download_lustify.choose_checkpoint(model)
    plan = download_lustify.make_plan(model, version, file)
    cutoff = 15
    (tmp_path / (file["name"] + ".partial")).write_bytes(content()[:cutoff])
    fake_request = Mock(return_value=FakeResponse(content()[cutoff:], 206,
                                                  {"Content-Range": f"bytes {cutoff}-{len(content())-1}/{len(content())}"}))
    monkeypatch.setattr(download_lustify, "request_with_auth", fake_request)
    download_lustify.download_checkpoint(plan, file["downloadUrl"], tmp_path, {})
    assert fake_request.call_args.kwargs["offset"] == cutoff
    assert read_lustify_manifest(tmp_path, verify=True)["sha256"] == plan["sha256"]


def test_stale_partial_range_restarts_download(tmp_path, monkeypatch):
    model = model_fixture()
    version, file = download_lustify.choose_checkpoint(model)
    plan = download_lustify.make_plan(model, version, file)
    (tmp_path / (file["name"] + ".partial")).write_bytes(b"stale content")
    error = urllib.error.HTTPError(file["downloadUrl"], 416, "range", {}, None)
    request = Mock(side_effect=[error, FakeResponse(content())])
    monkeypatch.setattr(download_lustify, "request_with_auth", request)
    download_lustify.download_checkpoint(plan, file["downloadUrl"], tmp_path, {})
    assert request.call_count == 2
    assert read_lustify_manifest(tmp_path, verify=True)["sha256"] == plan["sha256"]


@pytest.mark.parametrize("with_reference", [False, True])
def test_lustify_queue_and_native_server_protocol(tmp_path, with_reference):
    # The native server is simulated; this does not test actual GPU inference.
    image = io.BytesIO()
    Image.new("RGB", (512, 512), "blue").save(image, "PNG")
    encoded = base64.b64encode(image.getvalue()).decode()
    calls = []

    def backend(request):
        calls.append(request)
        if request.method == "POST":
            body = json.loads(request.content)
            assert body["prompt"] == "A blue teapot"
            assert bool(body.get("init_image")) is with_reference
            assert "ref_images" not in body
            return httpx.Response(202, json={"id": "job_native"})
        return httpx.Response(200, json={"status": "completed", "result": {
            "images": [{"b64_json": encoded}],
        }})

    engine = LustifyEngine.__new__(LustifyEngine)
    engine.settings = settings(tmp_path, qwen_job_timeout=30)
    engine.client = httpx.Client(base_url="http://backend.test", transport=httpx.MockTransport(backend))
    engine.process = Mock(poll=Mock(return_value=None))
    engine._start, engine._stop_backend = Mock(), Mock()
    app = create_app(APISettings(api_token="a" * 48, worker_token="b" * 48, data_dir=tmp_path / "data"))
    user = {"Authorization": "Bearer " + "a" * 48}
    worker = {"Authorization": "Bearer " + "b" * 48}
    reference = {"reference": ("reference.png", image.getvalue(), "image/png")} if with_reference else {}
    with TestClient(app) as client:
        submitted = client.post("/api/jobs", headers=user, data={"prompt": "A blue teapot", "width": 512,
                                "height": 512, "seed": 42}, files=reference)
        assert submitted.status_code == 202
        job_id = submitted.json()["id"]
        job = client.post("/internal/claim", headers=worker, json={"engine": "lustify"}).json()["job"]
        assert client.get("/healthz").json()["engine"] == "lustify"
        with TestClient(app, headers=worker) as worker_client:
            process_job(worker_client, engine, job)
        assert client.get(f"/api/jobs/{job_id}", headers=user).json()["status"] == "succeeded"
        result = client.get(f"/api/jobs/{job_id}/output", headers=user)
        assert Image.open(io.BytesIO(result.content)).getpixel((0, 0)) == (0, 0, 255)
    assert len(calls) == 2
    engine.client.close()


def test_corrupt_download_keeps_previous_bundle_and_never_publishes(tmp_path, monkeypatch):
    model = model_fixture()
    version, file = download_lustify.choose_checkpoint(model)
    plan = download_lustify.make_plan(model, version, file)
    (tmp_path / "bundle.json").write_text("old bundle")
    monkeypatch.setattr(download_lustify, "request_with_auth", Mock(return_value=FakeResponse(b"invalid")))
    with pytest.raises(RuntimeError, match="SHA256 mismatch"):
        download_lustify.download_checkpoint(plan, file["downloadUrl"], tmp_path, {})
    assert (tmp_path / "bundle.json").read_text() == "old bundle"
    assert not (tmp_path / file["name"]).exists()


def test_bearer_token_is_not_forwarded_to_redirected_storage():
    req = urllib.request.Request("https://civitai.com/api/download/models/123")
    req.add_unredirected_header("Authorization", "Bearer dummy-token")
    handler = download_lustify.HTTPSOnlyRedirect()
    redirected = handler.redirect_request(req, None, 302, "Found", {}, "https://storage.example/file")
    assert not redirected.has_header("Authorization")
    with pytest.raises(urllib.error.HTTPError):
        handler.redirect_request(req, None, 302, "Found", {}, "http://storage.example/file")


def test_http_403_does_not_assume_a_missing_token(monkeypatch):
    error = urllib.error.HTTPError("https://civitai.com/", 403, "forbidden", {}, None)
    monkeypatch.setattr(download_lustify, "open_url", Mock(side_effect=error))
    prompt = Mock(side_effect=AssertionError("403 should not cause a token prompt"))
    monkeypatch.setattr(download_lustify.getpass, "getpass", prompt)
    with pytest.raises(urllib.error.HTTPError):
        download_lustify.request_with_auth("https://civitai.com/", {})
    prompt.assert_not_called()
