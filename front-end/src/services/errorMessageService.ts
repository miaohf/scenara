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

const COMFYUI_UNAVAILABLE_MESSAGE =
  '无法连接本地 ComfyUI。请先启动 ComfyUI（默认 http://127.0.0.1:8188），并在「模型配置」里核对 API 地址。';

const BACKEND_UNAVAILABLE_MESSAGE =
  '无法连接后端服务。请确认 API 已启动后重试。';

const extractErrorText = (error: unknown): { message: string; status?: number } => {
  if (!error) return { message: '' };
  if (typeof error === 'string') return { message: error };
  const maybe = error as { message?: unknown; status?: unknown; detail?: unknown };
  const message =
    typeof maybe.message === 'string'
      ? maybe.message
      : typeof maybe.detail === 'string'
        ? maybe.detail
        : '';
  const status = typeof maybe.status === 'number' ? maybe.status : undefined;
  return { message, status };
};

const looksLikeComfyUnavailable = (text: string): boolean => {
  const lower = text.toLowerCase();
  return (
    /无法连接\s*comfyui/.test(text) ||
    /comfyui.*无法连接|无法连接.*comfyui/.test(lower) ||
    (/(econnrefused|err_connection_refused|connecterror|all connection attempts failed)/.test(lower) &&
      /comfy|8188|8189/.test(lower))
  );
};

const looksLikeNetworkFailure = (text: string): boolean => {
  const lower = text.toLowerCase();
  return (
    /failed to fetch|networkerror|err_connection|econnrefused|enotfound|ehostunreach|connecterror|all connection attempts failed|connection refused|name or service not known|network request failed/.test(
      lower
    ) || /无法连接/.test(text)
  );
};

export const toFriendlyAiError = (error: unknown, fallback: string): string => {
  const { message, status } = extractErrorText(error);
  const moderationMessage = toFriendlyModerationMessage(message, {
    includeUnknownReasonCode: process.env.NODE_ENV === 'development',
  });
  if (moderationMessage) return moderationMessage;

  if (looksLikeComfyUnavailable(message)) {
    return COMFYUI_UNAVAILABLE_MESSAGE;
  }
  if (looksLikeNetworkFailure(message)) {
    return /comfy|8188|8189/.test(message.toLowerCase())
      ? COMFYUI_UNAVAILABLE_MESSAGE
      : BACKEND_UNAVAILABLE_MESSAGE;
  }
  if (status === 503 || /service unavailable/i.test(message)) {
    return /comfy/i.test(message) ? COMFYUI_UNAVAILABLE_MESSAGE : BACKEND_UNAVAILABLE_MESSAGE;
  }
  if (message === 'Internal Server Error' || message === 'Request failed') {
    return '生成服务暂时不可用，请稍后重试。若使用本地模型，请确认对应服务已启动。';
  }

  let normalized = message || fallback;
  if (!normalized) {
    if (status === 400) normalized = '提示词可能被风控拦截，请修改提示词后重试。';
    else if (status === 500 || status === 503) normalized = fallback;
    else normalized = fallback;
  }

  if (process.env.NODE_ENV !== 'development') {
    normalized = normalized.replace(/（接口信息：.*?）/g, '');
  }
  return normalized || fallback;
};
