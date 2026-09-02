"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { projectApi } from "@/lib/api-client";
import type { Episode, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ProjectOverviewPage() {
  const params = useParams<{ projectId: string }>();
  const projectId = params.projectId;
  const [project, setProject] = useState<Project | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (!projectId) return;
    setLoading(true);
    setLoadError("");
    void (async () => {
      try {
        const list = await projectApi.list();
        setProject(list.find((p) => p.id === projectId) || null);
        setEpisodes(await projectApi.listEpisodes(projectId));
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : "加载失败");
        setProject(null);
      } finally {
        setLoading(false);
      }
    })();
  }, [projectId]);

  if (loading) {
    return <div className="p-6 text-muted-foreground">加载中...</div>;
  }

  if (loadError || !project) {
    return (
      <div className="mx-auto max-w-lg space-y-4 p-6">
        <Link href="/" className="text-sm text-muted-foreground hover:underline">
          ← 返回列表
        </Link>
        <h1 className="text-xl font-semibold">项目无法访问</h1>
        <p className="text-sm text-muted-foreground">
          {loadError || "项目不存在，或当前登录账号无权访问。"}
        </p>
        <p className="text-xs text-muted-foreground">
          该项目 ID：<span className="font-mono">{projectId}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm text-muted-foreground hover:underline">
            ← 返回列表
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{project.title}</h1>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>剧集</CardTitle>
          <CardDescription>选择一集进入工作台</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {episodes.map((ep) => (
            <Link key={ep.id} href={`/project/${projectId}/episode/${ep.id}`}>
              <Button variant="outline" className="w-full justify-start">
                第 {ep.episode_number} 集 · {ep.title}
              </Button>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
