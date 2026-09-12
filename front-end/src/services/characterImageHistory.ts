import type {
  Character,
  CharacterImageHistoryEntry,
  CharacterImageHistorySource,
  CharacterImageView,
} from '@/types';

const MAX_CHARACTER_IMAGE_HISTORY = 12;

const imageIdentity = (imageUrl: string): string => {
  if (imageUrl.startsWith('data:')) return imageUrl;
  return imageUrl.split('?')[0];
};

export const sameCharacterImage = (left?: string, right?: string): boolean =>
  !!left && !!right && imageIdentity(left) === imageIdentity(right);

export function addCharacterImageHistory(
  character: Character,
  imageUrl: string | undefined,
  source: CharacterImageHistorySource,
  prompt?: string,
): void {
  if (!imageUrl) return;
  const previous = character.imageHistory || [];
  const existing = previous.find((entry) => sameCharacterImage(entry.imageUrl, imageUrl));
  const entry: CharacterImageHistoryEntry = {
    id: existing?.id || `char-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    imageUrl,
    createdAt: existing?.createdAt || Date.now(),
    source,
    prompt: prompt || existing?.prompt,
  };
  character.imageHistory = [
    entry,
    ...previous.filter((item) => !sameCharacterImage(item.imageUrl, imageUrl)),
  ].slice(0, MAX_CHARACTER_IMAGE_HISTORY);
}

export const getCharacterImageHistory = (character: Character): CharacterImageHistoryEntry[] => {
  const history = [...(character.imageHistory || [])];
  if (character.referenceImage && !history.some((entry) => sameCharacterImage(entry.imageUrl, character.referenceImage))) {
    history.unshift({
      id: `current-${character.id}`,
      imageUrl: character.referenceImage,
      createdAt: (history[0]?.createdAt || 0) + 1,
      source: 'generated',
      prompt: character.visualPrompt,
    });
  }
  return history.slice(0, MAX_CHARACTER_IMAGE_HISTORY);
};

export const mergeCharacterImageHistories = (
  local: CharacterImageHistoryEntry[] | undefined,
  server: CharacterImageHistoryEntry[] | undefined,
): CharacterImageHistoryEntry[] | undefined => {
  if (!local?.length && !server?.length) return local;
  const merged: CharacterImageHistoryEntry[] = [];
  for (const entry of [...(local || []), ...(server || [])].sort((a, b) => b.createdAt - a.createdAt)) {
    if (!merged.some((item) => sameCharacterImage(item.imageUrl, entry.imageUrl))) merged.push(entry);
  }
  const limited = merged.slice(0, MAX_CHARACTER_IMAGE_HISTORY);
  if (local && local.length === limited.length && local.every((entry, index) => entry.id === limited[index]?.id && sameCharacterImage(entry.imageUrl, limited[index]?.imageUrl))) {
    return local;
  }
  return limited;
};

export const resolveCharacterImageView = (character: Character): CharacterImageView => {
  if (character.activeImageView === 'turnaround' && character.turnaround?.imageUrl) return 'turnaround';
  if (character.activeImageView === 'threeView' && character.threeView?.imageUrl) return 'threeView';
  if (character.activeImageView === 'casting' && character.referenceImage) return 'casting';
  if (character.turnaround?.status === 'completed' && character.turnaround.imageUrl) return 'turnaround';
  if (character.threeView?.status === 'completed' && character.threeView.imageUrl) return 'threeView';
  return 'casting';
};

export const resolveCharacterDisplayImage = (character: Character): string | undefined => {
  const view = resolveCharacterImageView(character);
  if (view === 'turnaround') return character.turnaround?.imageUrl;
  if (view === 'threeView') return character.threeView?.imageUrl;
  return character.referenceImage;
};
