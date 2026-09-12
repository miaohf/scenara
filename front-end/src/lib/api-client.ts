import { clearTokens, getAccessToken, getRefreshToken, setTokens, type AuthTokens } from "./auth";
import type { ApiError, Episode, Project } from "./types";

const API_BASE = "/api";
/** 与 next.config / .env 中 API_URL 对齐，供浏览器侧排查连接问题 */
const API_UPSTREAM =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_API_URL?.trim()) ||
  (typeof process !== "undefined" && process.env.API_URL?.trim()) ||
  "http://127.0.0.1:8000";

let refreshPromise: Promise<boolean> | null = null;

async function tryRefreshToken(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;

  const res = await fetch(`${API_BASE}/auth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) {
    clearTokens();
    return false;
  }

  const tokens = (await res.json()) as AuthTokens;
  setTokens(tokens);
  return true;
}

export type ApiFetchOptions = RequestInit & {
  /** Client-side abort timeout in ms. Prevents infinite spinners when upstream hangs. */
  timeoutMs?: number;
};

export async function apiFetch<T>(
  path: string,
  init: ApiFetchOptions = {},
  retry = true,
): Promise<T> {
  const { timeoutMs, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  if (!headers.has("Content-Type") && requestInit.body) {
    headers.set("Content-Type", "application/json");
  }

  const token = getAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const controller = new AbortController();
  const externalSignal = requestInit.signal;
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }
  const timeoutId =
    typeof timeoutMs === "number" && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...requestInit,
      headers,
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(
        typeof timeoutMs === "number" && timeoutMs > 0
          ? `Request timed out (${Math.floor(timeoutMs / 1000)}s)`
          : "Request cancelled",
      );
    }
    const raw = error instanceof Error ? error.message : String(error);
    if (/failed to fetch|networkerror|err_connection/i.test(raw)) {
      const requestPath = `${API_BASE}${path}`;
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const isComfyProxy = path.includes("/comfyui/");
      console.error(
        `[apiFetch] 网络连接失败\n` +
          `  浏览器请求: ${origin}${requestPath}\n` +
          `  Scenara 后端: ${API_UPSTREAM}${path}\n` +
          (isComfyProxy
            ? `  说明: 此接口由后端再转发到 ComfyUI；若此处失败，先确认 Scenara API (${API_UPSTREAM}) 已启动。\n` +
              `        ComfyUI 实际地址请看浏览器 [ComfyUI Image] 日志与后端 uvicorn 日志中的 comfy_base / prompt URL。\n`
            : "") +
          `  原始错误: ${raw}`,
      );
      throw new Error(
        isComfyProxy
          ? `无法连接 Scenara 后端（${API_UPSTREAM}${path}）。ComfyUI 由后端转发，请先确认 API 已启动；ComfyUI 地址见控制台 [ComfyUI Image] 日志。`
          : `无法连接后端服务（${API_UPSTREAM}）。请确认 API 已启动后重试。`,
      );
    }
    throw error;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    externalSignal?.removeEventListener("abort", onExternalAbort);
  }

  if (res.status === 401 && retry) {
    if (!refreshPromise) {
      refreshPromise = tryRefreshToken().finally(() => {
        refreshPromise = null;
      });
    }
    const refreshed = await refreshPromise;
    if (refreshed) {
      return apiFetch<T>(path, init, false);
    }
    // Consumers must be able to distinguish an expired/revoked session from a
    // temporary network or upstream error.  In particular, AuthProvider should
    // only discard stored credentials for a confirmed authentication failure.
    throw Object.assign(new Error("Unauthorized"), { status: 401 });
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const err = (await res.json()) as ApiError;
      if (typeof err.detail === "string") message = err.detail;
      else if (Array.isArray(err.detail)) message = err.detail.map((d) => d.msg).join(", ");
    } catch {
      // ignore parse errors
    }
    throw Object.assign(new Error(message || "Request failed"), { status: res.status });
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return (await res.json()) as T;
}

export const authApi = {
  register: (body: { email: string; username: string; password: string }) =>
    apiFetch<{ id: number; email: string; username: string }>("/auth/register", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  login: (body: { username: string; password: string }) =>
    apiFetch<AuthTokens>("/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
    }),

  me: () => apiFetch<{ id: number; email: string; username: string }>("/auth/me"),
};

export const projectApi = {
  list: () => apiFetch<Project[]>("/v1/projects"),
  create: (title: string) =>
    apiFetch<Project>("/v1/projects", {
      method: "POST",
      body: JSON.stringify({ title }),
    }),
  update: (id: string, body: { title: string }) =>
    apiFetch<Project>(`/v1/projects/${id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  remove: (id: string) =>
    apiFetch<void>(`/v1/projects/${id}`, { method: "DELETE" }),
  listEpisodes: (projectId: string) =>
    apiFetch<ApiEpisodeResponse[]>(`/v1/projects/${projectId}/episodes`).then((items) =>
      items.map((raw) => ({
        id: raw.id,
        project_id: raw.project_id,
        series_id: raw.series_id,
        user_id: raw.user_id,
        episode_number: raw.episode_number,
        title: raw.title,
        stage: raw.stage,
        // 列表接口不再返回 payload（可能数十～上百 MB），详情请走 episodeApi.get
        payload: raw.payload ?? {},
        created_at: raw.created_at,
        updated_at: raw.updated_at,
      })),
    ),
};

interface ApiEpisodeResponse {
  id: string;
  project_id: string;
  series_id: string;
  user_id: number;
  episode_number: number;
  title: string;
  stage: string;
  payload?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const episodeApi = {
  get: (id: string) => apiFetch<Episode>(`/v1/episodes/${id}`),
};
