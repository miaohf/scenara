"use client";

import EpisodeWorkspace from "@/components/episode-workspace";
import ProjectOverviewPage from "../project-overview";
import { useProjectRoute } from "../use-project-route";

export default function ProjectCatchAllPage() {
  const { episodeId } = useProjectRoute();
  if (episodeId) return <EpisodeWorkspace />;
  return <ProjectOverviewPage />;
}
