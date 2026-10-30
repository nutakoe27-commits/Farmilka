import base64
import hashlib
import io
import json
from unittest.mock import Mock

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from photo_service import download_krea, krea
from photo_service.api import create_app
from photo_service.settings import APISettings, WorkerSettings
from photo_service.worker import process_job


def weights(role):
    header = b'{"tensor":{}}'
    return len(header).to_bytes(8, "little") + header + role.encode()


@pytest.fixture
def model_and_plan(monkeypatch):
    digest = hashlib.sha256(weights("diffusion")).hexdigest()
    monkeypatch.setattr(krea, "DIFFUSION_SHA256", digest)
    monkeypatch.setattr(download_krea, "DIFFUSION_SHA256", digest)
    for role in ("text_encoder", "vae"):
        monkeypatch.setitem(download_krea.PINNED_HF, role, {
            "revision": "a" * 40, "bytes": len(weights(role)),
            "sha256": hashlib.sha256(weights(role)).hexdigest(),
        })
    file = {"id": krea.FILE_ID, "name": "test.safetensors", "type": "Model",
            "sizeKB": len(weights("diffusion")) / 1024,
            "metadata": {"fp": "fp8"}, "hashes": {"SHA256": digest},
            "downloadUrl": "https://civitai.com/api/download/models/3112728"}
    model = {"id": krea.MODEL_ID, "name": "LUSTIFY", "type": "Checkpoint",
             "modelVersions": [{"id": krea.VERSION_ID, "name": "v10", "baseModel": "Krea 2", "files": [file]}]}
    return model, download_krea.prepare_plan(model)


def test_plan_pins_selected_model_and_separate_encoder_vae(model_and_plan):
    _, (plan, _) = model_and_plan
    assert plan["version_id"] == 3112728
    assert plan["components"]["diffusion"]["file_id"] == 2997637
    assert plan["components"]["text_encoder"]["filename"] == krea.FILENAMES["text_encoder"]
    assert plan["components"]["vae"]["filename"] == krea.FILENAMES["vae"]


@pytest.mark.parametrize("bad", ["hash", "file_id", "base_model", "unsafe_url"])
def test_refuses_other_weights_and_unsafe_download(model_and_plan, bad):
    model, _ = model_and_plan
    version = model["modelVersions"][0]
    file = version["files"][0]
    if bad == "hash":
        file["hashes"]["SHA256"] = "0" * 64
    elif bad == "file_id":
        file["id"] += 1
    elif bad == "base_model":
        version["baseModel"] = "SDXL 1.0"
    else:
        file["downloadUrl"] = "https://civitai.com/api/download/models/3112728?token=abc"
    with pytest.raises(RuntimeError):
        download_krea.prepare_plan(model)


def test_download_publishes_only_verified_bundle(tmp_path, model_and_plan, monkeypatch):
    _, (plan, url) = model_and_plan

    class Response(io.BytesIO):
        status = 200
        headers = {}

    monkeypatch.setattr(download_krea, "request_with_auth", lambda *a, **kw: Response(weights("diffusion")))

    def hf_download(**kwargs):
        role = kwargs["local_dir"].name
        path = kwargs["local_dir"] / kwargs["filename"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(weights(role))

    download_krea.download_bundle(plan, url, tmp_path, {}, hf_download)
    assert krea.read_bundle(tmp_path, verify=True)["version_id"] == 3112728
    path = tmp_path / plan["components"]["text_encoder"]["path"]
    path.write_bytes(path.read_bytes()[:-1] + b"X")
    with pytest.raises(RuntimeError, match="Checksum mismatch"):
        krea.read_bundle(tmp_path, verify=True)


def test_krea_uses_turbo_sampling_and_refuses_unimplemented_edit(tmp_path, model_and_plan):
    _, (plan, _) = model_and_plan
    settings = WorkerSettings(worker_token="b" * 48, engine="lustify_krea", krea_model_dir=tmp_path)
    cmd = krea.server_command(settings, plan)
    assert "--diffusion-model" in cmd and "--llm" in cmd and "--vae" in cmd
    assert "--llm_vision" not in cmd and "--sigmas" not in cmd
    job = {"prompt": "test", "width": 1024, "height": 1024, "seed": 42}
    payload = krea.generation_payload(job, None)
    assert payload["sample_params"]["sample_steps"] == 8
    assert payload["sample_params"]["guidance"]["txt_cfg"] == 1
    with pytest.raises(ValueError, match="does not support reference"):
        krea.generation_payload(job, Image.new("RGB", (512, 512)))


def test_api_worker_and_simulated_native_backend(tmp_path):
    output = io.BytesIO()
    Image.new("RGB", (512, 512), "blue").save(output, "PNG")
    encoded = base64.b64encode(output.getvalue()).decode()

    def native(request):
        if request.method == "POST":
            payload = json.loads(request.content)
            assert payload["sample_params"]["sample_steps"] == 8
            assert "ref_images" not in payload and "init_image" not in payload
            return httpx.Response(202, json={"id": "job_1"})
        return httpx.Response(200, json={"status": "completed", "result": {"images": [{"b64_json": encoded}]}})

    engine = krea.KreaEngine.__new__(krea.KreaEngine)
    engine.settings = WorkerSettings(worker_token="b" * 48, engine="lustify_krea", qwen_job_timeout=30)
    engine.client = httpx.Client(base_url="http://backend.test", transport=httpx.MockTransport(native))
    engine.process, engine._start, engine._stop_backend = Mock(poll=Mock(return_value=None)), Mock(), Mock()
    app = create_app(APISettings(api_token="a" * 48, worker_token="b" * 48, data_dir=tmp_path / "data"))
    user = {"Authorization": "Bearer " + "a" * 48}
    worker = {"Authorization": "Bearer " + "b" * 48}
    with TestClient(app) as client:
        job_id = client.post("/api/jobs", headers=user, data={"prompt": "test", "width": 512,
                             "height": 512}).json()["id"]
        job = client.post("/internal/claim", headers=worker, json={"engine": "lustify_krea"}).json()["job"]
        ref = client.post("/api/jobs", headers=user, data={"prompt": "edit"},
                          files={"reference": ("ref.png", output.getvalue(), "image/png")})
        assert ref.status_code == 422 and ref.json()["detail"] == "reference_not_supported"
        with TestClient(app, headers=worker) as worker_client:
            process_job(worker_client, engine, job)
        assert client.get(f"/api/jobs/{job_id}", headers=user).json()["status"] == "succeeded"
    engine.client.close()
