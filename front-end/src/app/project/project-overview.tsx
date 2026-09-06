"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Clapperboard, Pencil } from "lucide-react";
import { projectApi } from "@/lib/api-client";
import type { Episode, Project } from "@/lib/types";
import { AppDialog } from "@/components/AppDialog";
import { useProjectRoute } from "./use-project-route";

export default function ProjectOverviewPage() {
  const { projectId } = useProjectRoute();
  const [project, setProject] = useState<Project | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [renameOpen, setRenameOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  const trimmedName = nameDraft.trim();

  const handleRename = async () => {
    if (!project || !trimmedName) return;
    setSubmitting(true);
    try {
      const updated = await projectApi.update(project.id, { title: trimmedName });
      setProject(updated);
      setRenameOpen(false);
      toast.success("项目名称已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重命名失败");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-base)] p-6 text-[var(--text-muted)]">加载中...</div>
    );
  }

  if (loadError || !project) {
    return (
      <div className="min-h-screen bg-[var(--bg-base)] px-6 py-10 text-[var(--text-primary)]">
        <div className="mx-auto max-w-lg space-y-4">
          <Link
            href="/"
            className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <ArrowLeft className="size-3.5" />
            返回列表
          </Link>
          <h1 className="text-xl font-semibold">项目无法访问</h1>
          <p className="text-sm text-[var(--text-tertiary)]">
            {loadError || "项目不存在，或当前登录账号无权访问。"}
          </p>
          <p className="text-xs text-[var(--text-muted)]">
            该项目 ID：<span className="font-mono">{projectId}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div className="mx-auto max-w-3xl space-y-8 px-6 py-10">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Link
              href="/"
              className="inline-flex items-center gap-1 text-sm text-[var(--text-muted)] transition-colors hover:text-[var(--text-primary)]"
            >
              <ArrowLeft className="size-3.5" />
              返回列表
            </Link>
            <div className="mt-3 flex items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{project.title}</h1>
              <button
                type="button"
                title="重命名"
                onClick={() => {
                  setNameDraft(project.title);
                  setRenameOpen(true);
                }}
                className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
              >
                <Pencil className="size-4" />
              </button>
            </div>
          </div>
        </div>

        <section className="overflow-hidden rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)]">
          <div className="border-b border-[var(--border-subtle)] px-5 py-4">
            <h2 className="text-sm font-semibold">剧集</h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">选择一集进入工作台</p>
          </div>
          <div className="space-y-2 p-4">
            {episodes.map((ep) => (
              <Link
                key={ep.id}
                href={`/project/${projectId}/episode/${ep.id}`}
                className="flex items-center gap-3 rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] px-4 py-3 transition-colors hover:border-[var(--accent-border)] hover:bg-[var(--bg-hover)]"
              >
                <span className="flex size-9 items-center justify-center rounded-lg bg-[var(--accent-bg)] text-[var(--accent-text)]">
                  <Clapperboard className="size-4" />
                </span>
                <span className="text-sm font-medium">
                  第 {ep.episode_number} 集 · {ep.title}
                </span>
              </Link>
            ))}
          </div>
        </section>
      </div>

      <AppDialog
        open={renameOpen}
        title="重命名项目"
        description="修改后会立即同步到项目列表和工作台。"
        confirmText="保存"
        submitting={submitting}
        confirmDisabled={!trimmedName}
        onConfirm={handleRename}
        onCancel={() => setRenameOpen(false)}
      >
        <label className="block space-y-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">项目名称</span>
          <input
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            maxLength={255}
            className="h-11 w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-sunken)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-border)] focus:ring-2 focus:ring-[var(--accent-shadow)]"
          />
        </label>
      </AppDialog>
    </div>
  );
}
