from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class CommonSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class APISettings(CommonSettings):
    api_token: SecretStr = Field(min_length=32)
    worker_token: SecretStr = Field(min_length=32)
    data_dir: Path = Path("data")
    max_upload_bytes: int = 10 * 1024 * 1024
    max_queue: int = 20
    lease_seconds: int = 180
    max_attempts: int = 3


class WorkerSettings(CommonSettings):
    worker_token: SecretStr = Field(min_length=32)
    control_url: str = "http://127.0.0.1:8000"
    engine: Literal["mock", "flux", "flux_lora", "qwen_gguf", "lustify", "lustify_krea", "lustify_krea_edit"] = "mock"
    model_dir: Path = Path("models/flux2-klein-4b")
    model_cpu_offload: bool = True
    poll_seconds: float = 2
    flux1_model_dir: Path = Path("models/flux1-dev")
    heartsync_lora_dir: Path = Path("models/heartsync-flux1")
    lora_scale: float = Field(default=1.0, ge=0, le=2)
    flux1_steps: int = Field(default=28, ge=4, le=60)
    flux1_guidance: float = Field(default=3.5, ge=0, le=15)
    flux1_img2img_strength: float = Field(default=0.65, gt=0, le=1)
    qwen_model_dir: Path = Path("models/qwen-image-2.1-turbo")
    qwen_server_binary: Path = Path("/opt/sdcpp/sd-server")
    qwen_backend_port: int = Field(default=1234, ge=1024, le=65535)
    qwen_load_timeout: int = Field(default=1200, ge=30, le=3600)
    qwen_job_timeout: int = Field(default=1200, ge=30, le=3600)
    lustify_model_dir: Path = Path("models/lustify")
    lustify_steps: int = Field(default=25, ge=1, le=100)
    lustify_cfg: float = Field(default=5.0, ge=0, le=20)
    lustify_strength: float = Field(default=0.6, gt=0, le=1)
    krea_model_dir: Path = Path("models/lustify-krea")
    krea_edit_dir: Path = Path("models/lustify-krea-edit")
