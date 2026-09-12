"use client";

import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useProjectRoute } from "@/app/project/use-project-route";
import { Save, CheckCircle } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import StageScript from "@/components/StageScript";
import StageAssets from "@/components/StageAssets";
import StageDirector from "@/components/StageDirector";
import StageExport from "@/components/StageExport";
import StagePrompts from "@/components/StagePrompts";
import ModelConfigModal from "@/components/ModelConfig";
import AssetSyncBanner from "@/components/CharacterLibrary/AssetSyncBanner";
import { Episode, ProjectState } from "@/types";
import { saveEpisodePartial, loadEpisode } from "@/services/storageService";
import { setLogCallback, clearLogCallback } from "@/services/renderLogService";
import { setGenerationEpisodeId } from "@/services/generationContext";
import { listEpisodeJobs } from "@/services/aiApiAdapter";
import { reconcileEpisodeWithJobs } from "@/services/jobReconcile";
import { useAlert } from "@/components/GlobalAlert";
import { useProjectContext } from "@/contexts/ProjectContext";
import { GenerationQueueProvider } from "@/contexts/GenerationQueueContext";
import { useInterfaceLanguage } from "@/contexts/InterfaceLanguageContext";
import {
  checkCharacterSync,
  checkSceneSync,
  checkPropSync,
} from "@/services/characterSyncService";

/** 渲染日志只用于界面回看，超出后丢弃最旧的，避免 payload 无限增长 */
const MAX_RENDER_LOGS = 200;

const episodeHasBackgroundJobs = (episode: Episode): boolean => {
  const script = episode.scriptData;
  if (
    script?.characters.some(
      (character) =>
        character.status === "generating" ||
        character.variations?.some((variation) => variation.status === "generating") ||
        character.turnaround?.status === "generating_image" ||
        character.threeView?.status === "generating",
    )
  ) {
    return true;
  }
  if (script?.scenes.some((scene) => scene.status === "generating")) return true;
  if ((script?.props || []).some((prop) => prop.status === "generating")) return true;
  return episode.shots.some(
    (shot) =>
      shot.keyframes?.some((frame) => frame.status === "generating") ||
      shot.interval?.status === "generating" ||
      shot.nineGrid?.status === "generating_image",
  );
};

const diffEpisodeKeys = (next: Episode, prev: Episode | null): (keyof Episode)[] => {
  if (!prev) return Object.keys(next) as (keyof Episode)[];
  return (Object.keys(next) as (keyof Episode)[]).filter((key) => next[key] !== prev[key]);
};


export default function EpisodeWorkspace() {
  const { episodeId } = useProjectRoute();
  const router = useRouter();
  const { showAlert } = useAlert();
  const { text } = useInterfaceLanguage();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const {
    project,
    currentEpisode,
    setCurrentEpisode,
    updateProject: updateSeriesProject,
    updateEpisode,
    syncAllCharactersToEpisode,
    syncAllScenesToEpisode,
    syncAllPropsToEpisode,
  } = useProjectContext();
  const [isGenerating, setIsGenerating] = useState(false);
  const [isScriptBusy, setIsScriptBusy] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [showSaveStatus, setShowSaveStatus] = useState(false);
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [episodeLoadError, setEpisodeLoadError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 上次成功保存的剧集快照，用于算出需要提交的字段 */
  const lastSavedRef = useRef<Episode | null>(null);

  // 生成任务据此带上 episode_id，落库后可按剧集检索
  useEffect(() => {
    setGenerationEpisodeId(episodeId);
    return () => setGenerationEpisodeId(undefined);
  }, [episodeId]);

  useEffect(() => {
    if (!episodeId) return;
    setEpisodeLoadError(null);
    lastSavedRef.current = null;
    loadEpisode(episodeId)
      .then(async (ep) => {
        try {
          const jobs = await listEpisodeJobs(ep.id);
          const { episode, changed } = reconcileEpisodeWithJobs(ep, jobs);
          lastSavedRef.current = changed ? ep : episode;
          setCurrentEpisode(episode);
        } catch (error) {
          console.warn("Failed to reconcile generation jobs:", error);
          lastSavedRef.current = ep;
          setCurrentEpisode(ep);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "加载剧集失败";
        console.error("Failed to load episode:", error);
        setEpisodeLoadError(message);
      });
    return () => setCurrentEpisode(null);
  }, [episodeId, setCurrentEpisode]);

  // 依赖只取 id：曾经依赖整个 currentEpisode，导致每次状态变化都重新注册日志回调
  const currentEpisodeId = currentEpisode?.id;
  useEffect(() => {
    if (!currentEpisodeId) {
      clearLogCallback();
      return;
    }
    setLogCallback((log) => {
      updateEpisode((prev) => ({
        ...prev,
        renderLogs: [...(prev.renderLogs || []), log].slice(-MAX_RENDER_LOGS),
      }));
    });
    return () => clearLogCallback();
  }, [currentEpisodeId, updateEpisode]);

  useEffect(() => {
    if (!currentEpisode) return;
    setSaveStatus("unsaved");
    setShowSaveStatus(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const changedKeys = diffEpisodeKeys(currentEpisode, lastSavedRef.current);
      if (changedKeys.length === 0) {
        setSaveStatus("saved");
        return;
      }
      setSaveStatus("saving");
      try {
        // 只提交变化的字段：整集覆盖会把所有图片一起重传，请求体极易超限
        await saveEpisodePartial(currentEpisode, changedKeys);
        lastSavedRef.current = currentEpisode;
        setSaveStatus("saved");
      } catch (e) {
        console.error("Auto-save failed", e);
        setSaveStatus("unsaved");
      }
    }, 1000);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [currentEpisode]);

  useEffect(() => {
    if (saveStatus === "saved") {
      if (hideStatusTimeoutRef.current) clearTimeout(hideStatusTimeoutRef.current);
      hideStatusTimeoutRef.current = setTimeout(() => setShowSaveStatus(false), 2000);
    } else if (saveStatus === "saving") {
      setShowSaveStatus(true);
      if (hideStatusTimeoutRef.current) clearTimeout(hideStatusTimeoutRef.current);
    }
    return () => {
      if (hideStatusTimeoutRef.current) clearTimeout(hideStatusTimeoutRef.current);
    };
  }, [saveStatus]);

  useEffect(() => {
    if (!project || !currentEpisode) return;
    if (currentEpisode.episodeNumber !== 1) return;

    const projectTitle = (project.title || "").trim();
    const isProjectPlaceholder =
      !projectTitle ||
      projectTitle === "未命名项目" ||
      /^新建项目\s\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(projectTitle);

    if (!isProjectPlaceholder) return;

    const candidateTitle = (
      currentEpisode.scriptData?.title ||
      currentEpisode.title ||
      ""
    ).trim();
    if (!candidateTitle) return;
    if (/^第\s*\d+\s*集$/u.test(candidateTitle)) return;
    if (candidateTitle === projectTitle) return;

    updateSeriesProject({ title: candidateTitle });
  }, [project, currentEpisode, updateSeriesProject]);

  const handleUpdateProject = (
    updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState),
  ) => {
    updateEpisode(updates);
  };

  const setStage = (stage: "script" | "assets" | "director" | "export" | "prompts") => {
    if (isScriptBusy) {
      showAlert("剧本正在生成或改写，离开后未完成的文本会中断。\n\n确定要离开当前页面吗？", {
        title: "剧本任务进行中",
        type: "warning",
        showCancel: true,
        confirmText: "确定离开",
        cancelText: "继续等待",
        onConfirm: () => {
          setIsScriptBusy(false);
          handleUpdateProject({ stage });
        },
      });
      return;
    }
    handleUpdateProject({ stage });
  };

  const leaveWorkspace = (href: string) => {
    router.push(href);
    if (!currentEpisode || saveStatus === "saved") return;
    const changedKeys = diffEpisodeKeys(currentEpisode, lastSavedRef.current);
    if (changedKeys.length === 0) return;
    void saveEpisodePartial(currentEpisode, changedKeys).catch((error) => {
      console.warn("离开后后台保存失败:", error);
    });
  };

  const confirmLeaveIfScriptBusy = (href: string) => {
    if (isScriptBusy) {
      showAlert("剧本正在生成或改写，离开后未完成的文本会中断。生图/视频任务会在后台继续。\n\n确定要离开吗？", {
        title: "剧本任务进行中",
        type: "warning",
        showCancel: true,
        confirmText: "确定离开",
        cancelText: "继续等待",
        onConfirm: () => {
          setIsScriptBusy(false);
          leaveWorkspace(href);
        },
      });
      return;
    }
    leaveWorkspace(href);
  };

  const projectId = currentEpisode?.projectId || project?.id;
  const projectOverviewHref = projectId ? `/project/${projectId}` : "/";
  const handleExit = () => confirmLeaveIfScriptBusy(projectOverviewHref);
  const handleGoHome = () => confirmLeaveIfScriptBusy("/");
  const handleGoToProject = () => confirmLeaveIfScriptBusy(projectOverviewHref);

  if (episodeLoadError) {
    return (
      <div className="flex h-screen flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-lg text-[var(--text-primary)]">无法打开该剧集</p>
        <p className="max-w-md text-sm text-[var(--text-muted)]">{episodeLoadError}</p>
        <p className="max-w-md text-xs text-[var(--text-muted)]">
          请确认：1) 后端已启动（127.0.0.1:8000）；2) 已登录创建该项目的账号；3) 不要混用 demo 账号与正式账号。
        </p>
        <div className="flex gap-3">
          <button
            type="button"
            className="rounded-md border border-[var(--border-primary)] px-4 py-2 text-sm"
            onClick={() => router.push("/")}
          >
            返回项目列表
          </button>
          {currentEpisode?.projectId && (
            <button
              type="button"
              className="rounded-md bg-[var(--accent-primary)] px-4 py-2 text-sm text-white"
              onClick={() => router.push(`/project/${currentEpisode.projectId}`)}
            >
              返回项目页
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!currentEpisode) {
    return (
      <div className="flex h-screen items-center justify-center text-[var(--text-muted)]">
        加载中...
      </div>
    );
  }

  const renderStage = () => {
    switch (currentEpisode.stage) {
      case "script":
        return (
          <StageScript
            project={currentEpisode}
            updateProject={handleUpdateProject}
            onShowModelConfig={() => setShowModelConfig(true)}
            onGeneratingChange={setIsScriptBusy}
          />
        );
      case "assets":
        return (
          <StageAssets
            project={currentEpisode}
            updateProject={handleUpdateProject}
            onGeneratingChange={setIsGenerating}
          />
        );
      case "director":
        return (
          <StageDirector
            project={currentEpisode}
            updateProject={handleUpdateProject}
            onGeneratingChange={setIsGenerating}
          />
        );
      case "export":
        return <StageExport project={currentEpisode} />;
      case "prompts":
        return (
          <StagePrompts project={currentEpisode} updateProject={handleUpdateProject} />
        );
      default:
        return <div className="text-[var(--text-primary)]">未知阶段</div>;
    }
  };

  const episodeUsesDefaultTitle =
    /^第\s*\d+\s*集$/u.test(currentEpisode.title?.trim() || '') ||
    (project && currentEpisode.episodeNumber === 1 && currentEpisode.title?.trim() === project.title?.trim());
  const displayEpisodeTitle = episodeUsesDefaultTitle
    ? text(`第 ${currentEpisode.episodeNumber} 集`, `Episode ${currentEpisode.episodeNumber}`)
    : currentEpisode.title;
  const episodeLabel = project ? `${project.title} / ${displayEpisodeTitle}` : displayEpisodeTitle;

  return (
    <GenerationQueueProvider
      episode={currentEpisode}
      onEpisodeReconcile={(updater) => setCurrentEpisode((prev) => (prev ? updater(prev) : prev))}
    >
    <div className="flex h-screen bg-[var(--bg-secondary)] font-sans text-[var(--text-secondary)] selection:bg-[var(--accent-bg)]">
      <Sidebar
        currentStage={currentEpisode.stage}
        setStage={setStage}
        onExit={handleExit}
        onGoHome={handleGoHome}
        projectName={episodeLabel}
        onShowModelConfig={() => setShowModelConfig(true)}
        isNavigationLocked={isScriptBusy}
        isBackgroundBusy={isGenerating || episodeHasBackgroundJobs(currentEpisode)}
        episode={currentEpisode}
        episodeInfo={
          project
            ? {
                projectId: project.id,
                projectTitle: project.title,
                episodeTitle: displayEpisodeTitle,
              }
            : undefined
        }
        onGoToProject={project ? handleGoToProject : undefined}
        collapsed={isSidebarCollapsed}
        onCollapsedChange={setIsSidebarCollapsed}
      />
      <main className={`${isSidebarCollapsed ? 'ml-20' : 'ml-72'} relative h-screen flex-1 overflow-hidden transition-[margin] duration-300 ease-out`}>
        {project &&
          currentEpisode &&
          (() => {
            const { outdatedRefs: outdatedCharacters } = checkCharacterSync(
              currentEpisode,
              project,
            );
            const { outdatedRefs: outdatedScenes } = checkSceneSync(currentEpisode, project);
            const { outdatedRefs: outdatedProps } = checkPropSync(currentEpisode, project);

            return (
              <>
                <AssetSyncBanner
                  title="Characters"
                  outdatedRefs={outdatedCharacters.map((ref) => ({
                    assetId: ref.characterId,
                    syncedVersion: ref.syncedVersion,
                  }))}
                  resolveName={(assetId: string) =>
                    project.characterLibrary.find((ch) => ch.id === assetId)?.name || assetId
                  }
                  onSyncAll={syncAllCharactersToEpisode}
                />
                <AssetSyncBanner
                  title="Scenes"
                  outdatedRefs={outdatedScenes.map((ref) => ({
                    assetId: ref.sceneId,
                    syncedVersion: ref.syncedVersion,
                  }))}
                  resolveName={(assetId: string) =>
                    project.sceneLibrary.find((sc) => sc.id === assetId)?.location || assetId
                  }
                  onSyncAll={syncAllScenesToEpisode}
                />
                <AssetSyncBanner
                  title="Props"
                  outdatedRefs={outdatedProps.map((ref) => ({
                    assetId: ref.propId,
                    syncedVersion: ref.syncedVersion,
                  }))}
                  resolveName={(assetId: string) =>
                    project.propLibrary.find((pr) => pr.id === assetId)?.name || assetId
                  }
                  onSyncAll={syncAllPropsToEpisode}
                />
              </>
            );
          })()}
        {renderStage()}
        {showSaveStatus && (
          <div className="pointer-events-none absolute right-6 top-4 z-50 flex items-center gap-2 rounded-full bg-[var(--overlay-medium)] px-2 py-1 font-mono text-xs text-[var(--text-tertiary)] backdrop-blur-sm">
            {saveStatus === "saving" ? (
              <>
                <Save className="h-3 w-3 animate-pulse" />
                保存中...
              </>
            ) : (
              <>
                <CheckCircle className="h-3 w-3 text-[var(--success)]" />
                已保存
              </>
            )}
          </div>
        )}
      </main>
      <ModelConfigModal isOpen={showModelConfig} onClose={() => setShowModelConfig(false)} />
    </div>
    </GenerationQueueProvider>
  );
}
