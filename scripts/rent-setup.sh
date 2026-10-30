#!/usr/bin/env bash
# Set up the selected photo service on a fresh NVIDIA rental and start it.
# Usage: bash rent-setup.sh [--local|--cloud]
set -euo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage: bash rent-setup.sh [--local|--cloud]

--local  Use this rental's /opt storage (default; it may disappear).
--cloud  Use an already mounted /workspace cloud volume.

Installs the selected LUSTIFY V10 model and editing adapter, then starts the
private API and worker. Fresh installation downloads dependencies and weights.
Re-running on a retained, complete installation reuses its existing files.
Only Linux x86_64 with an RTX 3090/3090 Ti and Ubuntu apt repositories is
currently supported. The NVIDIA driver must already be installed.
EOF
}

fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
mode=${1:---local}
[[ $# -le 1 ]] || { usage; exit 2; }
case "$mode" in --local|--cloud) ;; -h|--help) usage; exit 0 ;; *) usage; exit 2 ;; esac
[[ "$(id -u)" == 0 ]] || fail 'Run this script as root on the rented server.'
[[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || fail 'A Linux x86_64 server is required.'
command -v apt-get >/dev/null && command -v python3 >/dev/null && command -v nvidia-smi >/dev/null || fail 'Ubuntu apt, Python 3 and an installed NVIDIA driver are required.'
gpu=$(nvidia-smi --query-gpu=name --format=csv,noheader) || fail 'The NVIDIA GPU is not available.'
[[ "$gpu" == *'RTX 3090'* ]] || fail 'This setup currently targets an RTX 3090 or 3090 Ti.'
printf 'GPU detected: %s\n' "$gpu"

if [[ "$mode" == --cloud ]]; then
  command -v findmnt >/dev/null || fail 'findmnt is required for cloud mode.'
  [[ "$(findmnt -rn -M /workspace -o TARGET)" == /workspace ]] || fail '/workspace is not a distinct mounted volume. Attach it first.'
  project=/workspace/photo-service
  toolchain=/workspace/photo-toolchain
else
  project=/opt/photo-service
  toolchain=/opt/photo-toolchain
fi

link_or_check() {
  local target=$1 link=$2
  if [[ -L "$link" ]]; then
    [[ "$(readlink -f "$link")" == "$(readlink -f "$target")" ]] || fail "Unexpected symlink: $link"
  elif [[ -e "$link" ]]; then
    fail "Refusing to overwrite existing path: $link"
  else
    ln -s "$target" "$link"
  fi
}

setup_marker="$toolchain/.photo-rent-setup"
if [[ -e "$project" || -L "$project" || -e "$toolchain" || -L "$toolchain" ]]; then
  [[ -f "$setup_marker" ]] || fail 'An existing installation is not owned by this script; it was left unchanged.'
  if [[ -e "$project" && ! -d "$project/.git" && -n "$(ls -A "$project")" ]]; then
    fail 'Project directory is not empty and is not a Git checkout; it was left unchanged.'
  fi
else
  mkdir -p "$toolchain"
  printf 'photo-rent-setup-v1\n' >"$setup_marker"
fi

if command -v pgrep >/dev/null && pgrep -f '[p]hoto_service[.]worker|[u]vicorn.*photo_service[.]api' >/dev/null; then
  fail 'A photo API or worker is already running. Stop it before starting another.'
fi

if [[ "$mode" == --cloud ]]; then
  mkdir -p /opt
  link_or_check "$toolchain" /opt/photo-toolchain
  # Create the target before making the symlink, so the link can be checked on reruns.
  if [[ ! -e "$project" && ! -L "$project" ]]; then mkdir -p "$project"; fi
  link_or_check "$project" /opt/photo-service
else
  mkdir -p /opt
fi

state=/opt/photo-toolchain/.photo-setup-state
mkdir -p "$state"
if [[ ! -f "$state/python-ready" ]]; then
  available=$(df -Pk /opt/photo-toolchain | awk 'NR==2 {print $4}')
  [[ "$available" =~ ^[0-9]+$ ]] && (( available >= 45 * 1024 * 1024 )) || fail 'At least 45 GiB of free space is required for a fresh install.'
fi
need_system=false
for command in git gcc-14 g++-14 make cmake xz tar pgrep findmnt; do
  if ! command -v "$command" >/dev/null 2>&1; then need_system=true; fi
done
if ! dpkg-query -W -f='${Status}' python3-venv 2>/dev/null | grep -q 'install ok installed'; then
  need_system=true
fi
if [[ "$need_system" == true ]]; then
  printf '\nInstalling system build tools (no NVIDIA driver changes)...\n'
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get -o DPkg::Lock::Timeout=300 install -y --no-install-recommends \
    git gcc-14 g++-14 make cmake python3-venv xz-utils ca-certificates tar procps util-linux
fi

if [[ ! -d /opt/photo-service/.git ]]; then
  if [[ -d /opt/photo-service ]] && [[ -n "$(ls -A /opt/photo-service)" ]]; then
    fail 'Project directory is not empty; refusing to replace it.'
  fi
  printf '\nDownloading project code from GitHub main...\n'
  git clone --branch main --single-branch https://github.com/nutakoe27-commits/Farmilka.git /opt/photo-service
fi
cd /opt/photo-service
[[ "$(git remote get-url origin)" == https://github.com/nutakoe27-commits/Farmilka.git ]] || fail 'Unexpected project repository.'

if [[ ! -f "$state/python-ready" || ! -x .venv/bin/python ]]; then
  printf '\nInstalling Python and project dependencies...\n'
  if [[ ! -x /opt/photo-toolchain/bootstrap/bin/uv ]]; then
    python3 -m venv /opt/photo-toolchain/bootstrap
    /opt/photo-toolchain/bootstrap/bin/python -m pip install uv==0.12.23
  fi
  export UV_CACHE_DIR=/opt/photo-toolchain/uv-cache
  export UV_PYTHON_INSTALL_DIR=/opt/photo-toolchain/python
  /opt/photo-toolchain/bootstrap/bin/uv python install 3.12
  /opt/photo-toolchain/bootstrap/bin/uv sync --frozen --no-dev --extra qwen
  touch "$state/python-ready"
fi
.venv/bin/python scripts/init_env.py
chmod 600 .env

if [[ ! -f "$state/cuda-ready" ]]; then
  if [[ -x /opt/photo-toolchain/cuda-12.8.1/bin/nvcc ]] &&
     [[ -f /opt/photo-toolchain/cuda-12.8.1/include/crt/math_functions.h ]] &&
     grep -q PHOTO_CUDA_MATH_NOEXCEPT /opt/photo-toolchain/cuda-12.8.1/include/crt/math_functions.h &&
     compgen -G '/opt/photo-toolchain/cuda-12.8.1/lib/libcublas.so*' >/dev/null &&
     compgen -G '/opt/photo-toolchain/cuda-12.8.1/lib/libcudart.so*' >/dev/null; then
    printf '\nReusing the existing pinned CUDA toolkit.\n'
  else
    printf '\nInstalling the pinned CUDA toolkit (driver remains unchanged)...\n'
    python3 scripts/install_cuda_toolkit.py
  fi
  touch "$state/cuda-ready"
fi
if [[ ! -f "$state/backend-ready" || ! -x /opt/photo-toolchain/stable-diffusion.cpp/build-photo/bin/sd-server ]]; then
  printf '\nBuilding the GPU engine; this can take several minutes...\n'
  sh scripts/build_qwen_native.sh
  touch "$state/backend-ready"
fi

export LD_LIBRARY_PATH="/opt/photo-toolchain/cuda-12.8.1/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export QWEN_SERVER_BINARY=/opt/photo-toolchain/stable-diffusion.cpp/build-photo/bin/sd-server
export KREA_MODEL_DIR=/opt/photo-service/models/lustify-krea
export KREA_EDIT_DIR=/opt/photo-service/models/lustify-krea-edit
printf '\nChecking GPU access...\n'
.venv/bin/python -m scripts.qwen_probe

printf '\nPreparing LUSTIFY V10 Turbo FP8 and the edit adapter...\n'
printf 'If Civitai requests a token, enter it privately at the hidden prompt.\n'
.venv/bin/python -m photo_service.download_krea
.venv/bin/python -m photo_service.download_krea_edit

if pgrep -f '[p]hoto_service[.]worker|[u]vicorn.*photo_service[.]api' >/dev/null; then
  fail 'A photo API or worker is already running. Stop it before using this script to start another.'
fi
.venv/bin/python -c 'import socket; sockets=[]
for port in (8000, 1234):
 s=socket.socket(); s.bind(("127.0.0.1", port)); sockets.append(s)
print("API and GPU backend ports: available")' || fail 'Required local ports are busy.'

run_dir=$(mktemp -d /opt/photo-toolchain/photo-run-XXXXXXXX)
printf '\nStarting API and GPU worker...\n'
nohup .venv/bin/python -m uvicorn photo_service.api:create_app --factory \
  --host 127.0.0.1 --port 8000 --no-access-log </dev/null >>"$run_dir/api.log" 2>&1 &
api_pid=$!
api_ready=false
for ((attempt=1; attempt<=30; attempt++)); do
  if .venv/bin/python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8000/healthz", timeout=1).close()' 2>/dev/null; then
    api_ready=true
    break
  fi
  if ! kill -0 "$api_pid" 2>/dev/null; then fail "API exited; inspect $run_dir/api.log"; fi
  sleep 1
done
[[ "$api_ready" == true ]] || fail "API did not become ready; inspect $run_dir/api.log"
nohup env ENGINE=lustify_krea_edit .venv/bin/python -m photo_service.worker \
  </dev/null >>"$run_dir/worker.log" 2>&1 &
worker_pid=$!
printf '%s\n' "$api_pid" >"$run_dir/api.pid"
printf '%s\n' "$worker_pid" >"$run_dir/worker.pid"
for ((attempt=1; attempt<=600; attempt++)); do
  if grep -q 'Engine ready: lustify_krea_edit' "$run_dir/worker.log"; then
    printf '\nAPI and worker are ready. Local URL: http://127.0.0.1:8000\n'
    printf 'Image generation must still be tested on this GPU.\n'
    printf 'API log: %s/api.log\nWorker log: %s/worker.log\n' "$run_dir" "$run_dir"
    printf 'On your Mac, open an SSH tunnel to port 8000 to use the browser.\n'
    exit 0
  fi
  if ! kill -0 "$worker_pid" 2>/dev/null; then
    fail "Worker exited; inspect $run_dir/worker.log"
  fi
  if (( attempt % 10 == 0 )); then printf 'Still loading model...\n'; fi
  sleep 2
done
fail "Worker did not become ready within 20 minutes; inspect $run_dir/worker.log"
