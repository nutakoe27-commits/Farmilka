#!/bin/sh
# CPU setup, or pass --gpu on the rented NVIDIA machine. Never runs inference itself.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
export UV_CACHE_DIR="${UV_CACHE_DIR:-/workspace/.cache/uv}"
export UV_PYTHON_INSTALL_DIR="${UV_PYTHON_INSTALL_DIR:-/workspace/.cache/python}"
if ! command -v uv >/dev/null 2>&1; then
    python3 -m venv /workspace/photo-bootstrap
    /workspace/photo-bootstrap/bin/pip install uv==0.12.23
    export PATH="/workspace/photo-bootstrap/bin:$PATH"
fi
case "${1:-}" in
    --gpu) uv sync --frozen --no-dev --extra gpu ;;
    '') uv sync --frozen ;;
    *) echo 'Usage: sh scripts/bootstrap.sh [--gpu]' >&2; exit 1 ;;
esac
.venv/bin/python scripts/init_env.py
