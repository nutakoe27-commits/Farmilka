"""Build with the execution environment's existing proxy and CA trust, if supplied."""
import argparse
import os
import socket
import subprocess
from urllib.parse import urlparse

parser = argparse.ArgumentParser()
parser.add_argument("--gpu", action="store_true")
args = parser.parse_args()
command = ["docker", "build", "-f", "Dockerfile.gpu" if args.gpu else "Dockerfile",
           "-t", "photo-worker:local" if args.gpu else "photo-api:local"]
hosts = set()
for name in ("HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"):
    value = os.environ.get(name)
    if not value:
        continue
    # Predefined proxy build args do not persist in image history.
    command += ["--build-arg", name]
    if name != "NO_PROXY":
        host = urlparse(value).hostname
        if host and host not in hosts:
            address = socket.getaddrinfo(host, None, socket.AF_INET)[0][4][0]
            command += ["--add-host", f"{host}:{address}"]
            hosts.add(host)
if hosts:
    command += ["--network=host"]
certificate = os.environ.get("SSL_CERT_FILE")
if certificate:
    # Stream the public CA bundle as a BuildKit secret; keep verification enabled.
    command += ["--secret", "id=build_ca,src=" + certificate]
command += ["."]
raise SystemExit(subprocess.call(command))
