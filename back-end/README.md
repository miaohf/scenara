# AI Director — Backend (FastAPI)

## 技术栈

- **FastAPI** + **SQLite**（本地文件 `data/bigbanana.db`）
- **MinIO** / **Redis**：连接已有实例，通过 `.env` 配置

## 安装

```bash
cd back-end
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp -n .env.example .env   # 配置 MinIO / Redis / DEFAULT_API_KEY
```

## 启动

```bash
cd back-end && source .venv/bin/activate
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

**Celery Worker（视频等长任务，需 Redis）：**

```bash
cd back-end && source .venv/bin/activate
celery -A app.workers.celery_app.celery_app worker --loglevel=info
```

API 文档：http://localhost:8000/docs

## 环境变量

见 [`.env.example`](.env.example)。关键项：

| 变量 | 说明 |
|------|------|
| `DATABASE_URL` | 默认 `sqlite+aiosqlite:///./data/bigbanana.db` |
| `S3_ENDPOINT` | 已有 MinIO 地址，如 `http://127.0.0.1:9000` |
| `REDIS_URL` | 已有 Redis 地址，如 `redis://127.0.0.1:6379/0` |

## API 概览

| 路径 | 说明 |
|------|------|
| `POST /auth/register` | 注册 |
| `POST /auth/login` | 登录，返回 JWT |
| `POST /auth/refresh` | 刷新 token |
| `GET /auth/me` | 当前用户 |
| `GET/PUT /v1/settings/models` | 模型配置与 API Key（服务端存储） |
| `POST /v1/ai/chat` | 同步对话 |
| `POST /v1/ai/chat-json` | 同步 JSON 对话 |
| `POST /v1/ai/image` | 同步图片（OpenAI 兼容） |
| `POST /v1/ai/comfyui/image` | 同步 ComfyUI 图片 |
| `POST /v1/jobs` | 异步任务（`video` / `comfyui_video`） |
| `GET /v1/jobs/{id}` | 任务状态 |
| `GET /v1/jobs/{id}/stream` | SSE 进度 |
| `GET/POST /v1/projects` | 项目列表 / 创建 |
| `PATCH /v1/episodes/{id}` | 剧集自动保存 |
| `POST /v1/media/upload-url` | MinIO 预签名上传 |
