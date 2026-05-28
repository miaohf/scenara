interface FriendlyModerationOptions {
  includeUnknownReasonCode?: boolean;
}

interface ModerationReasonCopy {
  label: string;
  suggestion: string;
}

const MODERATION_REASON_COPY: Record<string, ModerationReasonCopy> = {
  violence: {
    label: '涉及暴力或伤害内容',
    suggestion: '请弱化打斗、攻击、受伤、血腥、武器等描述。',
  },
  'graphic-violence': {
    label: '涉及明显血腥或重度暴力内容',
    suggestion: '请删除血浆、伤口特写、残肢等过于刺激的描述。',
  },
  sexual: {
    label: '涉及成人、裸露或性暗示内容',
    suggestion: '请改成非裸露、非挑逗、非性暗示的中性表达。',
  },
  'people-in-user-uploads': {
    label: '上传的参考图中包含人物或清晰人脸',
    suggestion: '请尽量改用不含人物主体的参考图，或先移除参考图后重试。',
  },
};

const normalizeModerationReason = (reason: string): string =>
  reason.trim().toLowerCase().replace(/_/g, '-');

const extractModerationReasons = (message: string): string[] => {
  const matched = message.match(/Possible reasons:\s*([^\n]+)/i);
  if (!matched?.[1]) return [];

  const reasonSegment = matched[1].trim().replace(/[.。]+$/, '');
  return Array.from(
    new Set(
      reasonSegment
        .split(',')
        .map(normalizeModerationReason)
        .filter(Boolean)
    )
  );
};

const buildUnknownReasonCopy = (
  reason: string,
  includeUnknownReasonCode: boolean
): string => {
  if (!includeUnknownReasonCode) {
    return '触发了内容安全策略，请删减相关敏感描述或参考图后重试。';
  }

  return `触发了内容安全策略（${reason}），请删减相关敏感描述或参考图后重试。`;
};

export const toFriendlyModerationMessage = (
  message?: string | null,
  options: FriendlyModerationOptions = {}
): string | null => {
  if (!message) return null;
  if (!/blocked by our moderation system/i.test(message) && !/Possible reasons:/i.test(message)) {
    return null;
  }

  const reasons = extractModerationReasons(message);
  const lines = ['内容审核未通过，请调整提示词或参考图后重试。'];

  if (reasons.length === 0) {
    lines.push('建议避免血腥暴力、成人性暗示内容；如上传了参考图，尽量不要包含人物或清晰人脸。');
    return lines.join('\n');
  }

  lines.push('你可以这样修改：');
  reasons.forEach((reason) => {
    const copy = MODERATION_REASON_COPY[reason];
    lines.push(
      copy
        ? `- ${copy.label}：${copy.suggestion}`
        : `- ${buildUnknownReasonCopy(reason, !!options.includeUnknownReasonCode)}`
    );
  });

  return lines.join('\n');
};
