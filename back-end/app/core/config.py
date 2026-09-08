from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET = "change-me-in-production"
LOCAL_PROVIDER_IDS = frozenset({"vllm-local", "comfyui-local", "indextts-local"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "SCENARA API"
    debug: bool = True
    api_host: str = "0.0.0.0"
    api_port: int = 8000

    # 本地开发可用 SQLite；多进程（API + Celery）请用 PostgreSQL，避免 database is locked
    database_url: str = "postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/scenara"

    jwt_secret: str = DEFAULT_JWT_SECRET
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 30
    jwt_refresh_token_expire_days: int = 7

    s3_endpoint: str = "http://127.0.0.1:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket: str = "bigbanana-media"
    s3_region: str = "us-east-1"
    s3_use_ssl: bool = False

    # 媒体存储：local（默认，零依赖）| s3（需 MinIO/S3 可用）
    media_backend: str = "local"
    media_local_dir: str = "./data/media"
    # 生成图/视频以签名 URL 形式写入 episode payload；浏览器经 Next `/api` rewrite 访问
    media_url_prefix: str = "/api"
    media_url_ttl_days: int = 3650

    redis_url: str = "redis://127.0.0.1:6379/0"

    default_api_key: str = ""

    # 本地推理基础设施（写入 model_registry，前端从服务端拉取）
    vllm_base_url: str = "http://100.64.0.32:8000/v1"
    vllm_api_key: str = "VLLM_API_KEY"
    vllm_model_id: str = "Qwen/Qwen3.8-27B-FP8"
    vllm_max_tokens: int = 32768

    indextts_base_url: str = "http://ai-6gpu:8002/v1"
    indextts_api_key: str = "local"
    indextts_model_id: str = "indextts"
    indextts_default_voice: str = "EL_Danielle_Gentle_Engaging"
    indextts_response_format: str = "opus"
    indextts_timeout_ms: int = 120000

    comfyui_base_url: str = "http://127.0.0.1:8188"
    # ComfyUI 自身已有队列；默认关闭 Redis GPU 锁，避免崩溃后死锁导致请求卡在 /comfyui/image 之前
    comfyui_gpu_lock_enabled: bool = False

    default_chat_model_id: str = "qwen3-8-27b-fp8-vllm"
    default_image_model_id: str = "comfyui-flux-dev-fp8"
    default_video_model_id: str = "comfyui-minimax-h3-flft2v"
    default_audio_model_id: str = "indextts-local"

    cors_origins: str = (
        "http://localhost:3000,http://127.0.0.1:3000,http://192.168.1.178:3000,"
        "http://localhost:3080,http://127.0.0.1:3080,http://192.168.1.178:3080"
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @model_validator(mode="after")
    def validate_production_secrets(self) -> "Settings":
        if not self.debug and self.jwt_secret == DEFAULT_JWT_SECRET:
            raise ValueError(
                "JWT_SECRET 仍为默认值。生产环境（DEBUG=false）必须设置随机 JWT_SECRET。"
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
