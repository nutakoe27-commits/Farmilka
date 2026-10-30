#!/bin/sh
# Build the pinned local Qwen backend inside an existing NVIDIA GPU container.
set -eu
toolchain=${PHOTO_CUDA_DIR:-/opt/photo-toolchain/cuda-12.8.1}
source_dir=${PHOTO_SDCPP_DIR:-/opt/photo-toolchain/stable-diffusion.cpp}
build_dir=${PHOTO_SDCPP_BUILD_DIR:-$source_dir/build-photo}
jobs=${PHOTO_BUILD_JOBS:-4}
revision=e239e4b0fd3de49834cec67031a44796ca465abc
remote=https://github.com/leejet/stable-diffusion.cpp.git

for tool in git cmake gcc-14 g++-14 make; do
    if ! command -v "$tool" >/dev/null 2>&1; then
        echo "Required command missing: $tool" >&2
        exit 1
    fi
done
if [ ! -x "$toolchain/bin/nvcc" ]; then
    echo "CUDA compiler missing; first run scripts/install_cuda_toolkit.py" >&2
    exit 1
fi
if [ ! -d "$source_dir/.git" ]; then
    if [ -e "$source_dir" ]; then
        echo "Refusing to overwrite existing directory: $source_dir" >&2
        exit 1
    fi
    mkdir -p "$(dirname "$source_dir")"
    git init "$source_dir"
    git -C "$source_dir" remote add origin "$remote"
fi
if [ "$(git -C "$source_dir" remote get-url origin)" != "$remote" ]; then
    echo "Unexpected source remote in $source_dir" >&2
    exit 1
fi
if ! git -C "$source_dir" rev-parse --verify HEAD >/dev/null 2>&1; then
    git -C "$source_dir" fetch --depth 1 origin "$revision"
    git -C "$source_dir" checkout --detach FETCH_HEAD
fi
if [ "$(git -C "$source_dir" rev-parse HEAD)" != "$revision" ]; then
    echo "Unexpected source revision; refusing to change existing checkout" >&2
    exit 1
fi
git -C "$source_dir" submodule update --init --recursive --depth 1 ggml
export CC="$(command -v gcc-14)" CXX="$(command -v g++-14)"
export CUDACXX="$toolchain/bin/nvcc"
export LD_LIBRARY_PATH="$toolchain/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
cmake -S "$source_dir" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release \
    -DSD_CUDA=ON -DCMAKE_CUDA_ARCHITECTURES=86 -DGGML_NATIVE=OFF \
    -DSD_SERVER_BUILD_FRONTEND=OFF -DSD_WEBP=OFF -DSD_WEBM=OFF \
    -DCUDAToolkit_ROOT="$toolchain" -DCMAKE_CUDA_HOST_COMPILER="$CXX"
cmake --build "$build_dir" --target sd-server --parallel "$jobs"
echo "Built $build_dir/bin/sd-server; GPU inference must still be tested"
