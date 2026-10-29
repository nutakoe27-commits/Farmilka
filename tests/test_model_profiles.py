import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from PIL import Image

from photo_service.download_model import download_snapshot
from photo_service.flux_lora import FluxLoraEngine, generation_kwargs
from photo_service.model_files import (
    FLUX1_PATTERNS, FLUX1_REPO, HEARTSYNC_REPO, HEARTSYNC_REVISION,
    KLEIN_REPO, LORA_FILENAME, LORA_PATTERNS, read_manifest,
)
from photo_service.settings import WorkerSettings


def settings(**kwargs):
    return WorkerSettings(worker_token="b" * 48, **kwargs)


def fake_api(sha="a" * 40):
    return Mock(model_info=Mock(return_value=SimpleNamespace(sha=sha, siblings=[
        SimpleNamespace(rfilename="model_index.json", size=10),
        SimpleNamespace(rfilename="transformer/model.safetensors", size=100),
        SimpleNamespace(rfilename="text_encoder_2/model.safetensors", size=100),
        # A root checkpoint and pickle weights must not contribute to download size.
        SimpleNamespace(rfilename="flux1-dev.safetensors", size=10**15),
        SimpleNamespace(rfilename="transformer/model.bin", size=10**15),
    ])))


def write_marker(**kwargs):
    (kwargs["local_dir"] / "model_index.json").write_text("{}")


def test_snapshot_pins_revision_and_restarts_offline(tmp_path):
    api = fake_api()
    download = Mock(side_effect=write_marker)
    first = download_snapshot(api, download, FLUX1_REPO, tmp_path, FLUX1_PATTERNS)
    assert first["revision"] == "a" * 40
    assert download.call_args.kwargs["revision"] == "a" * 40
    assert "text_encoder_2/*" in download.call_args.kwargs["allow_patterns"]
    api.model_info.side_effect = RuntimeError("offline")
    assert download_snapshot(api, download, FLUX1_REPO, tmp_path, FLUX1_PATTERNS) == first
    assert download.call_count == 1


def test_incomplete_download_has_no_ready_manifest(tmp_path):
    download = Mock(side_effect=RuntimeError("network interrupted"))
    with pytest.raises(RuntimeError, match="network interrupted"):
        download_snapshot(fake_api(), download, FLUX1_REPO, tmp_path, FLUX1_PATTERNS)
    assert not (tmp_path / "download-manifest.json").exists()


def test_failed_revision_change_invalidates_the_old_completion_marker(tmp_path):
    (tmp_path / "download-manifest.json").write_text(json.dumps({
        "repo_id": FLUX1_REPO, "revision": "a" * 40,
    }))
    (tmp_path / "model_index.json").write_text("{}")
    with pytest.raises(RuntimeError, match="interrupted"):
        download_snapshot(fake_api("b" * 40), Mock(side_effect=RuntimeError("interrupted")),
                          FLUX1_REPO, tmp_path, FLUX1_PATTERNS, revision="b" * 40)
    assert not (tmp_path / "download-manifest.json").exists()


def test_cannot_overwrite_the_working_klein_model(tmp_path):
    (tmp_path / "download-manifest.json").write_text(json.dumps({"repo_id": KLEIN_REPO}))
    api, download = fake_api(), Mock()
    with pytest.raises(RuntimeError, match="different model"):
        download_snapshot(api, download, FLUX1_REPO, tmp_path, FLUX1_PATTERNS)
    download.assert_not_called()
    api.model_info.assert_not_called()


def test_lora_uses_its_exact_revision_and_weight_file(tmp_path):
    api = Mock(model_info=Mock(return_value=SimpleNamespace(
        sha=HEARTSYNC_REVISION,
        siblings=[SimpleNamespace(rfilename=LORA_FILENAME, size=100)],
    )))
    download = Mock(side_effect=lambda **kw: (kw["local_dir"] / LORA_FILENAME).write_bytes(b"test"))
    download_snapshot(api, download, HEARTSYNC_REPO, tmp_path, LORA_PATTERNS,
                      revision=HEARTSYNC_REVISION, marker=LORA_FILENAME)
    assert api.model_info.call_args.kwargs["revision"] == HEARTSYNC_REVISION
    assert read_manifest(tmp_path, HEARTSYNC_REPO, marker=LORA_FILENAME)["revision"] == HEARTSYNC_REVISION


def test_wrong_or_missing_weight_file_is_not_marked_ready(tmp_path):
    with pytest.raises(RuntimeError, match="no completion manifest"):
        download_snapshot(fake_api(), Mock(), FLUX1_REPO, tmp_path, FLUX1_PATTERNS)
    assert not (tmp_path / "download-manifest.json").exists()


def test_disk_space_check_precedes_large_download(tmp_path, monkeypatch):
    monkeypatch.setattr("photo_service.download_model.shutil.disk_usage",
                        lambda _: SimpleNamespace(free=1))
    download = Mock()
    with pytest.raises(RuntimeError, match="Not enough free disk space"):
        download_snapshot(fake_api(), download, FLUX1_REPO, tmp_path, FLUX1_PATTERNS)
    download.assert_not_called()


def test_flux1_uses_its_sampling_parameters_and_reference_strength():
    config = settings(engine="flux_lora")
    job = dict(prompt="A blue teapot", width=512, height=512, seed=42)
    text = generation_kwargs(config, job, None)
    assert text["num_inference_steps"] == 28
    assert text["guidance_scale"] == 3.5
    assert "image" not in text and "strength" not in text
    reference = Image.new("RGB", (512, 512))
    edit = generation_kwargs(config, job, reference)
    assert edit["image"] is reference
    assert edit["strength"] == 0.65


def test_shared_pipelines_transfer_cpu_offload_hooks_once():
    engine = FluxLoraEngine.__new__(FluxLoraEngine)
    engine.settings = settings()
    engine.active_pipe = None
    text, image = Mock(), Mock()
    engine._activate(text)
    engine._activate(text)
    text.enable_model_cpu_offload.assert_called_once()
    engine._activate(image)
    text.remove_all_hooks.assert_called_once()
    image.enable_model_cpu_offload.assert_called_once()
    engine._activate(text)
    image.remove_all_hooks.assert_called_once()


@pytest.mark.parametrize("values", [dict(lora_scale=3), dict(flux1_img2img_strength=0),
                                    dict(flux1_steps=0)])
def test_invalid_flux1_settings_rejected(values):
    with pytest.raises(ValueError):
        settings(**values)
