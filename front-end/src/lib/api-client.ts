import { clearTokens, getAccessToken, getRefreshToken, setTokens, type AuthTokens } from "./auth";
import type { ApiError, Episode, Project } from "./types";

const API_BASE = "/api";

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

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  const token = getAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });

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
    throw new Error("Unauthorized");
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
    throw new Error(message || "Request failed");
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
        payload: raw.payload,
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
  payload: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export const episodeApi = {
  get: (id: string) => apiFetch<Episode>(`/v1/episodes/${id}`),
};
