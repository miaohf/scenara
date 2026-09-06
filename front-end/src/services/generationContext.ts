import type { JobStatus } from "./aiApiAdapter";

/**
 * 当前打开的剧集上下文。
 *
 * 生成任务分散在资产页/导演台的十几个调用点，逐层透传 episodeId 成本高；
 * 同一时刻只会打开一个剧集，因此用模块级上下文在创建任务时补上归属，
 * 让任务记录可按剧集检索（离开页面后仍能查到在跑什么、跑完了什么）。
 */
let currentEpisodeId: string | undefined;
let jobListener: ((job: JobStatus) => void) | undefined;

export const setGenerationEpisodeId = (episodeId?: string): void => {
  currentEpisodeId = episodeId;
};

export const getGenerationEpisodeId = (): string | undefined => currentEpisodeId;

export const setGenerationJobListener = (listener?: (job: JobStatus) => void): void => {
  jobListener = listener;
};

export const notifyGenerationJob = (job: JobStatus): void => {
  jobListener?.(job);
};
