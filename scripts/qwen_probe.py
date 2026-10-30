"""CUDA visibility and required CLI features; this does not test model inference."""
import subprocess

from photo_service.settings import WorkerSettings

settings = WorkerSettings()
binary = str(settings.qwen_server_binary)
devices = subprocess.run([binary, "--list-devices"], capture_output=True, text=True, timeout=30, check=True)
print(devices.stdout.strip())
if "cuda" not in devices.stdout.lower():
    raise SystemExit("FAIL: stable-diffusion.cpp cannot see a CUDA device")
help_result = subprocess.run([binary, "--help"], capture_output=True, text=True, timeout=30, check=True)
for option in ("--llm_vision", "--diffusion-model", "--sigmas", "--listen-port", "--backend"):
    if option not in help_result.stdout:
        raise SystemExit(f"FAIL: backend is missing {option}")
print("CUDA device and Qwen CLI options: PASS (model generation is not tested)")
