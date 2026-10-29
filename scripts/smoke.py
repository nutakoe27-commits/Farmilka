"""Functional check against a running API and worker, without printing credentials."""
import argparse
import os
import time
from pathlib import Path

import httpx
from dotenv import dotenv_values
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("--url", default="http://127.0.0.1:8000")
parser.add_argument("--expect-engine", choices=["mock", "flux"], required=True)
parser.add_argument("--reference", type=Path)
parser.add_argument("--prompt", help="Optional prompt for a manual quality check")
parser.add_argument("--output", type=Path, default=Path("/tmp/photo-smoke.png"))
parser.add_argument("--timeout", type=int, default=600)
args = parser.parse_args()
token = os.environ.get("API_TOKEN") or dotenv_values(".env").get("API_TOKEN")
if not token:
    raise SystemExit("API_TOKEN is missing; run scripts/init_env.py or provide a private .env")
started = time.monotonic()
with httpx.Client(base_url=args.url, headers={"Authorization": f"Bearer {token}"}, timeout=30) as client:
    response = client.get("/healthz")
    response.raise_for_status()
    health = response.json()
    if not health["worker_online"] or health["engine"] != args.expect_engine:
        raise SystemExit(f"Expected a ready {args.expect_engine} worker; observed {health}")
    files = {}
    if args.reference:
        files["reference"] = (args.reference.name, args.reference.read_bytes(), "application/octet-stream")
    prompt = args.prompt or (
        "Change the red teapot to a blue teapot. Keep the composition and natural lighting."
        if args.reference else
        "A red ceramic teapot on a wooden table, natural window light, realistic photograph"
    )
    response = client.post("/api/jobs", data={
        "prompt": prompt,
        "width": 512, "height": 512, "seed": 42,
    }, files=files)
    response.raise_for_status()
    job_id = response.json()["id"]
    while time.monotonic() - started < args.timeout:
        response = client.get(f"/api/jobs/{job_id}")
        response.raise_for_status()
        job = response.json()
        if job["status"] == "failed":
            raise SystemExit(f"Job failed: {job['error_code']}")
        if job["status"] == "succeeded":
            output = client.get(f"/api/jobs/{job_id}/output")
            output.raise_for_status()
            args.output.write_bytes(output.content)
            with Image.open(args.output) as image:
                if image.format != "PNG" or image.size != (512, 512):
                    raise SystemExit("Unexpected output format or dimensions")
            print(f"PASS engine={health['engine']} reference={bool(args.reference)} "
                  f"size=512x512 elapsed={time.monotonic()-started:.1f}s output={args.output}")
            break
        time.sleep(2)
    else:
        raise SystemExit("Timed out: inspect the API and worker logs")
