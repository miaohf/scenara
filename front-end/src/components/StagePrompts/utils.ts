/**
 * StagePrompts utility functions
 */

import { ProjectState, Character, Scene, Prop, Shot, PromptVersion } from '../../types';
import { findPromptVersion, updatePromptWithVersion } from '../../services/promptVersionService';

export type PromptEditType = 'character' | 'character-variation' | 'scene' | 'prop' | 'keyframe' | 'video';

export interface PromptEditPayload {
  type: PromptEditType;
  id: string;
  variationId?: string;
  shotId?: string;
  value: string;
}

const buildVersionUpdate = (
  currentPrompt: string | undefined,
  nextPrompt: string,
  versions: PromptVersion[] | undefined,
  source: 'manual-edit' | 'rollback',
  note?: string
): PromptVersion[] => updatePromptWithVersion(currentPrompt, nextPrompt, versions, source, note);

/**
 * Save prompt edits for different prompt entity types.
 */
export const savePromptEdit = (
  project: ProjectState,
  editingPrompt: PromptEditPayload
): ProjectState => {
  switch (editingPrompt.type) {
    case 'character':
      if (!project.scriptData) return project;
      return {
        ...project,
        scriptData: {
          ...project.scriptData,
          characters: project.scriptData.characters.map((char) =>
            char.id === editingPrompt.id
              ? {
                  ...char,
                  visualPrompt: editingPrompt.value,
                  promptVersions: buildVersionUpdate(
                    char.visualPrompt,
                    editingPrompt.value,
                    char.promptVersions,
                    'manual-edit'
                  ),
                }
              : char
          ),
        },
      };

    case 'character-variation':
      if (!project.scriptData) return project;
      return {
        ...project,
        scriptData: {
          ...project.scriptData,
          characters: project.scriptData.characters.map((char) => {
            if (char.id !== editingPrompt.id) return char;
            return {
              ...char,
              variations: (char.variations || []).map((variation) =>
                variation.id === editingPrompt.variationId
                  ? {
                      ...variation,
                      visualPrompt: editingPrompt.value,
                      promptVersions: buildVersionUpdate(
                        variation.visualPrompt,
                        editingPrompt.value,
                        variation.promptVersions,
                        'manual-edit'
                      ),
                    }
                  : variation
              ),
            };
          }),
        },
      };

    case 'scene':
      if (!project.scriptData) return project;
      return {
        ...project,
        scriptData: {
          ...project.scriptData,
          scenes: project.scriptData.scenes.map((scene) =>
            scene.id === editingPrompt.id
              ? {
                  ...scene,
                  visualPrompt: editingPrompt.value,
                  promptVersions: buildVersionUpdate(
                    scene.visualPrompt,
                    editingPrompt.value,
                    scene.promptVersions,
                    'manual-edit'
                  ),
                }
              : scene
          ),
        },
      };

    case 'prop':
      if (!project.scriptData) return project;
      return {
        ...project,
        scriptData: {
          ...project.scriptData,
          props: (project.scriptData.props || []).map((prop) =>
            prop.id === editingPrompt.id
              ? {
                  ...prop,
                  visualPrompt: editingPrompt.value,
                  promptVersions: buildVersionUpdate(
                    prop.visualPrompt,
                    editingPrompt.value,
                    prop.promptVersions,
                    'manual-edit'
                  ),
                }
              : prop
          ),
        },
      };

    case 'keyframe':
      return {
        ...project,
        shots: project.shots.map((shot) => {
          if (shot.id !== editingPrompt.shotId) return shot;
          return {
            ...shot,
            keyframes: shot.keyframes.map((kf) =>
              kf.id === editingPrompt.id
                ? {
                    ...kf,
                    visualPrompt: editingPrompt.value,
                    promptVersions: buildVersionUpdate(
                      kf.visualPrompt,
                      editingPrompt.value,
                      kf.promptVersions,
                      'manual-edit'
                    ),
                  }
                : kf
            ),
          };
        }),
      };

    case 'video':
      return {
        ...project,
        shots: project.shots.map((shot) => {
          if (shot.id !== editingPrompt.shotId) return shot;
          if (!shot.interval) return shot;
          return {
            ...shot,
            interval: {
              ...shot.interval,
              videoPrompt: editingPrompt.value,
              promptVersions: buildVersionUpdate(
                shot.interval.videoPrompt,
                editingPrompt.value,
                shot.interval.promptVersions,
                'manual-edit'
              ),
            },
          };
        }),
      };

    default:
      return project;
  }
};

/**
 * Return prompt version list for the currently editing target.
 */
export const getPromptVersionsForEdit = (
  project: ProjectState,
  editingPrompt: PromptEditPayload | null
): PromptVersion[] => {
  if (!editingPrompt) return [];
  switch (editingPrompt.type) {
    case 'character':
      return project.scriptData?.characters.find((char) => char.id === editingPrompt.id)?.promptVersions || [];
    case 'character-variation': {
      const char = project.scriptData?.characters.find((entry) => entry.id === editingPrompt.id);
      return char?.variations.find((variation) => variation.id === editingPrompt.variationId)?.promptVersions || [];
    }
    case 'scene':
      return project.scriptData?.scenes.find((scene) => scene.id === editingPrompt.id)?.promptVersions || [];
    case 'prop':
      return project.scriptData?.props?.find((prop) => prop.id === editingPrompt.id)?.promptVersions || [];
    case 'keyframe': {
      const shot = project.shots.find((entry) => entry.id === editingPrompt.shotId);
      return shot?.keyframes.find((frame) => frame.id === editingPrompt.id)?.promptVersions || [];
    }
    case 'video': {
      const shot = project.shots.find((entry) => entry.id === editingPrompt.shotId);
      return shot?.interval?.promptVersions || [];
    }
    default:
      return [];
  }
};

/**
 * Rollback a prompt to a selected historical version.
 */
export const rollbackPromptEdit = (
  project: ProjectState,
  target: Omit<PromptEditPayload, 'value'>,
  versionId: string
): { project: ProjectState; restoredPrompt?: string } => {
  const versions = getPromptVersionsForEdit(project, { ...target, value: '' });
  const selectedVersion = findPromptVersion(versions, versionId);
  if (!selectedVersion) return { project };

  const rollbackNote = `Rollback to version ${new Date(selectedVersion.createdAt).toLocaleString()}`;
  const restoredPrompt = selectedVersion.prompt;

  switch (target.type) {
    case 'character':
      if (!project.scriptData) return { project };
      return {
        project: {
          ...project,
          scriptData: {
            ...project.scriptData,
            characters: project.scriptData.characters.map((char) =>
              char.id === target.id
                ? {
                    ...char,
                    visualPrompt: restoredPrompt,
                    promptVersions: buildVersionUpdate(
                      char.visualPrompt,
                      restoredPrompt,
                      char.promptVersions,
                      'rollback',
                      rollbackNote
                    ),
                  }
                : char
            ),
          },
        },
        restoredPrompt,
      };

    case 'character-variation':
      if (!project.scriptData) return { project };
      return {
        project: {
          ...project,
          scriptData: {
            ...project.scriptData,
            characters: project.scriptData.characters.map((char) => {
              if (char.id !== target.id) return char;
              return {
                ...char,
                variations: (char.variations || []).map((variation) =>
                  variation.id === target.variationId
                    ? {
                        ...variation,
                        visualPrompt: restoredPrompt,
                        promptVersions: buildVersionUpdate(
                          variation.visualPrompt,
                          restoredPrompt,
                          variation.promptVersions,
                          'rollback',
                          rollbackNote
                        ),
                      }
                    : variation
                ),
              };
            }),
          },
        },
        restoredPrompt,
      };

    case 'scene':
      if (!project.scriptData) return { project };
      return {
        project: {
          ...project,
          scriptData: {
            ...project.scriptData,
            scenes: project.scriptData.scenes.map((scene) =>
              scene.id === target.id
                ? {
                    ...scene,
                    visualPrompt: restoredPrompt,
                    promptVersions: buildVersionUpdate(
                      scene.visualPrompt,
                      restoredPrompt,
                      scene.promptVersions,
                      'rollback',
                      rollbackNote
                    ),
                  }
                : scene
            ),
          },
        },
        restoredPrompt,
      };

    case 'prop':
      if (!project.scriptData) return { project };
      return {
        project: {
          ...project,
          scriptData: {
            ...project.scriptData,
            props: (project.scriptData.props || []).map((prop) =>
              prop.id === target.id
                ? {
                    ...prop,
                    visualPrompt: restoredPrompt,
                    promptVersions: buildVersionUpdate(
                      prop.visualPrompt,
                      restoredPrompt,
                      prop.promptVersions,
                      'rollback',
                      rollbackNote
                    ),
                  }
                : prop
            ),
          },
        },
        restoredPrompt,
      };

    case 'keyframe':
      return {
        project: {
          ...project,
          shots: project.shots.map((shot) => {
            if (shot.id !== target.shotId) return shot;
            return {
              ...shot,
              keyframes: shot.keyframes.map((frame) =>
                frame.id === target.id
                  ? {
                      ...frame,
                      visualPrompt: restoredPrompt,
                      promptVersions: buildVersionUpdate(
                        frame.visualPrompt,
                        restoredPrompt,
                        frame.promptVersions,
                        'rollback',
                        rollbackNote
                      ),
                    }
                  : frame
              ),
            };
          }),
        },
        restoredPrompt,
      };

    case 'video':
      return {
        project: {
          ...project,
          shots: project.shots.map((shot) => {
            if (shot.id !== target.shotId || !shot.interval) return shot;
            return {
              ...shot,
              interval: {
                ...shot.interval,
                videoPrompt: restoredPrompt,
                promptVersions: buildVersionUpdate(
                  shot.interval.videoPrompt,
                  restoredPrompt,
                  shot.interval.promptVersions,
                  'rollback',
                  rollbackNote
                ),
              },
            };
          }),
        },
        restoredPrompt,
      };

    default:
      return { project };
  }
};

/**
 * Search filter helper.
 */
export const filterBySearch = (text: string | undefined | null, searchQuery: string): boolean => {
  if (!searchQuery.trim()) return true;
  return (text || '').toLowerCase().includes(searchQuery.toLowerCase());
};

/**
 * Filter characters by search query.
 */
export const filterCharacters = (characters: Character[], searchQuery: string): Character[] => {
  return characters.filter(
    (char) =>
      filterBySearch(char.name, searchQuery) ||
      filterBySearch(char.visualPrompt || '', searchQuery) ||
      (char.variations || []).some(
        (variation) =>
          filterBySearch(variation.name, searchQuery) ||
          filterBySearch(variation.visualPrompt, searchQuery)
      )
  );
};

/**
 * Filter scenes by search query.
 */
export const filterScenes = (scenes: Scene[], searchQuery: string): Scene[] => {
  return scenes.filter(
    (scene) => filterBySearch(scene.location, searchQuery) || filterBySearch(scene.visualPrompt || '', searchQuery)
  );
};

/**
 * Filter props by search query.
 */
export const filterProps = (props: Prop[], searchQuery: string): Prop[] => {
  return props.filter(
    (prop) =>
      filterBySearch(prop.name, searchQuery) ||
      filterBySearch(prop.description || '', searchQuery) ||
      filterBySearch(prop.visualPrompt || '', searchQuery)
  );
};

/**
 * Filter shots by search query.
 */
export const filterShots = (shots: Shot[], searchQuery: string): Shot[] => {
  return shots.filter((shot) => {
    const hasMatchingShotMeta =
      filterBySearch(shot.actionSummary, searchQuery) ||
      filterBySearch(shot.cameraMovement, searchQuery) ||
      filterBySearch(shot.shotSize, searchQuery);
    const hasMatchingKeyframe = shot.keyframes.some((frame) => filterBySearch(frame.visualPrompt, searchQuery));
    const hasMatchingVideoPrompt = filterBySearch(shot.interval?.videoPrompt, searchQuery);
    return hasMatchingShotMeta || hasMatchingKeyframe || hasMatchingVideoPrompt;
  });
};

/**
 * Build a fallback video prompt when no saved video prompt exists.
 */
export const getDefaultVideoPrompt = (shot: Shot): string =>
  `${shot.actionSummary}\n\nCamera: ${shot.cameraMovement}\nModel: ${shot.videoModel || 'sora-2'}`;

