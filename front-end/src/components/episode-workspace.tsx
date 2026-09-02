"use client";

import React, { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Save, CheckCircle } from "lucide-react";
import Sidebar from "@/components/Sidebar";
import StageScript from "@/components/StageScript";
import StageAssets from "@/components/StageAssets";
import StageDirector from "@/components/StageDirector";
import StageExport from "@/components/StageExport";
import StagePrompts from "@/components/StagePrompts";
import ModelConfigModal from "@/components/ModelConfig";
import AssetSyncBanner from "@/components/CharacterLibrary/AssetSyncBanner";
import { ProjectState } from "@/types";
import { saveEpisode, loadEpisode } from "@/services/storageService";
import { setLogCallback, clearLogCallback } from "@/services/renderLogService";
import { useAlert } from "@/components/GlobalAlert";
import { useProjectContext } from "@/contexts/ProjectContext";
import {
  checkCharacterSync,
  checkSceneSync,
  checkPropSync,
} from "@/services/characterSyncService";

const isNineGridGenerating = (status?: string): boolean =>
  status === "generating_panels" ||
  status === "generating_image" ||
  status === "generating";

const clearInFlightGenerationStates = (episode: ProjectState): ProjectState => {
  const scriptData = episode.scriptData
    ? {
        ...episode.scriptData,
        characters: episode.scriptData.characters.map((char) => ({
          ...char,
          status: char.status === "generating" ? "failed" : char.status,
          turnaround:
            char.turnaround &&
            (char.turnaround.status === "generating_panels" ||
              char.turnaround.status === "generating_image")
              ? { ...char.turnaround, status: "failed" as const }
              : char.turnaround,
          variations: char.variations.map((variation) => ({
            ...variation,
            status: variation.status === "generating" ? "failed" : variation.status,
          })),
        })),
        scenes: episode.scriptData.scenes.map((scene) => ({
          ...scene,
          status: scene.status === "generating" ? "failed" : scene.status,
        })),
        props: episode.scriptData.props.map((prop) => ({
          ...prop,
          status: prop.status === "generating" ? "failed" : prop.status,
        })),
      }
    : null;

  return {
    ...episode,
    isParsingScript: false,
    scriptGenerationCheckpoint: null,
    scriptData,
    shots: episode.shots.map((shot) => ({
      ...shot,
      keyframes: shot.keyframes?.map((kf) =>
        kf.status === "generating" ? { ...kf, status: "failed" as const } : kf,
      ),
      interval:
        shot.interval?.status === "generating"
          ? { ...shot.interval, status: "failed" as const }
          : shot.interval,
      nineGrid:
        shot.nineGrid && isNineGridGenerating(shot.nineGrid.status)
          ? { ...shot.nineGrid, status: "failed" as const }
          : shot.nineGrid,
    })),
  };
};

export default function EpisodeWorkspace() {
  const params = useParams<{ episodeId: string }>();
  const episodeId = params.episodeId;
  const router = useRouter();
  const { showAlert } = useAlert();
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
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const [showSaveStatus, setShowSaveStatus] = useState(false);
  const [showModelConfig, setShowModelConfig] = useState(false);
  const [episodeLoadError, setEpisodeLoadError] = useState<string | null>(null);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideStatusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!episodeId) return;
    setEpisodeLoadError(null);
    loadEpisode(episodeId)
      .then((ep) => setCurrentEpisode(ep))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : "加载剧集失败";
        console.error("Failed to load episode:", error);
        setEpisodeLoadError(message);
      });
    return () => setCurrentEpisode(null);
  }, [episodeId, setCurrentEpisode]);

  useEffect(() => {
    if (currentEpisode) {
      setLogCallback((log) => {
        updateEpisode((prev) => ({
          ...prev,
          renderLogs: [...(prev.renderLogs || []), log],
        }));
      });
    } else {
      clearLogCallback();
    }
    return () => clearLogCallback();
  }, [currentEpisode?.id, currentEpisode, updateEpisode]);

  useEffect(() => {
    if (!currentEpisode) return;
    setSaveStatus("unsaved");
    setShowSaveStatus(true);
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        await saveEpisode(currentEpisode);
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
    if (isGenerating) {
      showAlert("当前正在执行生成任务，切换页面会导致生成数据丢失。\n\n确定要离开当前页面吗？", {
        title: "生成任务进行中",
        type: "warning",
        showCancel: true,
        confirmText: "确定离开",
        cancelText: "继续等待",
        onConfirm: () => {
          setIsGenerating(false);
          updateEpisode((prev) => ({ ...clearInFlightGenerationStates(prev), stage }));
        },
      });
      return;
    }
    handleUpdateProject({ stage });
  };

  const handleExit = async () => {
    if (isGenerating) {
      showAlert("当前正在执行生成任务，退出会导致数据丢失。\n\n确定要退出吗？", {
        title: "生成任务进行中",
        type: "warning",
        showCancel: true,
        confirmText: "确定退出",
        cancelText: "继续等待",
        onConfirm: async () => {
          setIsGenerating(false);
          if (currentEpisode) {
            const cleanedEpisode = clearInFlightGenerationStates(currentEpisode);
            await saveEpisode(cleanedEpisode);
          }
          router.push(`/project/${currentEpisode?.projectId || ""}`);
        },
      });
      return;
    }
    if (currentEpisode) await saveEpisode(currentEpisode);
    router.push(`/project/${currentEpisode?.projectId || ""}`);
  };

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
            onGeneratingChange={setIsGenerating}
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

  const displayEpisodeTitle =
    project &&
    currentEpisode.episodeNumber === 1 &&
    currentEpisode.title?.trim() === project.title?.trim()
      ? `第 ${currentEpisode.episodeNumber} 集`
      : currentEpisode.title;
  const episodeLabel = project ? `${project.title} / ${displayEpisodeTitle}` : displayEpisodeTitle;

  return (
    <div className="flex h-screen bg-[var(--bg-secondary)] font-sans text-[var(--text-secondary)] selection:bg-[var(--accent-bg)]">
      <Sidebar
        currentStage={currentEpisode.stage}
        setStage={setStage}
        onExit={handleExit}
        projectName={episodeLabel}
        onShowModelConfig={() => setShowModelConfig(true)}
        isNavigationLocked={isGenerating}
        episodeInfo={
          project
            ? {
                projectId: project.id,
                projectTitle: project.title,
                episodeTitle: displayEpisodeTitle,
              }
            : undefined
        }
        onGoToProject={project ? () => router.push(`/project/${project.id}`) : undefined}
      />
      <main className="relative ml-72 h-screen flex-1 overflow-hidden">
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
  );
}
