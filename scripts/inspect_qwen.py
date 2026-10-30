"""Public model metadata and card, using only Python's standard library.

Run on the GPU VM before building anything. No weights or tokens are needed.
"""
import argparse
import json
import re
import urllib.error
import urllib.request

REPO = "AtomicChat/Qwen-Image-2.1-Turbo-Uncensored-GGUF"
DIFFUSION_REPO = "AtomicChat/Qwen-Image-2.1-Turbo-GGUF"
ENDPOINTS = {"pirateface": "https://pirateface.co", "huggingface": "https://huggingface.co"}


def fetch(url):
    request = urllib.request.Request(url, headers={"User-Agent": "PhotoService-model-inspection/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read(2 * 1024 * 1024 + 1)
        if len(body) > 2 * 1024 * 1024:
            raise RuntimeError("Metadata response is too large")
        return body


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", choices=list(ENDPOINTS), default="huggingface")
    parser.add_argument("--readme", action="store_true", help="Also include public README texts")
    args = parser.parse_args()
    endpoint = ENDPOINTS[args.source]
    try:
        reports = []
        for repo in (REPO, DIFFUSION_REPO):
            info = json.loads(fetch(f"{endpoint}/api/models/{repo}?blobs=true"))
            revision = info["sha"]
            if not re.fullmatch(r"[0-9a-f]{40}", revision):
                raise RuntimeError("No immutable model revision was returned")
            report = {
                "repository": repo, "endpoint": endpoint, "revision": revision,
                "gated": info.get("gated"), "card": info.get("cardData"),
                "files": [{"name": f["rfilename"], "bytes": f.get("size")}
                          for f in info.get("siblings", [])],
            }
            if args.readme:
                report["readme"] = fetch(f"{endpoint}/{repo}/resolve/{revision}/README.md").decode("utf-8")
            reports.append(report)
        print(json.dumps(reports, ensure_ascii=False, indent=2))
        return 0
    except (urllib.error.URLError, ValueError, KeyError, RuntimeError) as exc:
        print(f"Cannot inspect {endpoint}/{repo}: {exc}")
        print("No weights were downloaded. Check the URL/API or send the page's README and file list.")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
