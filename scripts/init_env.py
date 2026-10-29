"""Create private local tokens without printing or replacing existing configuration."""
import os
import secrets
from pathlib import Path

target = Path(".env")
try:
    descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
except FileExistsError:
    print(".env already exists; preserved")
else:
    with os.fdopen(descriptor, "w") as stream:
        stream.write(
            f"API_TOKEN={secrets.token_urlsafe(36)}\n"
            f"WORKER_TOKEN={secrets.token_urlsafe(36)}\n"
            "DATA_DIR=./data\nCONTROL_URL=http://127.0.0.1:8000\nENGINE=mock\n"
            "MODEL_DIR=./models/flux2-klein-4b\nMODEL_CPU_OFFLOAD=true\n"
        )
    print("Created .env (mode 0600); tokens were not printed")
