"""Run the exact pinned model command in foreground, without API credentials."""
import os
import subprocess

from photo_service.qwen_bundle import read_bundle
from photo_service.qwen_gguf import server_command
from photo_service.settings import WorkerSettings

settings = WorkerSettings()
command = server_command(settings, read_bundle(settings.qwen_model_dir))
command[command.index("--log-level") + 1] = "info"
environment = os.environ.copy()
for name in ("API_TOKEN", "WORKER_TOKEN", "HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"):
    environment.pop(name, None)
raise SystemExit(subprocess.call(command, env=environment))
