# AI Director — Front-end (Next.js + shadcn)

## 启动

先启动 FastAPI 后端（见 `../back-end/README.md`），再：

```bash
cd front-end
cp -n .env.example .env.local
npm install
npm run dev
```

后端需先在 `../back-end` 用 Python 启动（见 `../back-end/README.md`）。

访问 http://localhost:3000

## 架构

- `/api/*` 通过 `next.config.ts` rewrite 代理到 FastAPI（默认 `http://127.0.0.1:8000`）
- JWT 存 `localStorage`（`bb_access_token` / `bb_refresh_token`）
- Studio 组件位于 `src/components/`、`src/services/`、`src/types.ts`
- ComfyUI 工作流 JSON 位于 `public/workflows/`

## 环境变量（`.env.local`）

```
API_URL=http://127.0.0.1:8000
NEXT_PUBLIC_USE_API_STORAGE=true
NEXT_PUBLIC_USE_API_AI=true
```

## 页面

| 路径 | 说明 |
|------|------|
| `/login` | 登录 |
| `/register` | 注册 |
| `/` | 项目 Dashboard |
| `/project/[id]/episode/[id]` | Episode 五阶段工作台 |
