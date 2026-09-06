"use client";

import { useParams } from "next/navigation";

function asPathSegments(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((part): part is string => typeof part === "string" && part.length > 0);
  }
  if (typeof value === "string" && value) return [value];
  return [];
}

function asId(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** `/project/:projectId` 与 `/project/:projectId/episode/:episodeId` 共用一层 catch-all。 */
export function useProjectRoute() {
  const params = useParams<{
    projectId?: string | string[];
    episodeId?: string | string[];
    path?: string | string[];
  }>();
  const path = asPathSegments(params.path);
  const projectId = asId(params.projectId) || path[0] || "";
  const episodeId =
    asId(params.episodeId) || (path[1] === "episode" && path[2] ? path[2] : "") || "";
  return { projectId, episodeId };
}
