/**
 * Parse user-facing duration strings into seconds.
 * Supported examples:
 * - 90
 * - 90s / 90sec / 90seconds / 90秒
 * - 3m / 3min / 3minutes / 3分钟
 * - 1m30s / 1min30sec
 * - 02:30 (mm:ss)
 */
export const parseDurationToSeconds = (
  input: string | number | null | undefined
): number | null => {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input <= 0) return null;
    return Math.max(1, Math.round(input));
  }

  const raw = String(input || '').trim();
  if (!raw) return null;

  const normalized = raw
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/：/g, ':')
    .replace(/小时|小時/g, 'h')
    .replace(/分钟|分鐘/g, 'm')
    .replace(/秒钟|秒/g, 's');

  const mmss = normalized.match(/^(\d{1,3}):(\d{1,2})$/);
  if (mmss) {
    const minutes = Number(mmss[1]);
    const seconds = Number(mmss[2]);
    if (Number.isFinite(minutes) && Number.isFinite(seconds) && seconds < 60) {
      return Math.max(1, Math.round(minutes * 60 + seconds));
    }
    return null;
  }

  if (/^\d+(?:\.\d+)?$/.test(normalized)) {
    return Math.max(1, Math.round(Number(normalized)));
  }

  const unitSeconds: Record<string, number> = {
    h: 3600,
    hr: 3600,
    hrs: 3600,
    hour: 3600,
    hours: 3600,
    m: 60,
    min: 60,
    mins: 60,
    minute: 60,
    minutes: 60,
    s: 1,
    sec: 1,
    secs: 1,
    second: 1,
    seconds: 1
  };

  const segmentRegex = /(\d+(?:\.\d+)?)(h|hr|hrs|hour|hours|m|min|mins|minute|minutes|s|sec|secs|second|seconds)/g;
  let total = 0;
  let consumed = 0;
  let hasSegment = false;

  let match: RegExpExecArray | null;
  while ((match = segmentRegex.exec(normalized)) !== null) {
    const value = Number(match[1]);
    const unit = match[2];
    if (!Number.isFinite(value) || value < 0) return null;
    total += value * unitSeconds[unit];
    consumed += match[0].length;
    hasSegment = true;
  }

  if (hasSegment && consumed === normalized.length) {
    return Math.max(1, Math.round(total));
  }

  return null;
};
