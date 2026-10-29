#!/bin/sh
set -eu
python -m photo_service.download_model
exec python -m photo_service.worker
