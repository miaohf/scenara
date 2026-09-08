import type { Episode, Series, SeriesProject } from "../types";
import { apiFetch } from "@/lib/api-client";

const EPISODE_TOP_LEVEL_KEYS = new Set([
  "id",
  "projectId",
  "seriesId",
  "episodeNumber",
  "title",
  "stage",
  "createdAt",
  "lastModified",
]);

interface ApiProject {
  id: string;
  title: string;
  character_library: unknown[];
  scene_library: unknown[];
  prop_library: unknown[];
  settings?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface ApiSeries {
  id: string;
  project_id: string;
  title: string;
  order_index: number;
  created_at: string;
}

interface ApiEpisode {
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

// 同一剧集的自动保存可能由多个 debounce 回调并发触发。
// 串行化 PATCH，避免旧快照晚到并覆盖刚生成的媒体 URL。
let episodeSaveQueue: Promise<void> = Promise.resolve();

const enqueueEpisodeSave = (operation: () => Promise<void>): Promise<void> => {
  const next = episodeSaveQueue.then(operation, operation);
  // 队列不能因为一次保存失败而永久进入 rejected 状态。
  episodeSaveQueue = next.catch(() => undefined);
  return next;
};

export const isApiStorageMode = (): boolean => {
  if (typeof process !== "undefined" && process.env.NEXT_PUBLIC_USE_API_STORAGE === "true") {
    return true;
  }
  return false;
};

function projectFromApi(p: ApiProject): SeriesProject {
  const settings = p.settings || {};
  return {
    id: p.id,
    title: p.title,
    description: (settings.description as string) || undefined,
    coverImage: (settings.coverImage as string) || undefined,
    visualStyle: (settings.visualStyle as string) || "",
    language: (settings.language as string) || "中文",
    artDirection: settings.artDirection as SeriesProject["artDirection"],
    characterLibrary: (p.character_library || []) as SeriesProject["characterLibrary"],
    sceneLibrary: (p.scene_library || []) as SeriesProject["sceneLibrary"],
    propLibrary: (p.prop_library || []) as SeriesProject["propLibrary"],
    createdAt: new Date(p.created_at).getTime(),
    lastModified: new Date(p.updated_at).getTime(),
  };
}

function projectToApiBody(sp: SeriesProject) {
  return {
    title: sp.title,
    character_library: sp.characterLibrary,
    scene_library: sp.sceneLibrary,
    prop_library: sp.propLibrary,
    settings: {
      description: sp.description,
      coverImage: sp.coverImage,
      visualStyle: sp.visualStyle,
      language: sp.language,
      artDirection: sp.artDirection,
    },
  };
}

function seriesFromApi(s: ApiSeries): Series {
  return {
    id: s.id,
    projectId: s.project_id,
    title: s.title,
    sortOrder: s.order_index,
    createdAt: new Date(s.created_at).getTime(),
    lastModified: new Date(s.created_at).getTime(),
  };
}

export function episodeFromApi(ep: ApiEpisode): Episode {
  const payload = ep.payload || {};
  return {
    id: ep.id,
    projectId: ep.project_id,
    seriesId: ep.series_id,
    episodeNumber: ep.episode_number,
    title: ep.title,
    stage: ep.stage as Episode["stage"],
    createdAt: new Date(ep.created_at).getTime(),
    lastModified: new Date(ep.updated_at).getTime(),
    rawScript: (payload.rawScript as string) || "",
    targetDuration: (payload.targetDuration as string) || "60s",
    language: (payload.language as string) || "中文",
    visualStyle: (payload.visualStyle as string) || "",
    shotGenerationModel: (payload.shotGenerationModel as string) || "",
    scriptData: (payload.scriptData as Episode["scriptData"]) ?? null,
    shots: (payload.shots as Episode["shots"]) || [],
    isParsingScript: Boolean(payload.isParsingScript),
    renderLogs: (payload.renderLogs as Episode["renderLogs"]) || [],
    characterRefs: (payload.characterRefs as Episode["characterRefs"]) || [],
    sceneRefs: (payload.sceneRefs as Episode["sceneRefs"]) || [],
    propRefs: (payload.propRefs as Episode["propRefs"]) || [],
    promptTemplateOverrides: payload.promptTemplateOverrides as Episode["promptTemplateOverrides"],
    scriptGenerationCheckpoint: payload.scriptGenerationCheckpoint as Episode["scriptGenerationCheckpoint"],
  };
}

function episodeToApiBody(ep: Episode) {
  const payload: Record<string, unknown> = {};
  (Object.keys(ep) as (keyof Episode)[]).forEach((key) => {
    if (!EPISODE_TOP_LEVEL_KEYS.has(key)) {
      payload[key] = ep[key];
    }
  });
  return {
    title: ep.title,
    stage: ep.stage,
    episode_number: ep.episodeNumber,
    payload,
  };
}

export async function apiGetAllSeriesProjects(): Promise<SeriesProject[]> {
  const list = await apiFetch<ApiProject[]>("/v1/projects");
  return list.map(projectFromApi);
}

export async function apiLoadSeriesProject(id: string): Promise<SeriesProject> {
  const p = await apiFetch<ApiProject>(`/v1/projects/${id}`);
  return projectFromApi(p);
}

export async function apiSaveSeriesProject(sp: SeriesProject): Promise<void> {
  await apiFetch(`/v1/projects/${sp.id}`, {
    method: "PATCH",
    body: JSON.stringify(projectToApiBody(sp)),
  });
}

export async function apiDeleteSeriesProject(id: string): Promise<void> {
  await apiFetch(`/v1/projects/${id}`, { method: "DELETE" });
}

export async function apiCreateProject(title?: string): Promise<SeriesProject> {
  const p = await apiFetch<ApiProject>("/v1/projects", {
    method: "POST",
    body: JSON.stringify({ title: title || "未命名项目" }),
  });
  return projectFromApi(p);
}

export async function apiGetSeriesByProject(projectId: string): Promise<Series[]> {
  const list = await apiFetch<ApiSeries[]>(`/v1/projects/${projectId}/series`);
  return list.map(seriesFromApi);
}

export async function apiGetEpisodesByProject(projectId: string): Promise<Episode[]> {
  const list = await apiFetch<ApiEpisode[]>(`/v1/projects/${projectId}/episodes`);
  return list.map(episodeFromApi);
}

export async function apiLoadEpisode(id: string): Promise<Episode> {
  const ep = await apiFetch<ApiEpisode>(`/v1/episodes/${id}`);
  return episodeFromApi(ep);
}

export async function apiSaveEpisode(ep: Episode): Promise<void> {
  await enqueueEpisodeSave(() =>
    apiFetch(`/v1/episodes/${ep.id}`, {
      method: "PATCH",
      body: JSON.stringify(episodeToApiBody({ ...ep, lastModified: Date.now() })),
    }),
  );
}

/**
 * 增量保存：只提交发生变化的顶层字段。
 * 整集覆盖会把所有图片/关键帧一起重传，是自动保存请求体超限的主因。
 */
export async function apiSaveEpisodePartial(
  ep: Episode,
  changedKeys: (keyof Episode)[],
): Promise<void> {
  if (changedKeys.length === 0) return;

  const payload: Record<string, unknown> = {};
  const body: Record<string, unknown> = {};

  changedKeys.forEach((key) => {
    if (key === "title") body.title = ep.title;
    else if (key === "stage") body.stage = ep.stage;
    else if (key === "episodeNumber") body.episode_number = ep.episodeNumber;
    // lastModified 由服务端 updated_at 维护，其余 top-level 键不可变
    else if (!EPISODE_TOP_LEVEL_KEYS.has(key)) payload[key] = ep[key];
  });

  if (Object.keys(payload).length === 0 && Object.keys(body).length === 0) return;
  body.payload = payload;

  await enqueueEpisodeSave(() =>
    apiFetch(`/v1/episodes/${ep.id}/payload`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  );
}

export async function apiDeleteEpisode(id: string): Promise<void> {
  await apiFetch(`/v1/episodes/${id}`, { method: "DELETE" });
}

export async function apiCreateEpisode(
  projectId: string,
  seriesId: string,
  episodeNumber: number,
  title?: string,
): Promise<Episode> {
  const ep = await apiFetch<ApiEpisode>(`/v1/projects/${projectId}/episodes`, {
    method: "POST",
    body: JSON.stringify({
      series_id: seriesId,
      episode_number: episodeNumber,
      title: title || `第 ${episodeNumber} 集`,
      payload: {},
    }),
  });
  return episodeFromApi(ep);
}
