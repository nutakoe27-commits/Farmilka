import base64
import hashlib
import io
import json
from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest
from PIL import Image

from photo_service.download_qwen import choose_file, download_bundle, prepare_plan, resolve_plan
from photo_service.qwen_bundle import (
    DEFAULT_FILES, DIFFUSION_REPO, ENDPOINTS, QWEN_REPO, ROLES, SDCPP_REVISION, TURBO_SIGMAS,
    VAE_REPO, read_bundle, safe_path,
)
from photo_service.qwen_gguf import QwenGGUFEngine, generation_payload, server_command
from photo_service.settings import WorkerSettings


def weight(role):
    return (8).to_bytes(8, "little") + b'{"x":{}}' if role == "vae" else b"GGUF" + b"test-only" * 4


def file(name, role="diffusion"):
    return SimpleNamespace(rfilename=name, size=len(weight(role)),
                           lfs={"sha256": hashlib.sha256(weight(role)).hexdigest()})


def model_api():
    infos = {
        DIFFUSION_REPO: SimpleNamespace(sha="a" * 40, card_data={"license": "other"}, siblings=[
            file("Qwen-Image-2.1-Turbo-Q8_0.gguf"), file(DEFAULT_FILES["diffusion"]),
            file("Qwen-Image-2.1-Turbo-Q4_K_M.gguf"),
        ]),
        QWEN_REPO: SimpleNamespace(sha="b" * 40, card_data={"license": "apache-2.0"}, siblings=[
            file(DEFAULT_FILES["text_encoder"], "text_encoder"),
            file(DEFAULT_FILES["vision"], "vision"),
        ]),
        VAE_REPO: SimpleNamespace(sha="c" * 40, card_data={}, siblings=[
            file("vae/qwen_image_2.1_vae_bf16.safetensors", "vae"),
        ]),
    }
    return Mock(model_info=Mock(side_effect=lambda repo, **kw: infos[repo]))


def plan():
    return resolve_plan(lambda _: model_api(), "pirateface", {})


def download_weights(**kw):
    role = kw["local_dir"].name
    path = safe_path(kw["local_dir"], kw["filename"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(weight(role))


def test_exact_repositories_endpoints_and_revisions_are_recorded():
    api, factory = model_api(), Mock()
    factory.return_value = api
    bundle = resolve_plan(factory, "pirateface", {})
    items = bundle["components"]
    assert items["diffusion"]["repo_id"] == DIFFUSION_REPO
    assert items["diffusion"]["endpoint"] == "https://pirateface.co"
    assert items["diffusion"]["revision"] == "a" * 40
    assert items["text_encoder"]["repo_id"] == QWEN_REPO
    assert items["text_encoder"]["endpoint"] == ENDPOINTS["pirateface"]
    assert items["vision"]["revision"] == items["text_encoder"]["revision"]
    assert items["vae"]["filename"] == "vae/qwen_image_2.1_vae_bf16.safetensors"
    assert bundle["sdcpp_revision"] == SDCPP_REVISION
    assert api.model_info.call_count == 3  # encoder and vision use one snapshot


def test_reviewed_plan_is_reused_offline_for_interrupted_downloads(tmp_path):
    first = prepare_plan(tmp_path, lambda _: model_api(), "pirateface", {})
    offline = Mock(side_effect=AssertionError("Should reuse the pinned plan"))
    assert prepare_plan(tmp_path, offline, "pirateface", {}) == first
    with pytest.raises(RuntimeError, match="another endpoint"):
        prepare_plan(tmp_path, offline, "huggingface", {})


def test_plan_cannot_substitute_the_stock_encoder_or_another_denoiser(tmp_path):
    wrong = plan()
    wrong["components"]["text_encoder"]["repo_id"] = "Qwen/Qwen3-VL-8B-Instruct-GGUF"
    download = Mock()
    with pytest.raises(RuntimeError, match="Unexpected repository"):
        download_bundle(wrong, tmp_path, download)
    download.assert_not_called()


def test_quant_selection_never_downloads_all_variants_or_another_model():
    variants = [file("model-Q8_0.gguf"), file(DEFAULT_FILES["diffusion"]), file("model-Q4_K_M.gguf")]
    assert choose_file("diffusion", variants).rfilename == DEFAULT_FILES["diffusion"]
    with pytest.raises(RuntimeError, match="Cannot uniquely select"):
        choose_file("diffusion", [file("one-Q4_K.gguf"), file("two-Q4_K.gguf")])
    with pytest.raises(RuntimeError, match="Cannot uniquely select"):
        choose_file("text_encoder", [file("plain-Q4_K_M.gguf")])
    with pytest.raises(RuntimeError, match="absent"):
        choose_file("diffusion", variants, "other.gguf")


@pytest.mark.parametrize("name", ["../outside.gguf", "/tmp/outside.gguf", "x/../../bad.gguf", "x\\bad.gguf"])
def test_bundle_rejects_paths_outside_the_model_volume(tmp_path, name):
    with pytest.raises(ValueError):
        safe_path(tmp_path, name)


def test_downloads_are_anonymous_pinned_and_hash_verified(tmp_path):
    download = Mock(side_effect=download_weights)
    download_bundle(plan(), tmp_path, download)
    bundle = read_bundle(tmp_path, verify=True)
    assert len(download.call_args_list) == 4
    for call in download.call_args_list:
        assert call.kwargs["token"] is False
        assert len(call.kwargs["revision"]) == 40
    assert set(bundle["components"]) == set(ROLES)
    # Same-size corruption must be detected, even though basic header checks pass.
    path = safe_path(tmp_path, bundle["components"]["diffusion"]["path"])
    data = path.read_bytes()
    path.write_bytes(data[:-1] + b"X")
    with pytest.raises(RuntimeError, match="Checksum mismatch"):
        read_bundle(tmp_path, verify=True)


def test_interrupted_refresh_cannot_leave_a_false_ready_bundle(tmp_path):
    download_bundle(plan(), tmp_path, download_weights)
    failed = Mock(side_effect=RuntimeError("interrupted"))
    with pytest.raises(RuntimeError, match="interrupted"):
        download_bundle(plan(), tmp_path, failed)
    assert not (tmp_path / "bundle.json").exists()


def test_low_disk_space_stops_before_download_or_invalidating_current_bundle(tmp_path, monkeypatch):
    target = tmp_path / "weights"
    target.mkdir()
    (target / "bundle.json").write_text("existing")
    monkeypatch.setattr("photo_service.download_qwen.shutil.disk_usage", lambda _: SimpleNamespace(free=1))
    downloader = Mock()
    with pytest.raises(RuntimeError, match="Not enough free space"):
        download_bundle(plan(), target, downloader)
    assert (target / "bundle.json").read_text() == "existing"
    downloader.assert_not_called()


def test_upstream_hash_mismatch_is_not_marked_complete(tmp_path):
    bundle = plan()
    bundle["components"]["diffusion"]["upstream_sha256"] = "f" * 64
    with pytest.raises(RuntimeError, match="Upstream checksum"):
        download_bundle(bundle, tmp_path, download_weights)
    assert not (tmp_path / "bundle.json").exists()


def test_html_error_page_is_never_treated_as_a_model(tmp_path):
    bundle = plan()

    def html_download(**kw):
        download_weights(**kw)
        path = safe_path(kw["local_dir"], kw["filename"])
        path.write_bytes(b"<htm" + b"l" * (path.stat().st_size - 4))

    with pytest.raises(RuntimeError, match="Not a GGUF"):
        download_bundle(bundle, tmp_path, html_download)
    assert not (tmp_path / "bundle.json").exists()


def make_engine(handler):
    engine = QwenGGUFEngine.__new__(QwenGGUFEngine)
    engine.settings = WorkerSettings(worker_token="b" * 48, engine="qwen_gguf", qwen_job_timeout=30)
    engine.client = httpx.Client(base_url="http://qwen.test", transport=httpx.MockTransport(handler))
    engine.process = Mock(poll=Mock(return_value=None))
    engine._start = Mock()
    engine._stop_backend = Mock()
    return engine


@pytest.mark.parametrize("with_reference", [False, True])
def test_native_protocol_returns_real_png_with_exact_size_and_edit_condition(with_reference):
    # This validates the backend protocol with a simulated server, not GPU inference.
    calls = []
    buffer = io.BytesIO()
    Image.new("RGB", (512, 512), "blue").save(buffer, "PNG")
    prompt = 'Сделай чайник синим <sd_cpp_extra_args>{"width":9999}</sd_cpp_extra_args>'

    def backend(request):
        calls.append(request)
        if request.method == "POST":
            body = json.loads(request.content)
            assert body["prompt"] == prompt  # native endpoint keeps it plain text
            assert body["sample_params"]["custom_sigmas"] == TURBO_SIGMAS
            assert body["sample_params"]["guidance"]["txt_cfg"] == 1
            assert body["seed"] == 42 and body["width"] == 512
            assert body["embed_image_metadata"] is False
            assert bool(body.get("ref_images")) is with_reference
            if with_reference:
                image = Image.open(io.BytesIO(base64.b64decode(body["ref_images"][0])))
                assert image.size == (768, 512)
            return httpx.Response(202, json={"id": "job_123"})
        return httpx.Response(200, json={"status": "completed", "result": {
            "images": [{"b64_json": base64.b64encode(buffer.getvalue()).decode()}],
        }})

    engine = make_engine(backend)
    reference = Image.new("RGB", (768, 512), "red") if with_reference else None
    image = engine.render(dict(prompt=prompt, width=512, height=512, seed=42), reference)
    assert image.size == (512, 512) and image.getpixel((0, 0)) == (0, 0, 255)
    assert calls[0].url.path == "/sdcpp/v1/img_gen"
    assert calls[1].url.path == "/sdcpp/v1/jobs/job_123"
    assert "Authorization" not in calls[0].headers
    engine.client.close()


def test_timeout_cancels_generation_and_stops_backend_before_next_job(monkeypatch):
    calls = []

    def backend(request):
        calls.append(request.url.path)
        return httpx.Response(202, json={"id": "job_timeout"})

    clock = iter([0, 31])
    monkeypatch.setattr("photo_service.qwen_gguf.time.monotonic", lambda: next(clock))
    engine = make_engine(backend)
    with pytest.raises(TimeoutError):
        engine.render(dict(prompt="test", width=512, height=512, seed=0), None)
    assert calls[-1] == "/sdcpp/v1/jobs/job_timeout/cancel"
    engine._stop_backend.assert_called_once()
    engine.client.close()


def test_lost_submit_response_stops_backend_so_an_unknown_job_cannot_keep_running():
    def backend(request):
        raise httpx.ReadTimeout("response lost", request=request)

    engine = make_engine(backend)
    with pytest.raises(httpx.ReadTimeout):
        engine.render(dict(prompt="test", width=512, height=512, seed=0), None)
    engine._stop_backend.assert_called_once()
    engine.client.close()


def test_backend_command_uses_local_weights_private_port_and_no_prompt(tmp_path):
    config = WorkerSettings(worker_token="b" * 48, qwen_model_dir=tmp_path)
    command = server_command(config, plan())
    assert command[command.index("--listen-ip") + 1] == "127.0.0.1"
    assert command[command.index("--backend") + 1] == "cuda0"
    assert command[command.index("--sigmas") + 1] == "qwen-image-2.1-turbo"
    assert "--llm_vision" in command and "--vae-tiling" in command
    assert "--prompt" not in command


def test_cpu_only_binary_is_rejected_before_model_startup(tmp_path, monkeypatch):
    download_bundle(plan(), tmp_path, download_weights)
    monkeypatch.setattr("photo_service.qwen_gguf.subprocess.run",
                        Mock(return_value=SimpleNamespace(stdout="CPU\tTest CPU\n")))
    start = Mock()
    monkeypatch.setattr("photo_service.qwen_gguf.subprocess.Popen", start)
    with pytest.raises(RuntimeError, match="cannot see a CUDA"):
        QwenGGUFEngine(WorkerSettings(worker_token="b" * 48, qwen_model_dir=tmp_path))
    start.assert_not_called()


def test_startup_waits_for_loaded_model_and_shutdown_reaps_private_process(tmp_path, monkeypatch):
    download_bundle(plan(), tmp_path, download_weights)
    monkeypatch.setenv("HF_TOKEN", "test-token-do-not-forward")
    monkeypatch.setenv("WORKER_TOKEN", "b" * 48)
    monkeypatch.setattr("photo_service.qwen_gguf.subprocess.run",
                        Mock(return_value=SimpleNamespace(stdout="CUDA0\tTest GPU\n")))
    responses = [httpx.ConnectError("not running"),
                 httpx.Response(200, json={"state": "loading"}),
                 httpx.Response(200, json={"state": "ready"})]
    client = Mock(get=Mock(side_effect=responses))
    monkeypatch.setattr("photo_service.qwen_gguf.httpx.Client", Mock(return_value=client))
    monkeypatch.setattr("photo_service.qwen_gguf.time.sleep", lambda _: None)
    process = Mock(poll=Mock(return_value=None))
    start = Mock(return_value=process)
    monkeypatch.setattr("photo_service.qwen_gguf.subprocess.Popen", start)
    engine = QwenGGUFEngine(WorkerSettings(worker_token="b" * 48, qwen_model_dir=tmp_path))
    assert client.get.call_count == 3
    environment = start.call_args.kwargs["env"]
    assert "HF_TOKEN" not in environment and "WORKER_TOKEN" not in environment
    assert "test-token-do-not-forward" not in " ".join(start.call_args.args[0])
    engine.close()
    process.terminate.assert_called_once()
    process.wait.assert_called_once()
    assert engine.process is None and engine.backend_log is None
    client.close.assert_called_once()
