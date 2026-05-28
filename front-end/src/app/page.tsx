"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useAuth, RequireAuth } from "@/providers/auth-provider";
import { projectApi } from "@/lib/api-client";
import type { Episode, Project } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function DashboardContent() {
  const { user, logout } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [episodeMap, setEpisodeMap] = useState<Record<string, Episode[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await projectApi.list();
      setProjects(list);
      const map: Record<string, Episode[]> = {};
      await Promise.all(
        list.map(async (p) => {
          map[p.id] = await projectApi.listEpisodes(p.id);
        }),
      );
      setEpisodeMap(map);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const handleCreate = async () => {
    try {
      await projectApi.create(`新建项目 ${new Date().toLocaleString("zh-CN")}`);
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">AI Director</h1>
          <p className="text-sm text-muted-foreground">欢迎，{user?.username}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleCreate}>新建项目</Button>
          <Button variant="outline" onClick={logout}>
            退出
          </Button>
        </div>
      </header>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-muted-foreground">加载项目...</p>
      ) : projects.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>暂无项目</CardTitle>
            <CardDescription>点击「新建项目」开始创作</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {projects.map((project) => {
            const firstEpisode = episodeMap[project.id]?.[0];
            const href = firstEpisode
              ? `/project/${project.id}/episode/${firstEpisode.id}`
              : `/project/${project.id}`;

            return (
              <Link key={project.id} href={href}>
                <Card className="transition-colors hover:border-primary/40">
                  <CardHeader>
                    <CardTitle className="text-lg">{project.title}</CardTitle>
                    <CardDescription>
                      更新于 {new Date(project.updated_at).toLocaleString("zh-CN")}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="font-mono text-xs text-muted-foreground">
                      {firstEpisode
                        ? `第 ${firstEpisode.episode_number} 集 · ${firstEpisode.title}`
                        : project.id}
                    </p>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function HomePage() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}
