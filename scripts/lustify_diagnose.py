"""Run the pinned SDXL backend in foreground for model-load diagnostics."""
import os
import subprocess

from photo_service.lustify import read_lustify_manifest, server_command
from photo_service.settings import WorkerSettings

settings = WorkerSettings()
command = server_command(settings, read_lustify_manifest(settings.lustify_model_dir))
command[command.index("--log-level") + 1] = "info"
environment = os.environ.copy()
for name in ("API_TOKEN", "WORKER_TOKEN", "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "CIVITAI_TOKEN"):
    environment.pop(name, None)
raise SystemExit(subprocess.call(command, env=environment))
