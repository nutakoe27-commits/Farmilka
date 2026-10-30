import base64
import hashlib
import io
from pathlib import Path
from unittest.mock import Mock

import httpx
import pytest
from fastapi.testclient import TestClient
from PIL import Image

from photo_service import download_krea_edit, krea_edit
from photo_service.api import create_app
from photo_service.settings import APISettings, WorkerSettings
from photo_service.worker import process_job


def weight():
    header = b'{"tensor":{}}'
    return len(header).to_bytes(8, "little") + header + b"test weight"


def test_adapter_download_hash_and_corruption_detection(tmp_path, monkeypatch):
    sha = hashlib.sha256(weight()).hexdigest()
    monkeypatch.setattr(krea_edit, "BYTES", len(weight()))
    monkeypatch.setattr(krea_edit, "SHA256", sha)
    monkeypatch.setattr(download_krea_edit, "BYTES", len(weight()))
    monkeypatch.setattr(download_krea_edit, "SHA256", sha)

    def download(**args):
        path = args["local_dir"] / args["filename"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(weight())
        assert args["revision"] == krea_edit.REVISION and args["token"] is False

    download_krea_edit.download(tmp_path, download)
    path = krea_edit.read_edit_bundle(tmp_path, verify=True)
    path.write_bytes(path.read_bytes()[:-1] + b"x")
    with pytest.raises(RuntimeError, match="SHA256 mismatch"):
        krea_edit.read_edit_bundle(tmp_path, verify=True)


def test_edit_uses_structured_adapter_only_for_reference(tmp_path):
    job = {"prompt": "Make it blue", "width": 512, "height": 512, "seed": 42}
    plain = krea_edit.edit_generation_payload(job, None)
    assert "lora" not in plain and "ref_images" not in plain
    edited = krea_edit.edit_generation_payload(job, Image.new("RGB", (768, 512), "red"))
    assert edited["ref_image_args"] == "preset=krea2_edit"
    assert edited["lora"] == [{"path": krea_edit.FILENAME, "multiplier": 1.0, "is_high_noise": False}]
    assert Image.open(io.BytesIO(base64.b64decode(edited["ref_images"][0]))).size == (768, 512)
    assert "init_image" not in edited


@pytest.mark.parametrize("reference", [False, True])
def test_api_worker_and_simulated_edit_backend(tmp_path, reference):
    output = io.BytesIO()
    Image.new("RGB", (512, 512), "blue").save(output, "PNG")
    encoded = base64.b64encode(output.getvalue()).decode()
    requests = []

    def backend(request):
        import json
        if request.method == "POST":
            body = json.loads(request.content)
            requests.append(body)
            assert bool(body.get("lora")) is reference
            assert bool(body.get("ref_images")) is reference
            return httpx.Response(202, json={"id": "job_1"})
        return httpx.Response(200, json={"status": "completed", "result": {"images": [{"b64_json": encoded}]}})

    engine = krea_edit.KreaEditEngine.__new__(krea_edit.KreaEditEngine)
    engine.settings = WorkerSettings(worker_token="b" * 48, engine="lustify_krea_edit", qwen_job_timeout=30)
    engine.client = httpx.Client(base_url="http://backend.test", transport=httpx.MockTransport(backend))
    engine.process, engine._start, engine._stop_backend = Mock(poll=Mock(return_value=None)), Mock(), Mock()
    app = create_app(APISettings(api_token="a" * 48, worker_token="b" * 48, data_dir=tmp_path / "data"))
    user = {"Authorization": "Bearer " + "a" * 48}
    worker = {"Authorization": "Bearer " + "b" * 48}
    files = {"reference": ("ref.png", output.getvalue(), "image/png")} if reference else {}
    with TestClient(app) as client:
        response = client.post("/api/jobs", headers=user, data={"prompt": "Make it blue", "width": 512,
                               "height": 512}, files=files)
        assert response.status_code == 202
        job_id = response.json()["id"]
        job = client.post("/internal/claim", headers=worker, json={"engine": "lustify_krea_edit"}).json()["job"]
        assert job["has_reference"] is reference
        with TestClient(app, headers=worker) as worker_client:
            process_job(worker_client, engine, job)
        assert client.get(f"/api/jobs/{job_id}", headers=user).json()["status"] == "succeeded"
    assert len(requests) == 1
    engine.client.close()
