import json
import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def _get_env_file() -> tuple[str, ...]:
    """Determine which .env files to load based on MAJLISNA_ENV."""
    env = os.getenv("MAJLISNA_ENV")
    if not env:
        selector_path = Path(".env")
        if selector_path.exists():
            load_dotenv(selector_path, override=False)
            selector = dotenv_values(selector_path)
            env = selector.get("MAJLISNA_ENV", "development")
        else:
            env = "development"

    env_file = f".env.{env}"
    load_dotenv(env_file, override=False)
    return (".env", env_file)


class Settings(BaseSettings):
    """Application settings with multi-environment support."""

    model_config = SettingsConfigDict(env_file=_get_env_file(), env_file_encoding="utf-8")

    # Environment Selector
    ipg_env: str = "development"

    # Database
    database_url: str

    # Redis (Socket.IO cross-worker pub/sub)
    redis_url: str = "redis://redis:6379/0"

    # JWT Authentication
    jwt_secret_key: str = "dev-secret-key-change-in-production"
    jwt_encryption_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60
    refresh_token_expire_days: int = 30

    # Environment
    environment: str = "development"

    # Logging
    log_level: str = "DEBUG"
    logfire_token: str = ""

    # Server
    port: int = 5111

    # Frontend
    frontend_url: str = "http://localhost:3000"

    # Sentry
    sentry_dsn: str = ""

    # Email (Resend)
    resend_api_key: str = ""
    from_email: str = "Majlisna <noreply@majlisna.app>"

    # Google OAuth
    google_client_id_web: str = ""

    # CORS
    cors_origins: str = ""

    @field_validator("jwt_secret_key")
    @classmethod
    def validate_jwt_secret(cls, v: str, info) -> str:
        """Reject the default dev secret in production."""
        env = info.data.get("environment", "development")
        if env == "production" and v == "dev-secret-key-change-in-production":
            msg = "JWT_SECRET_KEY must be changed from the default value in production"
            raise ValueError(msg)
        return v

    @field_validator("cors_origins")
    @classmethod
    def parse_cors_origins(cls, v: str) -> list[str]:
        """Parse JSON arrays or comma-separated strings into lists."""
        if v.startswith("["):
            return json.loads(v)
        return [item.strip() for item in v.split(",") if item.strip()]
