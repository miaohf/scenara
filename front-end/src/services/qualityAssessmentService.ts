import { ScriptData, Shot, ShotQualityAssessment, QualityCheck } from '../types';
import { findSceneByIdCompat } from './storyboardIdUtils';

const QUALITY_SCHEMA_VERSION = 1;

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const resolveSupportsEndFrame = (modelId?: string): boolean => {
  const id = (modelId || '').toLowerCase();
  if (!id) return false;
  if (id.startsWith('sora') || id.startsWith('doubao-seedance')) return false;
  return true;
};

const pickCheck = (
  key: string,
  label: string,
  score: number,
  weight: number,
  details?: string
): QualityCheck => ({
  key,
  label,
  score: clamp(Math.round(score), 0, 100),
  weight,
  passed: score >= 70,
  details,
});

const evaluatePromptReadiness = (shot: Shot): QualityCheck => {
  const startPrompt = shot.keyframes?.find((frame) => frame.type === 'start')?.visualPrompt?.trim() || '';
  const endPrompt = shot.keyframes?.find((frame) => frame.type === 'end')?.visualPrompt?.trim() || '';
  const videoPrompt = shot.interval?.videoPrompt?.trim() || '';
  const actionSummaryLen = shot.actionSummary.trim().length;

  let startScore = 0;
  if (startPrompt.length >= 40) startScore = 45;
  else if (startPrompt.length >= 16) startScore = 30;
  else if (startPrompt.length > 0) startScore = 15;

  let endScore = 0;
  if (endPrompt.length >= 30) endScore = 25;
  else if (endPrompt.length > 0) endScore = 10;

  let videoScore = 0;
  if (videoPrompt.length >= 30) videoScore = 20;
  else if (videoPrompt.length > 0) videoScore = 10;

  const actionScore = actionSummaryLen >= 12 ? 10 : 0;
  const score = startScore + endScore + videoScore + actionScore;

  const details = [
    '规则：起始提示词45分 + 结束提示词25分 + 视频提示词20分 + 动作摘要10分',
    `起始提示词长度 ${startPrompt.length} 字符 -> ${startScore} 分（>=40 得45；16-39 得30；1-15 得15）`,
    `结束提示词长度 ${endPrompt.length} 字符 -> ${endScore} 分（>=30 得25；1-29 得10）`,
    `视频提示词长度 ${videoPrompt.length} 字符 -> ${videoScore} 分（>=30 得20；1-29 得10）`,
    `动作摘要长度 ${actionSummaryLen} 字符 -> ${actionScore} 分（>=12 得10）`,
  ].join('\n');

  return pickCheck(
    'prompt-readiness',
    'Prompt Readiness',
    score,
    30,
    details
  );
};

const evaluateAssetCoverage = (shot: Shot, scriptData?: ScriptData | null): QualityCheck => {
  if (!scriptData) {
    return pickCheck(
      'asset-coverage',
      'Asset Coverage',
      35,
      20,
      '未检测到剧本资产数据，无法核验场景/角色/道具参考图，按保守分 35 计算。'
    );
  }

  const scene = findSceneByIdCompat(scriptData.scenes, shot.sceneId);
  const sceneScore = scene?.referenceImage ? 35 : 10;

  const charIds = shot.characters || [];
  const charDetails: string[] = [];
  const charScoreParts = charIds.map((charId) => {
    const char = scriptData.characters.find((entry) => String(entry.id) === String(charId));
    if (!char) {
      charDetails.push(`角色 ${charId}：未找到角色数据（0分）`);
      return 0;
    }
    const variationId = shot.characterVariations?.[charId];
    if (variationId) {
      const variation = char.variations?.find((entry) => entry.id === variationId);
      if (variation?.referenceImage) {
        charDetails.push(`${char.name}(${variation.name})：有变体参考图（25分）`);
        return 25;
      }
    }
    if (char.referenceImage) {
      charDetails.push(`${char.name}：有角色参考图（25分）`);
      return 25;
    }
    charDetails.push(`${char.name}：缺少角色参考图（5分）`);
    return 5;
  });
  const characterScore = charScoreParts.length
    ? charScoreParts.reduce((sum, value) => sum + value, 0) / charScoreParts.length
    : 20;

  const props = shot.props || [];
  const propDetails: string[] = [];
  const propScoreParts = props.map((propId) => {
    const prop = scriptData.props?.find((entry) => String(entry.id) === String(propId));
    if (!prop) {
      propDetails.push(`道具 ${propId}：未找到道具数据（0分）`);
      return 0;
    }
    if (prop.referenceImage) {
      propDetails.push(`${prop.name}：有参考图（10分）`);
      return 10;
    }
    propDetails.push(`${prop.name}：缺少参考图（4分）`);
    return 4;
  });
  const propScore = propScoreParts.length
    ? propScoreParts.reduce((sum, value) => sum + value, 0) / propScoreParts.length
    : 10;

  const totalScore = sceneScore + characterScore + propScore;
  const details = [
    '规则：场景参考图最高35分 + 角色参考图平均最高25分 + 道具参考图平均最高10分',
    `场景「${scene?.location || shot.sceneId}」：${scene?.referenceImage ? '有参考图（35分）' : '无参考图（10分）'}`,
    charIds.length
      ? `角色(${charIds.length})：${charDetails.join('；')} -> 平均 ${Math.round(characterScore)} 分`
      : '角色：本镜头未绑定角色，按默认 20 分',
    props.length
      ? `道具(${props.length})：${propDetails.join('；')} -> 平均 ${Math.round(propScore)} 分`
      : '道具：本镜头未绑定道具，按默认 10 分',
    `总分：${Math.round(totalScore)}/100`,
  ].join('\n');

  return pickCheck(
    'asset-coverage',
    'Asset Coverage',
    totalScore,
    20,
    details
  );
};

const evaluateKeyframeExecution = (shot: Shot): QualityCheck => {
  const startFrame = shot.keyframes?.find((frame) => frame.type === 'start');
  const endFrame = shot.keyframes?.find((frame) => frame.type === 'end');
  const supportsEndFrame = resolveSupportsEndFrame(shot.videoModel);

  const describeFrame = (label: string, frame?: Shot['keyframes'][number]) => {
    const status = frame?.status || 'pending';
    const hasImage = !!frame?.imageUrl;
    const hasPrompt = !!frame?.visualPrompt;
    return `${label}：状态 ${status}，${hasImage ? '已出图' : '未出图'}，${hasPrompt ? '有提示词' : '无提示词'}`;
  };

  let startScore = 0;
  if (startFrame?.imageUrl) startScore = 55;
  else if (startFrame?.status === 'generating') startScore = 25;
  else if (startFrame?.visualPrompt) startScore = 15;

  let endScore = 0;
  if (supportsEndFrame) {
    if (endFrame?.imageUrl) endScore = 35;
    else if (endFrame?.status === 'generating') endScore = 15;
    else if (endFrame?.visualPrompt) endScore = 10;
  } else {
    endScore = 30;
  }

  let penalty = 0;
  if (startFrame?.status === 'failed' || endFrame?.status === 'failed') {
    penalty = -20;
  }

  const score = startScore + endScore + penalty;
  const details = [
    '规则：首帧最高55分 + 尾帧最高35分（若模型不支持尾帧则固定30分）+ 失败惩罚20分',
    describeFrame('首帧', startFrame),
    supportsEndFrame
      ? describeFrame('尾帧', endFrame)
      : `尾帧：当前模型 ${shot.videoModel || '未设置'} 不支持尾帧插值，按固定 30 分处理`,
    penalty < 0 ? '检测到关键帧失败状态：额外扣 20 分' : '未检测到关键帧失败状态：不扣分',
    `总分：${Math.round(score)}/100`,
  ].join('\n');

  return pickCheck(
    'keyframe-execution',
    'Keyframe Execution',
    score,
    30,
    details
  );
};

const evaluateVideoExecution = (shot: Shot): QualityCheck => {
  const interval = shot.interval;
  if (!interval) {
    return pickCheck(
      'video-execution',
      'Video Execution',
      30,
      20,
      '未检测到视频生成记录：当前镜头还未发起视频生成，因此按基础分 30 计算。'
    );
  }

  let score = 0;
  let reason = '';
  if (interval.videoUrl && interval.status === 'completed') score = 100;
  else if (interval.status === 'generating') score = 55;
  else if (interval.status === 'pending') score = 35;
  else if (interval.status === 'failed') score = 10;

  if (interval.videoUrl && interval.status === 'completed') {
    reason = '视频已成功生成并回填URL（100分）。';
  } else if (interval.status === 'generating') {
    reason = '视频仍在生成中（55分）。';
  } else if (interval.status === 'pending') {
    reason = '视频任务处于待生成状态（35分）。';
  } else if (interval.status === 'failed') {
    reason = '视频生成失败（10分）。';
  } else {
    reason = `视频状态为 ${interval.status}，按保守分 ${score} 处理。`;
  }

  const details = [
    '规则：completed=100，generating=55，pending=35，failed=10',
    `当前状态：${interval.status}，${interval.videoUrl ? '已存在视频URL' : '无视频URL'}`,
    reason,
  ].join('\n');

  return pickCheck(
    'video-execution',
    'Video Execution',
    score,
    20,
    details
  );
};

const evaluateContinuity = (shot: Shot): QualityCheck => {
  const startFrame = shot.keyframes?.find((frame) => frame.type === 'start');
  const endFrame = shot.keyframes?.find((frame) => frame.type === 'end');
  const supportsEndFrame = resolveSupportsEndFrame(shot.videoModel);
  const hasCharacters = (shot.characters?.length || 0) > 0;

  let baseScore = 40;
  let startBonus = 0;
  let endBonus = 0;
  let modelCompensation = 0;
  let charPenalty = 0;
  let charEndPenalty = 0;

  if (startFrame?.imageUrl) startBonus = 25;
  if (supportsEndFrame && endFrame?.imageUrl) endBonus = 25;
  if (!supportsEndFrame) modelCompensation = 20;

  if (hasCharacters && !startFrame?.imageUrl) charPenalty = -20;
  if (supportsEndFrame && hasCharacters && !endFrame?.imageUrl) charEndPenalty = -10;

  const score = baseScore + startBonus + endBonus + modelCompensation + charPenalty + charEndPenalty;
  const details = [
    '规则：基础40分 + 首帧锚点25分 + 尾帧锚点25分（模型不支持尾帧时补偿20分）+ 角色缺锚点惩罚',
    `模型：${shot.videoModel || '未设置'}，${supportsEndFrame ? '支持尾帧插值' : '不支持尾帧插值'}`,
    `首帧锚点：${startFrame?.imageUrl ? '已提供（+25）' : '未提供（+0）'}`,
    supportsEndFrame
      ? `尾帧锚点：${endFrame?.imageUrl ? '已提供（+25）' : '未提供（+0）'}`
      : '尾帧锚点：模型不支持，使用补偿分（+20）',
    hasCharacters
      ? `角色镜头惩罚：${!startFrame?.imageUrl ? '缺少首帧锚点（-20）' : '首帧锚点完整（0）'}${supportsEndFrame && !endFrame?.imageUrl ? '；缺少尾帧锚点（-10）' : ''}`
      : '非角色镜头：不触发角色锚点惩罚',
    `总分：${Math.round(score)}/100`,
  ].join('\n');

  return pickCheck(
    'continuity-risk',
    'Continuity Risk',
    score,
    10,
    details
  );
};

const weightedScore = (checks: QualityCheck[]): number => {
  const weightedSum = checks.reduce((sum, check) => sum + check.score * check.weight, 0);
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0) || 1;
  return Math.round(weightedSum / totalWeight);
};

const resolveGrade = (score: number): ShotQualityAssessment['grade'] => {
  if (score >= 80) return 'pass';
  if (score >= 60) return 'warning';
  return 'fail';
};

const buildSummary = (checks: QualityCheck[], grade: ShotQualityAssessment['grade']): string => {
  const failedChecks = checks.filter((check) => !check.passed).map((check) => check.label);
  if (!failedChecks.length) {
    return '可进入生产，核心检查项已通过。';
  }

  const prefix =
    grade === 'fail'
      ? '风险较高：'
      : grade === 'warning'
        ? '需要优化：'
        : '轻微问题：';
  return `${prefix}${failedChecks.join('、')}`;
};

export const assessShotQuality = (
  shot: Shot,
  scriptData?: ScriptData | null
): ShotQualityAssessment => {
  const checks: QualityCheck[] = [
    evaluatePromptReadiness(shot),
    evaluateAssetCoverage(shot, scriptData),
    evaluateKeyframeExecution(shot),
    evaluateVideoExecution(shot),
    evaluateContinuity(shot),
  ];

  const score = weightedScore(checks);
  const grade = resolveGrade(score);

  return {
    version: QUALITY_SCHEMA_VERSION,
    score,
    grade,
    generatedAt: Date.now(),
    checks,
    summary: buildSummary(checks, grade),
  };
};

export const getProjectAverageQualityScore = (shots: Shot[]): number => {
  const assessments = shots
    .map((shot) => shot.qualityAssessment)
    .filter((assessment): assessment is ShotQualityAssessment => !!assessment);

  if (!assessments.length) return 0;
  const sum = assessments.reduce((acc, assessment) => acc + assessment.score, 0);
  return Math.round(sum / assessments.length);
};
