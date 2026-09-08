"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Episode } from "@/types";
import { fetchJob, listEpisodeJobs, type JobStatus } from "@/services/aiApiAdapter";
import { setGenerationJobListener } from "@/services/generationContext";
import { mergeEpisodeMediaFromServer, reconcileEpisodeWithJobs } from "@/services/jobReconcile";
import { primaryRunningJobId, sortQueueJobs } from "@/services/generationQueue";
import { loadEpisode } from "@/services/storageService";

interface GenerationQueueValue {
  jobs: JobStatus[];
  runningCount: number;
  queuedCount: number;
  upsertJob: (job: JobStatus) => void;
}

const GenerationQueueContext = createContext<GenerationQueueValue>({
  jobs: [],
  runningCount: 0,
  queuedCount: 0,
  upsertJob: () => undefined,
});

const POLL_MS = 2000;

export const GenerationQueueProvider: React.FC<{
  episode: Episode | null;
  onEpisodeReconcile?: (updater: (prev: Episode) => Episode) => void;
  children: React.ReactNode;
}> = ({ episode, onEpisodeReconcile, children }) => {
  const [jobs, setJobs] = useState<JobStatus[]>([]);
  const previousIdsRef = useRef<string[]>([]);
  const hydratedRef = useRef(false);
  const inFlightRef = useRef(false);
  const mediaSyncTickRef = useRef(0);
  const idleCatchupRef = useRef(0);
  const episodeRef = useRef(episode);
  const reconcileRef = useRef(onEpisodeReconcile);
  episodeRef.current = episode;
  reconcileRef.current = onEpisodeReconcile;
  const episodeId = episode?.id;

  const applyJobs = useCallback((jobList: JobStatus[], markOrphans: boolean) => {
    const reconcile = reconcileRef.current;
    if (!reconcile) return;
    reconcile((prev) => {
      const { episode: next, changed } = reconcileEpisodeWithJobs(prev, jobList, { markOrphans });
      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    if (!episodeId) {
      setJobs([]);
      previousIdsRef.current = [];
      hydratedRef.current = false;
      return;
    }

    let cancelled = false;
    const tick = async () => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const active = await listEpisodeJobs(episodeId, ["pending", "running"]);
        if (cancelled) return;
        setJobs(sortQueueJobs(active));
        const previousIds = previousIdsRef.current;
        const nextIds = active.map((job) => job.id);
        const finishedIds = previousIds.filter((id) => !nextIds.includes(id));
        previousIdsRef.current = nextIds;
        const currentEpisode = episodeRef.current;
        const reconcile = reconcileRef.current;
        if (!currentEpisode || !reconcile) return;

        const syncFromServer = async () => {
          try {
            const server = await loadEpisode(episodeId);
            if (cancelled) return;
            reconcile((prev) => {
              const { episode: next, changed } = mergeEpisodeMediaFromServer(prev, server);
              return changed ? next : prev;
            });
          } catch (error) {
            console.warn("同步已完成生成结果失败:", error);
          }
        };

        if (!hydratedRef.current) {
          const recent = await listEpisodeJobs(episodeId);
          if (cancelled) return;
          applyJobs(recent, true);
          await syncFromServer();
          hydratedRef.current = true;
          idleCatchupRef.current = 0;
          return;
        }

        if (finishedIds.length > 0) {
          const finishedJobs = (
            await Promise.all(finishedIds.map((id) => fetchJob(id).catch(() => null)))
          ).filter((job): job is JobStatus => Boolean(job));
          if (cancelled) return;
          applyJobs([...active, ...finishedJobs], false);
          if (finishedJobs.some((job) => job.status === "completed" || job.status === "failed")) {
            void syncFromServer();
            return;
          }
        }

        // 批量入队不挂 SSE：Worker 已写回剧集时，定期把本地空镜头补上图。
        if (active.length > 0) {
          mediaSyncTickRef.current += 1;
          idleCatchupRef.current = 0;
          if (mediaSyncTickRef.current % 4 === 0) {
            // 剧集 payload 很大时不要卡住队列轮询，否则进度会停在第一拍。
            void syncFromServer();
          }
        } else if (idleCatchupRef.current < 3) {
          idleCatchupRef.current += 1;
          mediaSyncTickRef.current = 0;
          await syncFromServer();
        } else {
          mediaSyncTickRef.current = 0;
        }
      } catch (error) {
        console.warn("刷新生成队列失败:", error);
      } finally {
        inFlightRef.current = false;
      }
    };

    void tick();
    const timer = window.setInterval(() => {
      void tick();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void loadEpisode(episodeId)
          .then((server) => {
            if (cancelled) return;
            const reconcile = reconcileRef.current;
            if (!reconcile) return;
            reconcile((prev) => {
              const { episode: next, changed } = mergeEpisodeMediaFromServer(prev, server);
              return changed ? next : prev;
            });
          })
          .catch(() => undefined);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [applyJobs, episodeId]);

  const upsertJob = useCallback((job: JobStatus) => {
    setJobs((current) => {
      const next = current.filter((item) => item.id !== job.id);
      if (job.status === "pending" || job.status === "running") {
        next.push(job);
      }
      return sortQueueJobs(next);
    });
    if (job.status === "completed" || job.status === "failed") {
      applyJobs([job], false);
    }
  }, [applyJobs]);

  useEffect(() => {
    setGenerationJobListener(upsertJob);
    return () => setGenerationJobListener(undefined);
  }, [upsertJob]);

  const value = useMemo<GenerationQueueValue>(() => {
    const runnerId = primaryRunningJobId(jobs);
    const runningCount = runnerId ? 1 : 0;
    const queuedCount = jobs.filter((job) => job.id !== runnerId).length;
    return { jobs, runningCount, queuedCount, upsertJob };
  }, [jobs, upsertJob]);

  return (
    <GenerationQueueContext.Provider value={value}>{children}</GenerationQueueContext.Provider>
  );
};

export const useGenerationQueue = (): GenerationQueueValue => useContext(GenerationQueueContext);
