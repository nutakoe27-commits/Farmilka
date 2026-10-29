import io
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from photo_service.api import create_app
from photo_service.engines import MockEngine
from photo_service.settings import APISettings
from photo_service.worker import process_job

USER = {"Authorization": "Bearer " + "a" * 48}
WORKER = {"Authorization": "Bearer " + "b" * 48}


@pytest.fixture
def settings(tmp_path):
    return APISettings(api_token="a" * 48, worker_token="b" * 48,
                       data_dir=tmp_path / "data", max_queue=2)


@pytest.fixture
def app(settings):
    return create_app(settings)


@pytest.fixture
def client(app):
    with TestClient(app, headers=USER) as client:
        yield client


def image_bytes(width=640, height=480, fmt="JPEG"):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "#f0ab86").save(buffer, fmt)
    return buffer.getvalue()


def submit(client, **kwargs):
    return client.post("/api/jobs", data={"prompt": "Тёплый вечер / sunset", "width": 512,
                       "height": 512, "seed": 17}, **kwargs)


def claim(client):
    return client.post("/internal/claim", json={"engine": "mock"}, headers=WORKER).json()["job"]


def test_authentication_and_separate_worker_scope(client):
    assert client.post("/api/jobs", data={"prompt": "test"}, headers=WORKER).status_code == 401
    assert client.post("/internal/claim", json={"engine": "mock"}).status_code == 401
    response = client.get("/api/jobs/00000000-0000-0000-0000-000000000000",
                          headers={"Authorization": "Bearer invalid"})
    assert response.status_code == 401
    assert client.get("/healthz").json()["worker_online"] is False


@pytest.mark.parametrize("with_reference", [False, True])
def test_end_to_end_worker_output_and_persistence(client, app, settings, with_reference):
    files = {"reference": ("ref.jpg", image_bytes(), "image/jpeg")} if with_reference else {}
    submitted = submit(client, files=files)
    assert submitted.status_code == 202
    job_id = submitted.json()["id"]
    job = claim(client)
    assert job["has_reference"] is with_reference
    assert job["seed"] == 17
    assert client.get("/healthz").json()["engine"] == "mock"
    with TestClient(app, headers=WORKER) as worker:
        process_job(worker, MockEngine(), job)
    assert client.get(f"/api/jobs/{job_id}").json()["status"] == "succeeded"
    output = client.get(f"/api/jobs/{job_id}/output")
    assert output.status_code == 200
    assert Image.open(io.BytesIO(output.content)).size == (512, 512)
    with TestClient(create_app(settings), headers=USER) as restarted:
        assert restarted.get(f"/api/jobs/{job_id}/output").content == output.content


def test_reference_is_normalized_and_private(client):
    job_id = submit(client, files={"reference": ("a.jpg", image_bytes(2200, 1100), "image/jpeg")}).json()["id"]
    assert client.get(f"/internal/jobs/{job_id}/reference").status_code == 401
    job = claim(client)
    headers = {**WORKER, "X-Lease-Token": job["lease_token"]}
    response = client.get(f"/internal/jobs/{job_id}/reference", headers=headers)
    with Image.open(io.BytesIO(response.content)) as image:
        assert image.format == "PNG"
        assert image.size == (1536, 768)
        assert not image.getexif()


def test_invalid_files_and_large_uploads_rejected(client):
    assert submit(client, files={"reference": ("a.jpg", b"not an image", "image/jpeg")}).status_code == 422
    assert submit(client, files={"reference": ("large", b"x" * (11 * 1024 * 1024))}).status_code == 413


@pytest.mark.parametrize("fields", [
    {"prompt": "   "}, {"prompt": "x", "width": 513},
    {"prompt": "x", "height": 2048}, {"prompt": "x", "seed": -1},
])
def test_invalid_generation_requests_rejected(client, fields):
    assert client.post("/api/jobs", data=fields).status_code == 422


def test_queue_limit_and_atomic_claim(client, app):
    first = submit(client).json()["id"]
    second = submit(client).json()["id"]
    assert submit(client).status_code == 429
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = list(pool.map(lambda _: app.state.store.claim("mock"), range(2)))
    assert {job["id"] for job in jobs} == {first, second}
    assert claim(client) is None


def test_lost_lease_cannot_overwrite_new_attempt(client, app):
    job_id = submit(client).json()["id"]
    old = claim(client)
    with app.state.store.connect() as con:
        con.execute("UPDATE jobs SET lease_expires=0 WHERE id=?", (job_id,))
    new = claim(client)
    assert new["lease_token"] != old["lease_token"]
    old_headers = {**WORKER, "X-Lease-Token": old["lease_token"]}
    assert client.post(f"/internal/jobs/{job_id}/heartbeat", headers=old_headers).status_code == 409
    assert client.post(f"/internal/jobs/{job_id}/result", headers=old_headers,
                       files={"image": ("out.png", image_bytes(512, 512, "PNG"))}).status_code == 409
    new_headers = {**WORKER, "X-Lease-Token": new["lease_token"]}
    assert client.post(f"/internal/jobs/{job_id}/heartbeat", headers=new_headers).status_code == 200
    assert client.post(f"/internal/jobs/{job_id}/result", headers=new_headers,
                       files={"image": ("out.png", image_bytes(512, 512, "PNG"))}).status_code == 200


def test_dead_worker_retries_are_bounded(client, app):
    job_id = submit(client).json()["id"]
    for _ in range(3):
        assert claim(client)["id"] == job_id
        with app.state.store.connect() as con:
            con.execute("UPDATE jobs SET lease_expires=0 WHERE id=?", (job_id,))
    assert claim(client) is None
    status = client.get(f"/api/jobs/{job_id}").json()
    assert status["status"] == "failed"
    assert status["error_code"] == "worker_lost"


def test_worker_reports_oom_without_exposing_internal_errors(client):
    job_id = submit(client).json()["id"]
    job = claim(client)
    headers = {**WORKER, "X-Lease-Token": job["lease_token"]}
    response = client.post(f"/internal/jobs/{job_id}/failure", headers=headers,
                           json={"error_code": "out_of_memory"})
    assert response.status_code == 200
    assert client.get(f"/api/jobs/{job_id}").json()["error_code"] == "out_of_memory"
    assert client.get(f"/api/jobs/{job_id}/output").status_code == 409


def test_private_files_and_static_frontend(client):
    assert client.get("/inputs/anything.png").status_code == 404
    assert client.get("/jobs.sqlite3").status_code == 404
    page = client.get("/")
    assert page.status_code == 200
    assert "Photo Studio" in page.text
    assert "frame-ancestors 'none'" in page.headers["content-security-policy"]
    assert client.get("/i18n.js").status_code == 200


def test_lora_worker_is_identified_by_health_and_can_claim(client):
    job_id = submit(client).json()["id"]
    response = client.post("/internal/claim", json={"engine": "flux_lora"}, headers=WORKER)
    assert response.status_code == 200
    assert response.json()["job"]["id"] == job_id
    assert client.get("/healthz").json()["engine"] == "flux_lora"
