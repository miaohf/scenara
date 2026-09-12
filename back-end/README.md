# Scenara — Backend (FastAPI)

## 技术栈

- **FastAPI** + **PostgreSQL**（独立库 `scenara`；单机调试仍可用 SQLite）
- **ComfyUI** / **vLLM** / **IndexTTS**：本地推理（配置保存在服务端 `model_registry`）
- **Redis** + **Celery**：ComfyUI 图片/视频等长任务（本地部署**必需**）
- **MinIO**（可选）：媒体对象存储

## 安装

需安装 [uv](https://docs.astral.sh/uv/)（Python 3.14+，见 `.python-version`）。

```bash
cd back-end
uv sync
cp -n .env.example .env
```

## 本地全栈启动

**1. Redis**（Celery 与 ComfyUI GPU 串行锁依赖）

```bash
docker run -d --name scenara-redis --restart unless-stopped -p 6379:6379 redis:7-alpine
```

**2. PostgreSQL**（独立库 `scenara`，不要复用其它项目的业务库）

本机若已有 Postgres（例如 `pdf_rag_postgres`），只需建库：

```bash
docker exec pdf_rag_postgres psql -U postgres -c "CREATE DATABASE scenara;"
```

从旧 SQLite 拷数据（先预览，再 `--apply`）：

```bash
cd back-end
uv run scripts/migrate_sqlite_to_postgres.py
uv run scripts/migrate_sqlite_to_postgres.py --apply
```

**3. FastAPI**

```bash
cd back-end
uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**4. Celery Worker**（ComfyUI 图片/视频生成必需；已配置 `worker_concurrency=1` 避免多任务抢 GPU）

```bash
cd back-end
uv run celery -A app.workers.celery_app.celery_app worker --loglevel=info
```

**5. ComfyUI**（默认 `http://127.0.0.1:8188`）

**6. vLLM**（默认 `http://100.64.0.32:8000/v1`，见 `.env` 中 `VLLM_*`）

API 文档：http://localhost:8000/docs

## 环境变量

见 [`.env.example`](.env.example)。关键项：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | 默认 `postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/scenara` |
| `JWT_SECRET` | 生产环境（`DEBUG=false`）不可使用默认值 |
| `REDIS_URL` | Celery 与 ComfyUI GPU 锁 |
| `VLLM_*` / `INDEXTTS_*` / `COMFYUI_BASE_URL` | 本地模型配置，写入 `user_settings.model_registry` |
| `DEFAULT_*_MODEL_ID` | 默认激活的 chat/image/video/audio 模型 |

模型配置保存在 `user_settings.model_registry`。新用户注册时自动写入 `.env` 默认值；修改 `.env` 后 GET `/v1/settings/models` 会合并部署层覆盖（地址/密钥），用户在 UI 的修改通过 PUT 持久化。

## ComfyUI 工作流

工作流 JSON 存放在 [`workflows/`](workflows/)（单一数据源）。前端通过 API 加载：

| 路径 | 说明 |
|------|------|
| `GET /v1/ai/workflows` | 列出可用工作流 |
| `GET /v1/ai/workflows/{name}` | 获取工作流 JSON |

## API 概览

| 路径 | 说明 |
|------|------|
| `POST /auth/register` | 注册 |
| `POST /auth/login` | 登录，返回 JWT |
| `GET/PUT /v1/settings/models` | 模型配置（服务端存储） |
| `POST /v1/ai/chat` | 同步对话（含 vLLM 本地） |
| `POST /v1/ai/tts` | 同步配音（IndexTTS / OpenAI Speech 兼容） |
| `POST /v1/ai/comfyui/image` | 同步 ComfyUI 图片 |
| `POST /v1/ai/comfyui/video` | 同步 ComfyUI 视频（API 模式默认） |
| `POST /v1/jobs` | 异步任务（可选；需 Redis + Celery Worker） |
| `GET /v1/jobs/{id}` | 任务状态 |
| `GET /v1/jobs/{id}/stream` | SSE 进度 |
| `GET /v1/media/raw/{key}` | 本地媒体（HMAC 签名 URL；生产请走 nginx 直出） |
| `GET /v1/media/verify` | 校验媒体 HMAC 签名，不读文件 |
