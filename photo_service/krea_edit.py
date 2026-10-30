"""Optional reference-image editing for LUSTIFY Krea Turbo."""
import base64
import io
import json
from pathlib import Path

from .krea import KreaEngine, generation_payload, read_bundle, server_command
from .qwen_bundle import check_format, file_hash

REPO = "conradlocke/krea2-identity-edit"
REVISION = "f33b26291c640e8ec50b0da420bfee3c9a660daa"
FILENAME = "krea2_identity_edit_v1_2.safetensors"
BYTES = 1828256432
SHA256 = "6adf9a69cc9502d286db7b69964d37da7e9cfe4b05b4d004bc275f087d3fd3cf"


def manifest():
    return {"schema": 1, "repo_id": REPO, "revision": REVISION, "filename": FILENAME,
            "bytes": BYTES, "sha256": SHA256}


def read_edit_bundle(directory: Path, *, verify=False):
    marker = directory / "bundle.json"
    if not marker.is_file() or json.loads(marker.read_text()) != manifest():
        raise RuntimeError("Krea edit adapter is missing or its metadata is unexpected")
    path = directory / "lora" / FILENAME
    if not path.is_file() or path.stat().st_size != BYTES:
        raise RuntimeError("Krea edit adapter file is missing or incomplete")
    check_format(path)
    if verify and file_hash(path) != SHA256:
        raise RuntimeError("Krea edit adapter SHA256 mismatch")
    return path


def edit_generation_payload(job, reference):
    payload = generation_payload(job, None)
    if reference is not None:
        buffer = io.BytesIO()
        reference.save(buffer, "PNG")
        payload["ref_images"] = [base64.b64encode(buffer.getvalue()).decode("ascii")]
        payload["ref_image_args"] = "preset=krea2_edit"
        payload["lora"] = [{"path": FILENAME, "multiplier": 1.0, "is_high_noise": False}]
    return payload


class KreaEditEngine(KreaEngine):
    backend_label = "LUSTIFY Krea Edit"
    ready_message = "LUSTIFY Krea backend and edit adapter are ready for testing"

    def load_bundle(self):
        read_edit_bundle(self.settings.krea_edit_dir)
        return read_bundle(self.settings.krea_model_dir)

    def make_server_command(self):
        return server_command(self.settings, self.bundle) + [
            "--lora-model-dir", str(self.settings.krea_edit_dir / "lora"),
            "--lora-apply-mode", "at_runtime",
        ]

    def make_generation_payload(self, job, reference):
        return edit_generation_payload(job, reference)
