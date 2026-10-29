"""Securely supply HF authentication to the short-lived downloader container."""
import getpass
import os
import subprocess
from pathlib import Path

COMPOSE = ["docker", "compose", "-f", "compose.yaml", "-f", "compose.flux-lora.yaml", "--profile", "gpu"]


def main():
    os.chdir(Path(__file__).resolve().parent.parent)
    command = [*COMPOSE, "run", "--rm", "--no-deps"]
    environment = os.environ.copy()
    if environment.get("HF_TOKEN"):
        command += ["-e", "HF_TOKEN"]
    else:
        probe = subprocess.run(
            [*command, "gpu-worker", "python", "-c",
             "import os; print('present' if os.environ.get('HF_TOKEN') else 'missing')"],
            capture_output=True, text=True,
        )
        if probe.returncode:
            print(probe.stderr)
            return probe.returncode
        if probe.stdout.strip() != "present":
            token = getpass.getpass("Hugging Face read token (hidden, not saved): ").strip()
            if not token:
                print("No token supplied; download was not started")
                return 1
            environment["HF_TOKEN"] = token
            command += ["-e", "HF_TOKEN"]
    command += ["gpu-worker", "python", "-m", "photo_service.download_model", "--engine", "flux_lora"]
    return subprocess.call(command, env=environment)


if __name__ == "__main__":
    raise SystemExit(main())
