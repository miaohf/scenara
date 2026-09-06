"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Clapperboard,
  Film,
  LogOut,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { useAuth, RequireAuth } from "@/providers/auth-provider";
import { projectApi } from "@/lib/api-client";
import type { Episode, Project } from "@/lib/types";
import { AppDialog } from "@/components/AppDialog";

type DialogState =
  | { type: "create" }
  | { type: "rename"; project: Project }
  | { type: "delete"; project: Project }
  | null;

function hashHue(id: string): number {
  let hash = 0;
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return [222, 248, 198, 32, 162, 278][hash % 6];
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function projectHref(project: Project, episodes?: Episode[]): string {
  const firstEpisode = episodes?.[0];
  return firstEpisode
    ? `/project/${project.id}/episode/${firstEpisode.id}`
    : `/project/${project.id}`;
}

function DashboardContent() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [episodeMap, setEpisodeMap] = useState<Record<string, Episode[]>>({});
  const [loading, setLoading] = useState(true);
  const [episodesLoading, setEpisodesLoading] = useState(false);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState<DialogState>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await projectApi.list();
      setProjects(list);
      setLoading(false);

      setEpisodesLoading(true);
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
      setEpisodesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const trimmedName = nameDraft.trim();
  const nameTooLong = trimmedName.length > 255;

  const openCreate = () => {
    setNameDraft("");
    setDialog({ type: "create" });
  };

  const openRename = (project: Project) => {
    setNameDraft(project.title);
    setDialog({ type: "rename", project });
  };

  const handleCreate = async () => {
    if (!trimmedName || nameTooLong) return;
    setSubmitting(true);
    try {
      const project = await projectApi.create(trimmedName);
      setDialog(null);
      toast.success("项目已创建");
      try {
        const episodes = await projectApi.listEpisodes(project.id);
        router.push(projectHref(project, episodes));
      } catch {
        router.push(`/project/${project.id}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleRename = async () => {
    if (dialog?.type !== "rename" || !trimmedName || nameTooLong) return;
    setSubmitting(true);
    try {
      const updated = await projectApi.update(dialog.project.id, { title: trimmedName });
      setProjects((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setDialog(null);
      toast.success("项目名称已更新");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重命名失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (dialog?.type !== "delete") return;
    setSubmitting(true);
    try {
      await projectApi.remove(dialog.project.id);
      setProjects((prev) => prev.filter((item) => item.id !== dialog.project.id));
      setDialog(null);
      toast.success("项目已删除");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      setSubmitting(false);
    }
  };

  const nameDialog =
    dialog?.type === "create"
      ? {
          title: "新建项目",
          description: "给项目起一个名字，之后也可以随时修改。",
          confirmText: "创建并打开",
          onConfirm: handleCreate,
        }
      : dialog?.type === "rename"
        ? {
            title: "重命名项目",
            description: "修改后会立即同步到项目列表和工作台。",
            confirmText: "保存",
            onConfirm: handleRename,
          }
        : null;

  return (
    <div className="relative min-h-screen overflow-hidden bg-[var(--bg-base)] text-[var(--text-primary)]">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 right-[-120px] h-[520px] w-[520px] rounded-full bg-[var(--accent)]/10 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(var(--text-primary) 1px, transparent 1px), linear-gradient(90deg, var(--text-primary) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      <div className="relative mx-auto max-w-6xl px-6 py-8 sm:px-8">
        <header className="mb-10 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[var(--accent-bg)] text-[var(--accent-text)] ring-1 ring-[var(--accent-border)]">
              <Clapperboard className="size-5" />
            </span>
            <div>
              <p className="text-sm font-semibold tracking-[0.24em] text-[var(--text-secondary)]">
                SCENARA
              </p>
              <p className="text-xs text-[var(--text-muted)]">你好，{user?.username}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={logout}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] px-3 py-2 text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:border-[var(--border-secondary)] hover:text-[var(--text-primary)]"
          >
            <LogOut className="size-3.5" />
            退出
          </button>
        </header>

        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">我的项目</h1>
            <p className="mt-1.5 text-sm text-[var(--text-tertiary)]">
              {loading ? "正在读取项目…" : `共 ${projects.length} 个项目`}
            </p>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--btn-primary-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] shadow-[0_10px_28px_var(--btn-primary-shadow)] transition-colors hover:bg-[var(--btn-primary-hover)]"
          >
            <Plus className="size-4" />
            新建项目
          </button>
        </div>

        {error ? (
          <p className="mb-6 rounded-xl border border-[var(--error-border)] bg-[var(--error-bg)] px-4 py-3 text-sm text-[var(--error-text)]">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <div
                key={key}
                className="h-56 animate-pulse rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)]"
              />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="flex min-h-[360px] flex-col items-center justify-center rounded-3xl border border-dashed border-[var(--border-secondary)] bg-[var(--bg-primary)]/60 px-6 text-center">
            <span className="mb-4 flex size-14 items-center justify-center rounded-2xl bg-[var(--accent-bg)] text-[var(--accent-text)]">
              <Film className="size-7" />
            </span>
            <h2 className="text-lg font-semibold">还没有项目</h2>
            <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--text-tertiary)]">
              创建一个项目，开始写剧本、生成角色与分镜。
            </p>
            <button
              type="button"
              onClick={openCreate}
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[var(--btn-primary-bg)] px-4 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)]"
            >
              <Plus className="size-4" />
              创建第一个项目
            </button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
            {projects.map((project) => {
              const episodes = episodeMap[project.id];
              const firstEpisode = episodes?.[0];
              const hue = hashHue(project.id);
              const href = projectHref(project, episodes);

              return (
                <article
                  key={project.id}
                  className="group relative overflow-hidden rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] transition-all hover:-translate-y-0.5 hover:border-[var(--accent-border)] hover:shadow-[0_18px_40px_var(--overlay-light)]"
                >
                  <Link href={href} className="block">
                    <div
                      className="relative h-28 overflow-hidden"
                      style={{
                        background: `linear-gradient(135deg, hsl(${hue} 28% 28%) 0%, hsl(${hue} 18% 16%) 100%)`,
                      }}
                    >
                      <div
                        aria-hidden
                        className="absolute inset-0 opacity-25"
                        style={{
                          backgroundImage:
                            "repeating-linear-gradient(90deg, transparent 0 18px, rgba(255,255,255,0.08) 18px 20px)",
                        }}
                      />
                      <Film className="absolute right-4 bottom-4 size-8 text-white/35" />
                    </div>
                    <div className="space-y-2 px-5 pt-4 pb-3">
                      <h2 className="truncate text-base font-semibold text-[var(--text-primary)]">
                        {project.title}
                      </h2>
                      <p className="text-xs text-[var(--text-muted)]">
                        更新于 {formatTime(project.updated_at)}
                      </p>
                    </div>
                  </Link>

                  <div className="flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] px-4 py-3">
                    <p className="truncate text-xs text-[var(--text-tertiary)]">
                      {firstEpisode
                        ? `第 ${firstEpisode.episode_number} 集 · ${firstEpisode.title}`
                        : episodesLoading
                          ? "读取剧集…"
                          : "暂无剧集"}
                    </p>
                    <div className="flex shrink-0 gap-1">
                      <button
                        type="button"
                        title="重命名"
                        aria-label={`重命名 ${project.title}`}
                        onClick={() => openRename(project)}
                        className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--accent-text)]"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        title="删除"
                        aria-label={`删除 ${project.title}`}
                        onClick={() => setDialog({ type: "delete", project })}
                        className="rounded-lg p-1.5 text-[var(--text-muted)] transition-colors hover:bg-[var(--error-bg)] hover:text-[var(--error-text)]"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <AppDialog
        open={Boolean(nameDialog)}
        title={nameDialog?.title || ""}
        description={nameDialog?.description}
        confirmText={nameDialog?.confirmText}
        submitting={submitting}
        confirmDisabled={!trimmedName || nameTooLong}
        onConfirm={() => nameDialog?.onConfirm()}
        onCancel={() => setDialog(null)}
      >
        <label className="block space-y-2">
          <span className="text-xs font-medium text-[var(--text-secondary)]">项目名称</span>
          <input
            value={nameDraft}
            onChange={(event) => setNameDraft(event.target.value)}
            maxLength={255}
            placeholder="例如：夜色将尽"
            className="h-11 w-full rounded-xl border border-[var(--border-primary)] bg-[var(--bg-sunken)] px-3.5 text-sm text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:border-[var(--accent-border)] focus:ring-2 focus:ring-[var(--accent-shadow)]"
          />
          {nameTooLong ? (
            <span className="text-xs text-[var(--error-text)]">名称不能超过 255 个字符</span>
          ) : null}
        </label>
      </AppDialog>

      <AppDialog
        open={dialog?.type === "delete"}
        title="删除项目"
        description={
          dialog?.type === "delete"
            ? `将永久删除「${dialog.project.title}」及其剧集内容，此操作无法撤销。`
            : undefined
        }
        confirmText="确认删除"
        danger
        submitting={submitting}
        onConfirm={handleDelete}
        onCancel={() => setDialog(null)}
      />
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
