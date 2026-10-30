import io
import logging
import signal
import threading

import httpx

from .engines import build_engine
from .images import normalize_image
from .settings import WorkerSettings

log = logging.getLogger("photo-worker")


def process_job(client: httpx.Client, engine, job: dict):
    headers = {"X-Lease-Token": job["lease_token"]}
    base = f"/internal/jobs/{job['id']}"
    done = threading.Event()

    def heartbeat():
        while not done.wait(20):
            try:
                response = client.post(base + "/heartbeat", headers=headers)
                response.raise_for_status()
            except httpx.HTTPError:
                log.warning("Heartbeat failed for job %s", job["id"])

    thread = threading.Thread(target=heartbeat, daemon=True)
    thread.start()
    try:
        reference = None
        if job["has_reference"]:
            response = client.get(base + "/reference", headers=headers)
            response.raise_for_status()
            reference = normalize_image(response.content)
        image = engine.render(job, reference)
        buffer = io.BytesIO()
        image.save(buffer, "PNG")
        # Retrying result delivery cannot trigger another GPU generation.
        for attempt in range(3):
            try:
                response = client.post(
                    base + "/result", headers=headers,
                    files={"image": ("result.png", buffer.getvalue(), "image/png")},
                )
                if response.status_code == 409:
                    log.warning("Lease no longer active for job %s", job["id"])
                    return
                response.raise_for_status()
                log.info("Completed job %s", job["id"])
                return
            except httpx.TransportError:
                if attempt == 2:
                    raise
                done.wait(2)
    except Exception as exc:
        log.error("Job %s failed (%s)", job["id"], type(exc).__name__)
        error_code = "out_of_memory" if "OutOfMemory" in type(exc).__name__ else "generation_failed"
        try:
            client.post(base + "/failure", headers=headers, json={"error_code": error_code}).raise_for_status()
        except httpx.HTTPError:
            log.warning("Could not report failure; lease expiry will recover this job")
    finally:
        done.set()
        thread.join(timeout=5)


def main():
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # HTTP client INFO messages include paths, but never log prompts or tokens.
    logging.getLogger("httpx").setLevel(logging.WARNING)
    settings = WorkerSettings()
    stopped = threading.Event()

    def stop(*_):
        stopped.set()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log.info("Loading engine: %s", settings.engine)
    engine = build_engine(settings)
    log.info("Engine ready: %s", settings.engine)
    try:
        with httpx.Client(
            base_url=settings.control_url.rstrip("/"), timeout=60,
            headers={"Authorization": f"Bearer {settings.worker_token.get_secret_value()}"},
        ) as client:
            while not stopped.is_set():
                try:
                    response = client.post("/internal/claim", json={"engine": settings.engine})
                    response.raise_for_status()
                    job = response.json()["job"]
                    if job:
                        process_job(client, engine, job)
                    else:
                        stopped.wait(settings.poll_seconds)
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code in (401, 403):
                        raise RuntimeError("Worker authentication failed; check WORKER_TOKEN") from None
                    log.warning("Control API returned HTTP %s", exc.response.status_code)
                    stopped.wait(5)
                except httpx.TransportError:
                    log.warning("Control API unavailable; retrying")
                    stopped.wait(5)
    finally:
        close = getattr(engine, "close", None)
        if close is not None:
            close()


if __name__ == "__main__":
    main()
