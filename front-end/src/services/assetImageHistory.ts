import type { AssetImageHistoryEntry, AssetImageHistorySource, Character, Prop, Scene } from '@/types';

const MAX_ASSET_IMAGE_HISTORY = 12;
type ImageAsset = Character | Scene | Prop;

export const assetImageKey = (imageUrl?: string): string => {
  if (!imageUrl) return '';
  return imageUrl.startsWith('data:') ? imageUrl : imageUrl.split('?')[0];
};

// 兼容旧项目中删除记录保存为完整 URL 的情况。
export const isAssetImageRemoved = (removedImageKeys: string[] | undefined, imageUrl?: string): boolean => {
  const key = assetImageKey(imageUrl);
  return !!key && (removedImageKeys || []).some((removedKey) => assetImageKey(removedKey) === key);
};

export const sameAssetImage = (left?: string, right?: string): boolean =>
  !!left && !!right && assetImageKey(left) === assetImageKey(right);

export const unionRemovedImageKeys = (left?: string[], right?: string[]): string[] | undefined => {
  const merged: string[] = [];
  for (const key of [...(left || []), ...(right || [])]) {
    if (key && !merged.includes(key)) merged.push(key);
  }
  const limited = merged.slice(-48);
  if (left && left.length === limited.length && left.every((key, index) => key === limited[index])) return left;
  return limited.length ? limited : undefined;
};

const isRemovedImage = (asset: ImageAsset, imageUrl?: string): boolean => {
  return isAssetImageRemoved(asset.removedImageKeys, imageUrl);
};

export function dismissAssetImage(asset: ImageAsset, imageUrl: string | undefined): void {
  const key = assetImageKey(imageUrl);
  if (!key) return;
  if (!isAssetImageRemoved(asset.removedImageKeys, imageUrl)) {
    asset.removedImageKeys = [...(asset.removedImageKeys || []), key].slice(-48);
  }
  asset.imageHistory = (asset.imageHistory || []).filter((entry) => !sameAssetImage(entry.imageUrl, imageUrl));
}

export function addAssetImageHistory(
  asset: ImageAsset,
  imageUrl: string | undefined,
  source: AssetImageHistorySource,
  prompt?: string,
): void {
  if (!imageUrl || isRemovedImage(asset, imageUrl)) return;
  const previous = asset.imageHistory || [];
  const existing = previous.find((entry) => sameAssetImage(entry.imageUrl, imageUrl));
  asset.imageHistory = [
    {
      id: existing?.id || `asset-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      imageUrl,
      createdAt: existing?.createdAt || Date.now(),
      source,
      prompt: prompt || existing?.prompt,
    },
    ...previous.filter((item) => !sameAssetImage(item.imageUrl, imageUrl)),
  ].slice(0, MAX_ASSET_IMAGE_HISTORY);
}

export function mergeAssetImageHistories(
  local: AssetImageHistoryEntry[] | undefined,
  server: AssetImageHistoryEntry[] | undefined,
  removedImageKeys?: string[],
): AssetImageHistoryEntry[] | undefined {
  if (!local?.length && !server?.length) return local;
  const merged: AssetImageHistoryEntry[] = [];
  for (const entry of [...(local || []), ...(server || [])].sort((a, b) => b.createdAt - a.createdAt)) {
    const key = assetImageKey(entry.imageUrl);
    if (!key || isAssetImageRemoved(removedImageKeys, entry.imageUrl)) continue;
    if (!merged.some((item) => sameAssetImage(item.imageUrl, entry.imageUrl))) merged.push(entry);
  }
  const limited = merged.slice(0, MAX_ASSET_IMAGE_HISTORY);
  if (local && local.length === limited.length && local.every((entry, index) => entry.id === limited[index]?.id && sameAssetImage(entry.imageUrl, limited[index]?.imageUrl))) {
    return local;
  }
  return limited;
}

export function getAssetImageHistory(asset: ImageAsset): AssetImageHistoryEntry[] {
  const history = (asset.imageHistory || []).flatMap((entry) => {
    if (isRemovedImage(asset, entry.imageUrl)) return [];
    return [asset.referenceImage && sameAssetImage(entry.imageUrl, asset.referenceImage)
      ? { ...entry, imageUrl: asset.referenceImage }
      : entry];
  });
  if (asset.referenceImage && !isRemovedImage(asset, asset.referenceImage) && !history.some((entry) => sameAssetImage(entry.imageUrl, asset.referenceImage))) {
    history.unshift({
      id: `current-${asset.id}`,
      imageUrl: asset.referenceImage,
      createdAt: (history[0]?.createdAt || 0) + 1,
      source: 'generated',
      prompt: asset.visualPrompt,
    });
  }
  return history.slice(0, MAX_ASSET_IMAGE_HISTORY);
}
