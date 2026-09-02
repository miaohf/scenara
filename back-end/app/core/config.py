from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "Scenara API"
    debug: bool = True
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    database_url: str = "sqlite+aiosqlite:///./data/app.db"

    jwt_secret: str = "change-me-in-production"
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7

    s3_endpoint: str = "http://127.0.0.1:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "bigbanana-media"
    s3_region: str = "us-east-1"
    s3_use_ssl: bool = False

    redis_url: str = "redis://127.0.0.1:6379/0"

    default_api_key: str = ""

    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000,http://192.168.1.178:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
