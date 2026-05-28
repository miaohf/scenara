import { PromptVersion, PromptVersionSource } from '../types';

const DEFAULT_HISTORY_LIMIT = 30;

const normalizePrompt = (prompt?: string): string => (prompt || '').trim();

export const createPromptVersion = (
  prompt: string,
  source: PromptVersionSource,
  note?: string
): PromptVersion => ({
  id: `pv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  prompt,
  createdAt: Date.now(),
  source,
  note,
});

export const appendPromptVersion = (
  versions: PromptVersion[] | undefined,
  prompt: string | undefined,
  source: PromptVersionSource,
  note?: string,
  maxEntries: number = DEFAULT_HISTORY_LIMIT
): PromptVersion[] => {
  const normalized = normalizePrompt(prompt);
  if (!normalized) return versions ? [...versions] : [];

  const next = versions ? [...versions] : [];
  const last = next[next.length - 1];
  if (last && normalizePrompt(last.prompt) === normalized) {
    return next;
  }

  next.push(createPromptVersion(normalized, source, note));
  if (next.length > maxEntries) {
    return next.slice(next.length - maxEntries);
  }
  return next;
};

export const updatePromptWithVersion = (
  currentPrompt: string | undefined,
  nextPrompt: string | undefined,
  versions: PromptVersion[] | undefined,
  source: PromptVersionSource,
  note?: string
): PromptVersion[] => {
  let nextVersions = versions ? [...versions] : [];
  const normalizedCurrent = normalizePrompt(currentPrompt);
  const normalizedNext = normalizePrompt(nextPrompt);

  // Backfill one baseline entry for existing projects when history is empty.
  if (nextVersions.length === 0 && normalizedCurrent) {
    nextVersions = appendPromptVersion(nextVersions, normalizedCurrent, 'imported', 'Initial snapshot');
  }

  if (!normalizedNext) return nextVersions;
  return appendPromptVersion(nextVersions, normalizedNext, source, note);
};

export const findPromptVersion = (
  versions: PromptVersion[] | undefined,
  versionId: string
): PromptVersion | undefined => {
  if (!versions?.length) return undefined;
  return versions.find((version) => version.id === versionId);
};

