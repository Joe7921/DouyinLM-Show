from __future__ import annotations

import shutil
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

_REPOSITORY_ROOT = Path(__file__).resolve().parents[4]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(
            _REPOSITORY_ROOT / ".env",
            _REPOSITORY_ROOT / ".env.local",
        ),
        env_file_encoding="utf-8",
        env_ignore_empty=True,
        extra="ignore",
        case_sensitive=False,
    )

    app_mode: Literal["development", "test", "stage"] = "development"
    app_host: str = "127.0.0.1"
    app_port: int = 8765
    data_dir: Path = Path("data")
    web_dist_dir: Path | None = None
    ark_base_url: str = "https://ark.cn-beijing.volces.com/api/v3"
    ark_model: str = "doubao-seed-2-0-lite-260215"
    ark_api_key: SecretStr | None = None
    deepseek_base_url: str = "https://api.deepseek.com"
    deepseek_model: str = "deepseek-v4-flash"
    deepseek_api_key: SecretStr | None = None
    ark_upload_purpose: str = "user_data"
    volc_asr_api_key: SecretStr | None = None
    volc_asr_app_id: SecretStr | None = None
    volc_asr_access_token: SecretStr | None = None
    # Backward-compatible aliases for the incorrectly named T1 preview config.
    volc_asr_app_key: SecretStr | None = None
    volc_asr_access_key: SecretStr | None = None
    volc_asr_resource_id: str = "volc.bigasr.auc_turbo"
    ffmpeg_path: Path | None = None
    ffprobe_path: Path | None = None
    max_upload_bytes: int = 1_073_741_824
    provider_timeout_seconds: float = 180.0
    compiler_timeout_seconds: float = Field(default=45.0, ge=10.0, le=180.0)
    compiler_max_attempts: int = Field(default=2, ge=1, le=2)
    compiler_retry_delay_seconds: float = Field(default=0.8, ge=0.0, le=5.0)
    compiler_retry_max_delay_seconds: float = Field(default=2.0, ge=0.0, le=5.0)
    compiler_retry_window_seconds: float = Field(default=10.0, ge=0.0, le=30.0)
    max_keyframes: int = 12
    pipeline_version: str = "t1.0"
    understanding_schema_version: str = "1.1"
    understanding_prompt_version: str = "1.1"
    web_search_enabled: bool = False

    @property
    def resolved_data_dir(self) -> Path:
        data_dir = self.data_dir.expanduser()
        if not data_dir.is_absolute():
            data_dir = _REPOSITORY_ROOT / data_dir
        return data_dir.resolve()

    @property
    def database_path(self) -> Path:
        return self.resolved_data_dir / "douyinlm.db"

    @property
    def database_url(self) -> str:
        return f"sqlite+pysqlite:///{self.database_path.as_posix()}"

    @property
    def resolved_web_dist_dir(self) -> Path:
        if self.web_dist_dir is not None:
            return self.web_dist_dir.expanduser().resolve()
        return _REPOSITORY_ROOT / "apps" / "web" / "dist"

    @property
    def resolved_asr_api_key(self) -> SecretStr | None:
        return _first_nonempty_secret(self.volc_asr_api_key)

    @property
    def resolved_asr_app_id(self) -> SecretStr | None:
        return _first_nonempty_secret(self.volc_asr_app_id, self.volc_asr_app_key)

    @property
    def resolved_asr_access_token(self) -> SecretStr | None:
        return _first_nonempty_secret(
            self.volc_asr_access_token,
            self.volc_asr_access_key,
        )

    @property
    def asr_configured(self) -> bool:
        legacy_complete = (
            self.resolved_asr_app_id is not None
            and self.resolved_asr_access_token is not None
        )
        return self.resolved_asr_api_key is not None or legacy_complete

    @property
    def resolved_ffmpeg_path(self) -> Path | None:
        return self._resolve_executable(
            self.ffmpeg_path,
            _REPOSITORY_ROOT / "tools" / "ffmpeg" / "bin" / "ffmpeg.exe",
            "ffmpeg",
        )

    @property
    def resolved_ffprobe_path(self) -> Path | None:
        return self._resolve_executable(
            self.ffprobe_path,
            _REPOSITORY_ROOT / "tools" / "ffmpeg" / "bin" / "ffprobe.exe",
            "ffprobe",
        )

    @staticmethod
    def _resolve_executable(configured: Path | None, bundled: Path, name: str) -> Path | None:
        if configured is not None:
            candidate = configured.expanduser()
            if not candidate.is_absolute():
                candidate = _REPOSITORY_ROOT / candidate
            return candidate.resolve() if candidate.is_file() else None
        if bundled.is_file():
            return bundled.resolve()
        discovered = shutil.which(name)
        return Path(discovered).resolve() if discovered else None

    def ensure_runtime_directories(self) -> None:
        root = self.resolved_data_dir
        root.mkdir(parents=True, exist_ok=True)
        for name in ("incoming", "originals", "proxies", "audio", "keyframes", "cache"):
            (root / name).mkdir(exist_ok=True)


def get_settings() -> Settings:
    return Settings()


def _first_nonempty_secret(*values: SecretStr | None) -> SecretStr | None:
    for value in values:
        if value is not None and value.get_secret_value().strip():
            return value
    return None
