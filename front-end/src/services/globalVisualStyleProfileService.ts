import type { VisualStyleProfile } from '../types';
import { getRegistryState, hydrateRegistryFromServer, saveRegistry } from './modelRegistry';

const normalizeProfiles = (profiles: unknown): VisualStyleProfile[] => (
  Array.isArray(profiles) ? profiles as VisualStyleProfile[] : []
);

/**
 * Visual-style definitions and their preview images are account-wide resources.
 * They deliberately live alongside the account registry, rather than in a project.
 */
export const loadGlobalVisualStyleProfiles = (): VisualStyleProfile[] => (
  normalizeProfiles(getRegistryState().visualStyleProfiles)
);

export const hydrateGlobalVisualStyleProfiles = async (): Promise<VisualStyleProfile[]> => {
  try {
    await hydrateRegistryFromServer();
  } catch {
    // Offline/local mode deliberately falls back to the browser-wide registry.
  }
  return loadGlobalVisualStyleProfiles();
};

export const saveGlobalVisualStyleProfiles = async (
  profiles: VisualStyleProfile[],
): Promise<void> => {
  const registry = getRegistryState();
  await saveRegistry({ ...registry, visualStyleProfiles: profiles });
};

/** Keep older per-project style previews without allowing them to overwrite shared edits. */
export const mergeLegacyVisualStyleProfiles = (
  shared: VisualStyleProfile[],
  legacy: VisualStyleProfile[] = [],
): VisualStyleProfile[] => {
  const knownKeys = new Set(shared.map((profile) => profile.styleKey || profile.id));
  const additions = legacy.filter((profile) => !knownKeys.has(profile.styleKey || profile.id));
  return additions.length ? [...shared, ...additions] : shared;
};
