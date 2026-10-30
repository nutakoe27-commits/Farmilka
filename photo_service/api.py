import secrets
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID, uuid4

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .images import normalize_image
from .settings import APISettings
from .store import Store

STATIC = Path(__file__).parent / "static"


class Claim(BaseModel):
    engine: Literal["mock", "flux", "flux_lora", "qwen_gguf", "lustify"]


class Failure(BaseModel):
    error_code: Literal["generation_failed", "out_of_memory", "worker_lost"] = "generation_failed"


def create_app(settings: APISettings | None = None) -> FastAPI:
    settings = settings or APISettings()
    data_dir = settings.data_dir.resolve()
    for name in ("inputs", "outputs"):
        (data_dir / name).mkdir(parents=True, exist_ok=True)
    store = Store(data_dir, settings.lease_seconds, settings.max_attempts)
    app = FastAPI(title="Photo service", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.store = store
    bearer = HTTPBearer(auto_error=False)

    def authorize(expected: str):
        def dependency(credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
            if not credentials or not secrets.compare_digest(credentials.credentials, expected):
                raise HTTPException(401, "unauthorized", headers={"WWW-Authenticate": "Bearer"})
        return dependency

    user = Depends(authorize(settings.api_token.get_secret_value()))
    worker = Depends(authorize(settings.worker_token.get_secret_value()))

    @app.middleware("http")
    async def request_limits(request, call_next):
        length = request.headers.get("content-length")
        if length:
            try:
                too_large = int(length) > settings.max_upload_bytes + 65536
            except ValueError:
                too_large = True
            if too_large:
                from fastapi.responses import JSONResponse
                return JSONResponse({"detail": "upload_too_large"}, status_code=413)
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Cache-Control"] = "no-store"
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; script-src 'self'; style-src 'self'; "
            "img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
        )
        return response

    async def read_image(upload: UploadFile, *, reference=True):
        data = await upload.read(settings.max_upload_bytes + 1)
        await upload.close()
        if len(data) > settings.max_upload_bytes:
            raise HTTPException(413, "upload_too_large")
        try:
            return normalize_image(data, reference=reference)
        except ValueError:
            raise HTTPException(422, "invalid_image") from None

    def job_or_404(job_id: UUID):
        job = store.get(str(job_id))
        if job is None:
            raise HTTPException(404, "job_not_found")
        return job

    def require_lease(job_id: UUID, lease: str):
        if not store.lease_valid(str(job_id), lease):
            raise HTTPException(409, "lease_lost")

    @app.get("/healthz")
    def health():
        return store.health()

    @app.post("/api/jobs", dependencies=[user], status_code=202)
    async def submit(
        prompt: Annotated[str, Form(min_length=1, max_length=4000)],
        width: Annotated[int, Form(ge=512, le=1024)] = 768,
        height: Annotated[int, Form(ge=512, le=1024)] = 768,
        seed: Annotated[int | None, Form(ge=0, le=2**32 - 1)] = None,
        reference: Annotated[UploadFile | None, File()] = None,
    ):
        prompt = prompt.strip()
        if not prompt:
            raise HTTPException(422, "empty_prompt")
        if width % 32 or height % 32:
            raise HTTPException(422, "invalid_dimensions")
        job_id = str(uuid4())
        reference_path = None
        if reference is not None:
            image = await read_image(reference)
            reference_path = f"inputs/{job_id}.png"
            image.save(data_dir / reference_path, "PNG")
        job = dict(id=job_id, prompt=prompt, width=width, height=height,
                   seed=seed if seed is not None else secrets.randbelow(2**32),
                   reference_path=reference_path)
        if not store.enqueue(job, settings.max_queue):
            if reference_path:
                (data_dir / reference_path).unlink(missing_ok=True)
            raise HTTPException(429, "queue_full", headers={"Retry-After": "30"})
        return {"id": job_id, "status": "queued", "seed": job["seed"]}

    @app.get("/api/jobs/{job_id}", dependencies=[user])
    def status(job_id: UUID):
        job = job_or_404(job_id)
        return {key: job[key] for key in (
            "id", "status", "width", "height", "seed", "error_code", "created_at", "updated_at"
        )}

    @app.get("/api/jobs/{job_id}/output", dependencies=[user])
    def output(job_id: UUID):
        job = job_or_404(job_id)
        if job["status"] != "succeeded":
            raise HTTPException(409, "output_not_ready")
        return FileResponse(data_dir / job["output_path"], media_type="image/png",
                            filename=f"{job_id}.png")

    @app.post("/internal/claim", dependencies=[worker])
    def claim(payload: Claim):
        job = store.claim(payload.engine)
        if job is None:
            return {"job": None}
        return {"job": {key: job[key] for key in (
            "id", "prompt", "width", "height", "seed", "lease_token"
        )} | {"has_reference": bool(job["reference_path"])}}

    @app.get("/internal/jobs/{job_id}/reference", dependencies=[worker])
    def reference(job_id: UUID, x_lease_token: Annotated[str, Header()]):
        require_lease(job_id, x_lease_token)
        job = job_or_404(job_id)
        if not job["reference_path"]:
            raise HTTPException(404, "reference_not_found")
        return FileResponse(data_dir / job["reference_path"], media_type="image/png")

    @app.post("/internal/jobs/{job_id}/heartbeat", dependencies=[worker])
    def heartbeat(job_id: UUID, x_lease_token: Annotated[str, Header()]):
        if not store.heartbeat(str(job_id), x_lease_token):
            raise HTTPException(409, "lease_lost")
        return {"status": "ok"}

    @app.post("/internal/jobs/{job_id}/result", dependencies=[worker])
    async def result(job_id: UUID, x_lease_token: Annotated[str, Header()], image: UploadFile):
        require_lease(job_id, x_lease_token)
        decoded = await read_image(image, reference=False)
        job = job_or_404(job_id)
        if decoded.size != (job["width"], job["height"]):
            raise HTTPException(422, "invalid_dimensions")
        # A unique file prevents an expired worker from overwriting a newer result.
        relative = f"outputs/{job_id}-{uuid4().hex}.png"
        path = data_dir / relative
        decoded.save(path, "PNG")
        if not store.finish(str(job_id), x_lease_token, output_path=relative):
            path.unlink(missing_ok=True)
            raise HTTPException(409, "lease_lost")
        return {"status": "succeeded"}

    @app.post("/internal/jobs/{job_id}/failure", dependencies=[worker])
    def failure(job_id: UUID, payload: Failure, x_lease_token: Annotated[str, Header()]):
        if not store.finish(str(job_id), x_lease_token, error_code=payload.error_code):
            raise HTTPException(409, "lease_lost")
        return {"status": "failed"}

    app.mount("/", StaticFiles(directory=STATIC, html=True), name="frontend")
    return app
