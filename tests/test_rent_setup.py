import os
import signal
import subprocess
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "rent-setup.sh"


def run(*args, env=None):
    return subprocess.run(["bash", str(SCRIPT), *args], text=True, capture_output=True, env=env, timeout=10)


def fake_environment(tmp_path, gpu="NVIDIA GeForce RTX 3090", mount=""):
    commands = tmp_path / "commands"
    commands.mkdir()
    for name, result in {"id": "0", "nvidia-smi": gpu, "findmnt": mount}.items():
        file = commands / name
        file.write_text("#!/bin/sh\nprintf '%s\\n' '" + result + "'\n")
        file.chmod(0o755)
    return {**os.environ, "PATH": str(commands) + ":" + os.environ["PATH"]}


def test_help_and_unknown_option_do_not_modify_system():
    assert run("--help").returncode == 0
    assert run("--unexpected").returncode == 2


def test_unsupported_gpu_is_rejected_before_install(tmp_path):
    result = run("--local", env=fake_environment(tmp_path, gpu="Other GPU"))
    assert result.returncode == 1
    assert "targets an RTX 3090" in result.stderr


def test_cloud_without_a_distinct_mount_is_rejected_before_install(tmp_path):
    result = run("--cloud", env=fake_environment(tmp_path))
    assert result.returncode == 1
    assert "/workspace is not a distinct mounted volume" in result.stderr


def test_existing_installation_starts_with_mocked_services(tmp_path):
    # Simulates orchestration on an isolated filesystem; this is not a GPU test.
    root = tmp_path / "opt"
    project = root / "photo-service"
    toolchain = root / "photo-toolchain"
    (project / ".git").mkdir(parents=True)
    (project / ".env").write_text("API_TOKEN=private\n")
    (project / ".venv" / "bin").mkdir(parents=True)
    state = toolchain / ".photo-setup-state"
    state.mkdir(parents=True)
    (toolchain / ".photo-rent-setup").write_text("photo-rent-setup-v1\n")
    for name in ("python-ready", "cuda-ready", "backend-ready"):
        (state / name).touch()
    binary = toolchain / "stable-diffusion.cpp" / "build-photo" / "bin" / "sd-server"
    binary.parent.mkdir(parents=True)
    binary.write_text("#!/bin/sh\nexit 0\n")
    binary.chmod(0o755)
    python = project / ".venv" / "bin" / "python"
    python.write_text("""#!/bin/sh
printf '%s\\n' "$*" >> "$TEST_TRACE"
if [ "$1 $2" = '-m uvicorn' ]; then exec sleep 60; fi
if [ "$1 $2" = '-m photo_service.worker' ]; then
  echo 'INFO Engine ready: lustify_krea_edit'
  exec sleep 60
fi
exit 0
""")
    python.chmod(0o755)
    commands = tmp_path / "commands"
    commands.mkdir()
    results = {"id": "echo 0", "nvidia-smi": "echo NVIDIA GeForce RTX 3090",
               "pgrep": "exit 1", "dpkg-query": "echo install ok installed",
               "git": "echo https://github.com/nutakoe27-commits/Farmilka.git"}
    for name in ("gcc-14", "g++-14", "cmake", "xz", "tar", "findmnt", "make"):
        results[name] = "exit 0"
    for name, body in results.items():
        file = commands / name
        file.write_text("#!/bin/sh\n" + body + "\n")
        file.chmod(0o755)
    isolated = tmp_path / "rent-setup.sh"
    isolated.write_text(SCRIPT.read_text().replace("/opt", str(root)))
    trace = tmp_path / "calls"
    env = {**os.environ, "PATH": str(commands) + ":" + os.environ["PATH"], "TEST_TRACE": str(trace)}
    try:
        result = subprocess.run(["bash", str(isolated), "--local"], text=True, capture_output=True,
                                env=env, timeout=15)
        assert result.returncode == 0, result.stderr
        assert "API and worker are ready" in result.stdout
        assert "photo_service.download_krea" in trace.read_text()
        assert "photo_service.download_krea_edit" in trace.read_text()
    finally:
        for file in toolchain.glob("photo-run-*/*.pid"):
            try:
                os.kill(int(file.read_text()), signal.SIGTERM)
            except ProcessLookupError:
                pass
