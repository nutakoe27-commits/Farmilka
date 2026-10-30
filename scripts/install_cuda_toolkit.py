"""Install a pinned CUDA 12.8 toolchain in an isolated directory, without a driver."""
import argparse
import hashlib
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ARCHIVES = (
    ("cuda_nvcc", "cuda_nvcc-linux-x86_64-12.8.93-archive.tar.xz", "9961b3484b6b71314063709a4f9529654f96782ad39e72bf1e00f070db8210d3"),
    ("cuda_cudart", "cuda_cudart-linux-x86_64-12.8.90-archive.tar.xz", "8d566b5fe745c46842dc16945cf36686227536decd2302c372be86da37faca68"),
    ("cuda_cccl", "cuda_cccl-linux-x86_64-12.8.90-archive.tar.xz", "0740e9e01e4f15e17c5ab8d68bba4f8ec0eb6b84edccba4ac45112d2d2174e4b"),
    ("libcublas", "libcublas-linux-x86_64-12.8.4.1-archive.tar.xz", "21718957c2cf000bacd69d36c95708a2319199e39e056f8b4f0f68e3b9f323bb"),
)


def patch_glibc_math_header(prefix: Path):
    """Match modern glibc's noexcept declarations for six CUDA math functions.

    The downloaded archive is verified before extraction. This explicit local
    source compatibility patch does not change implementation or verification.
    """
    path = prefix / "include/crt/math_functions.h"
    text = path.read_text()
    marker = "#define __MATH_FUNCTIONS_H__\n"
    if text.count(marker) != 1:
        raise RuntimeError("Unexpected CUDA math header: no safe patch applied")
    text = text.replace(marker, marker + "\n#ifdef __cplusplus\n"
                        "#define PHOTO_CUDA_MATH_NOEXCEPT noexcept\n#else\n"
                        "#define PHOTO_CUDA_MATH_NOEXCEPT\n#endif\n", 1)
    for name, kind in (("sinpi", "double"), ("cospi", "double"),
                       ("sinpif", "float"), ("cospif", "float"),
                       ("rsqrt", "double"), ("rsqrtf", "float")):
        old = f"{name}({kind} x);"
        if text.count(old) != 1:
            raise RuntimeError(f"Unexpected CUDA math header: cannot safely patch {name}")
        text = text.replace(old, f"{name}({kind} x) PHOTO_CUDA_MATH_NOEXCEPT;", 1)
    path.write_text(text)


def digest(path: Path) -> str:
    sha = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            sha.update(chunk)
    return sha.hexdigest()


def fetch(component: str, filename: str, expected: str, cache: Path) -> Path:
    path = cache / filename
    if path.is_file() and digest(path) == expected:
        print(f"Using verified archive: {filename}", flush=True)
        return path
    partial = cache / (filename + ".partial")
    url = f"https://developer.download.nvidia.com/compute/cuda/redist/{component}/linux-x86_64/{filename}"
    print(f"Downloading {filename}", flush=True)
    sha, last = hashlib.sha256(), time.monotonic()
    try:
        with urllib.request.urlopen(url, timeout=120) as response, partial.open("wb") as out:
            total = int(response.headers.get("Content-Length", "0"))
            received = 0
            while chunk := response.read(4 * 1024 * 1024):
                out.write(chunk)
                sha.update(chunk)
                received += len(chunk)
                if time.monotonic() - last > 10:
                    print(f"  {received / 1024**2:.0f} MiB / {total / 1024**2:.0f} MiB", flush=True)
                    last = time.monotonic()
        if sha.hexdigest() != expected:
            raise RuntimeError(f"SHA256 mismatch for {filename}")
        partial.replace(path)
    finally:
        partial.unlink(missing_ok=True)
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--prefix", type=Path, default=Path("/opt/photo-toolchain/cuda-12.8.1"))
    parser.add_argument("--cache", type=Path, default=Path("/opt/photo-toolchain/downloads"))
    args = parser.parse_args()
    if sys.platform != "linux" or os.uname().machine != "x86_64":
        raise SystemExit("This pinned toolchain is for Linux x86_64 only")
    if not shutil.which("tar") or not shutil.which("xz"):
        raise SystemExit("Install tar and xz-utils first")
    args.prefix.mkdir(parents=True, exist_ok=True)
    args.cache.mkdir(parents=True, exist_ok=True)
    marker = args.prefix / ".photo-cuda-12.8.1"
    if any(args.prefix.iterdir()) and not marker.is_file():
        raise SystemExit(f"Refusing to modify existing non-empty directory: {args.prefix}")
    if shutil.disk_usage(args.prefix).free < 8 * 1024**3:
        raise SystemExit("At least 8 GiB free is required for the CUDA toolkit and archives")
    marker.touch(exist_ok=True)
    for component, filename, expected in ARCHIVES:
        archive = fetch(component, filename, expected, args.cache)
        print(f"Extracting {component}", flush=True)
        command = ["tar", "--extract", "--xz", "--file", str(archive),
                   "--directory", str(args.prefix), "--strip-components=1"]
        if component == "libcublas":
            command += ["--exclude=*/lib/libcublas_static.a", "--exclude=*/lib/libcublasLt_static.a"]
        subprocess.run(command, check=True)
    lib64 = args.prefix / "lib64"
    if not lib64.exists():
        lib64.symlink_to("lib")
    elif not lib64.samefile(args.prefix / "lib"):
        raise RuntimeError("Unexpected lib64 directory in the CUDA prefix")
    patch_glibc_math_header(args.prefix)
    print("Applied explicit CUDA C++ declaration compatibility patch for modern glibc")
    executable = args.prefix / "bin/nvcc"
    subprocess.run([str(executable), "--version"], check=True)
    print(f"Pinned CUDA 12.8 toolkit installed at {args.prefix}; no GPU driver was changed")


if __name__ == "__main__":
    main()
