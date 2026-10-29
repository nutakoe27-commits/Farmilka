#!/bin/sh
# Usage: sh scripts/package.sh /tmp/photo-service.tar.gz
set -eu
destination=${1:?Provide an archive path outside the project}
case "$destination" in /tmp/*) ;; *) echo 'Use an absolute /tmp/... archive path' >&2; exit 1 ;; esac
tar --exclude='./.git' --exclude='./.venv' --exclude='./.env' --exclude='./.env.*' \
    --exclude='./data' --exclude='./models' --exclude='./dist' \
    --exclude='./.pytest_cache' --exclude='__pycache__' --exclude='*.log' \
    -czf "$destination" .
printf 'Project archive created: %s\n' "$destination"
