#!/bin/sh
# All Qwen operations use the same Compose overlay and project name/volumes.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
exec docker compose -f compose.yaml -f compose.qwen-gguf.yaml --profile gpu "$@"
