import { Shot, VideoDuration } from '../types';

export interface VideoDurationRecommendation {
  duration: VideoDuration;
  estimatedSeconds: number;
  reason: string;
}

const DEFAULT_SUPPORTED: VideoDuration[] = [5, 10, 15];

const stripDialogueMarkup = (text: string): string =>
  text
    .replace(/【[^】]*】/g, ' ')
    .replace(/\[[^\]]*]/g, ' ')
    .replace(/（旁白[:：][^）]*）/g, ' ')
    .replace(/\(VO[:：][^)]*\)/gi, ' ')
    .trim();

const estimateSpeechSeconds = (text: string): number => {
  const cleaned = stripDialogueMarkup(text).replace(/[\s[\]【】「」『』（）()"'“”‘’：:；;，,。.!！?？…—\-]/g, '');
  if (!cleaned) return 0;
  const han = (cleaned.match(/[\u4e00-\u9fff]/g) || []).length;
  const latin = cleaned.replace(/[\u4e00-\u9fff]/g, ' ').trim();
  const words = latin ? latin.split(/\s+/).filter(Boolean).length : 0;
  return han / 4 + words / 2.5;
};

const estimateActionSeconds = (action: string, camera: string): number => {
  const summary = (action || '').trim();
  if (!summary && !camera) return 3;
  let seconds = 3;
  if (summary.length > 40) seconds += 2;
  if (summary.length > 90) seconds += 2;
  const beats = (summary.match(/[。；;]|然后|接着|随后|同时/g) || []).length;
  seconds += Math.min(4, beats);
  if (/推|拉|摇|移|跟拍|环绕|升起|下降|环移/.test(`${summary} ${camera || ''}`)) {
    seconds += 2;
  }
  return seconds;
};

const snapDuration = (needed: number, supported: VideoDuration[]): VideoDuration => {
  const options = [...(supported.length ? supported : DEFAULT_SUPPORTED)].sort((a, b) => a - b);
  return options.find((item) => item >= needed) ?? options[options.length - 1];
};

/**
 * 按对白、动作、运镜和规划时长，推荐最接近的模型档位（5/10/15 等）。
 */
export const recommendVideoDuration = (
  shot: Shot,
  supportedDurations?: VideoDuration[],
  planningShotDuration?: number,
): VideoDurationRecommendation => {
  const supported = (supportedDurations?.length ? supportedDurations : DEFAULT_SUPPORTED) as VideoDuration[];
  const dialogue = (shot.dubbing?.text || shot.dialogue || '').trim();
  const speechSeconds = estimateSpeechSeconds(dialogue);
  const actionSeconds = estimateActionSeconds(shot.actionSummary || '', shot.cameraMovement || '');
  const planning = Number(planningShotDuration);
  const stored = Number(shot.interval?.duration);

  let estimated = speechSeconds > 0
    ? Math.max(speechSeconds + 1, speechSeconds * 0.4 + actionSeconds)
    : actionSeconds;
  if (Number.isFinite(planning) && planning > 0) {
    estimated = Math.max(estimated, planning * 0.85);
  }

  const duration = snapDuration(estimated, supported);
  const parts: string[] = [];
  if (speechSeconds >= 1) parts.push(`对白约 ${Math.ceil(speechSeconds)} 秒`);
  if (actionSeconds >= 4) parts.push('动作/运镜较满');
  if (Number.isFinite(planning) && planning > 0) parts.push(`规划 ${planning} 秒`);
  if (Number.isFinite(stored) && stored > 0 && stored !== duration) {
    parts.push(`上次 ${stored} 秒`);
  }

  return {
    duration,
    estimatedSeconds: Math.round(estimated * 10) / 10,
    reason: parts.length ? `推荐 ${duration} 秒（${parts.join('，')}）` : `推荐 ${duration} 秒`,
  };
};
