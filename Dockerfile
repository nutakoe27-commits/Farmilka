FROM python:3.12-slim-bookworm@sha256:e697c81897302a4c4333bade000d98038fbb21eb064f8ee1fd42d02ebcd9d337
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_LINK_MODE=copy
WORKDIR /app
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export PIP_CERT=/run/secrets/build_ca; fi; \
    pip install --no-cache-dir uv==0.12.23
COPY pyproject.toml uv.lock ./
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export SSL_CERT_FILE=/run/secrets/build_ca; fi; \
    uv sync --frozen --no-dev
COPY --chown=10001:10001 photo_service ./photo_service
COPY --chown=10001:10001 scripts/smoke.py ./scripts/smoke.py
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid 10001 app \
    && mkdir /data && chown app:app /data
ENV PATH="/app/.venv/bin:$PATH" DATA_DIR=/data
USER app
EXPOSE 8000
CMD ["uvicorn", "photo_service.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000", "--no-access-log"]
