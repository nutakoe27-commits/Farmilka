from types import SimpleNamespace
from unittest.mock import Mock

from scripts import download_flux_lora


def test_host_token_is_forwarded_by_name_without_prompt(monkeypatch):
    monkeypatch.setenv("HF_TOKEN", "hf_test_only")
    prompt = Mock(side_effect=AssertionError("Unexpected prompt"))
    monkeypatch.setattr(download_flux_lora.getpass, "getpass", prompt)
    call = Mock(return_value=0)
    monkeypatch.setattr(download_flux_lora.subprocess, "call", call)
    assert download_flux_lora.main() == 0
    args, kwargs = call.call_args
    assert "hf_test_only" not in args[0]
    assert kwargs["env"]["HF_TOKEN"] == "hf_test_only"
    assert args[0][args[0].index("-e") + 1] == "HF_TOKEN"


def test_existing_container_binding_is_reused(monkeypatch):
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.setattr(download_flux_lora.subprocess, "run", Mock(return_value=SimpleNamespace(
        returncode=0, stdout="present\n", stderr="",
    )))
    monkeypatch.setattr(download_flux_lora.getpass, "getpass",
                        Mock(side_effect=AssertionError("Unexpected duplicate credential request")))
    call = Mock(return_value=0)
    monkeypatch.setattr(download_flux_lora.subprocess, "call", call)
    assert download_flux_lora.main() == 0
    assert "-e" not in call.call_args.args[0]


def test_hidden_token_is_not_logged_and_child_exit_status_is_preserved(monkeypatch, capsys):
    monkeypatch.delenv("HF_TOKEN", raising=False)
    monkeypatch.setattr(download_flux_lora.subprocess, "run", Mock(return_value=SimpleNamespace(
        returncode=0, stdout="missing\n", stderr="",
    )))
    monkeypatch.setattr(download_flux_lora.getpass, "getpass", Mock(return_value="hf_private_test_value"))
    call = Mock(return_value=19)
    monkeypatch.setattr(download_flux_lora.subprocess, "call", call)
    assert download_flux_lora.main() == 19
    assert call.call_args.kwargs["env"]["HF_TOKEN"] == "hf_private_test_value"
    assert "hf_private_test_value" not in " ".join(call.call_args.args[0])
    assert "hf_private_test_value" not in capsys.readouterr().out
