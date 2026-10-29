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
    engine: Literal["mock", "flux", "flux_lora"] = "mock"
    model_dir: Path = Path("models/flux2-klein-4b")
    model_cpu_offload: bool = True
    poll_seconds: float = 2
    flux1_model_dir: Path = Path("models/flux1-dev")
    heartsync_lora_dir: Path = Path("models/heartsync-flux1")
    lora_scale: float = Field(default=1.0, ge=0, le=2)
    flux1_steps: int = Field(default=28, ge=4, le=60)
    flux1_guidance: float = Field(default=3.5, ge=0, le=15)
    flux1_img2img_strength: float = Field(default=0.65, gt=0, le=1)
