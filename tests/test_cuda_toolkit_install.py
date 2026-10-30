import io
import sys
from pathlib import Path

import pytest

from scripts import install_cuda_toolkit


def test_corrupted_cuda_download_is_never_accepted_or_kept(tmp_path, monkeypatch):
    response = io.BytesIO(b"corrupted archive")
    response.headers = {"Content-Length": "17"}
    monkeypatch.setattr(install_cuda_toolkit.urllib.request, "urlopen", lambda *a, **k: response)
    with pytest.raises(RuntimeError, match="SHA256 mismatch"):
        install_cuda_toolkit.fetch("cuda_nvcc", "test.tar.xz", "0" * 64, tmp_path)
    assert not (tmp_path / "test.tar.xz").exists()
    assert not (tmp_path / "test.tar.xz.partial").exists()


def test_math_patch_refuses_unexpected_header_without_modifying_it(tmp_path):
    path = tmp_path / "include/crt/math_functions.h"
    path.parent.mkdir(parents=True)
    original = "#define __MATH_FUNCTIONS_H__\nextern double sinpi(double x);\n"
    path.write_text(original)
    with pytest.raises(RuntimeError, match="cannot safely patch"):
        install_cuda_toolkit.patch_glibc_math_header(tmp_path)
    assert path.read_text() == original


def test_toolkit_installer_preserves_unrelated_existing_directory(tmp_path, monkeypatch):
    directory = tmp_path / "existing"
    directory.mkdir()
    (directory / "important.txt").write_text("keep")
    monkeypatch.setattr(sys, "argv", ["installer", "--prefix", str(directory),
                                     "--cache", str(tmp_path / "cache")])
    with pytest.raises(SystemExit, match="Refusing to modify"):
        install_cuda_toolkit.main()
    assert (directory / "important.txt").read_text() == "keep"
