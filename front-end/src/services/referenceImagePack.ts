export type ReferenceImageKind = 'scene' | 'character' | 'prop' | 'turnaround' | 'storyboard';

export interface ReferenceImageEntry {
  image: string;
  type: ReferenceImageKind;
  label: string;
  detail?: string;
  detailZh?: string;
  detailEn?: string;
  isComposite?: boolean;
  includedLabels?: string[];
}

export interface ReferenceCompositeSummary {
  type: Exclude<ReferenceImageKind, 'scene'>;
  count: number;
  entry: ReferenceImageEntry;
}

export interface ReferenceSlotInspection {
  slot: number;
  kind: 'reference' | 'continuity' | 'reserved' | 'empty';
  role: string;
  label: string;
  detail?: string;
  detailZh?: string;
  detailEn?: string;
  image?: string;
  includedLabels?: string[];
}

export interface DroppedReferenceInspection {
  entry: ReferenceImageEntry;
  reason: 'slot-limit';
}

export interface ReferenceImagePack {
  referenceImages: string[];
  entries: ReferenceImageEntry[];
  referenceAnnotations: string[];
  continuityReferenceImage?: string;
  requestedReferenceCount: number;
  effectiveReferenceCount: number;
  maxReferenceImages: number;
  droppedEntries: ReferenceImageEntry[];
  compositeGroups: ReferenceCompositeSummary[];
  slots: ReferenceSlotInspection[];
  droppedInspections: DroppedReferenceInspection[];
  reservedReferenceSlots: number;
  usableReferenceSlots: number;
  usedCharacterPanorama: boolean;
  stitchedCharacterCount: number;
}

interface BuildReferenceImagePackOptions {
  maxReferenceImages?: number;
  reservedReferenceSlots?: number;
  continuityReferenceImage?: string;
  /** 强制把同类参考图合成全景（用于 UI 预览）；生图链路请勿开启 */
  alwaysCompositeTypes?: ReferenceImageKind[];
  /**
   * 生图链路禁用拼装：即使超出槽位也不合并为全景图，只按上限截取单图。
   * 拼装图可另由 alwaysCompositeTypes 在预览侧生成，勿混入 referenceImages。
   */
  disableCompositing?: boolean;
}

const DEFAULT_MAX_REFERENCES = 5;
const MAX_COMPOSITE_WIDTH = 3072;
const HORIZONTAL_PADDING = 56;
const VERTICAL_PADDING = 64;

const normalize = (value?: string): string => String(value || '').trim();

const dedupeEntries = (entries: ReferenceImageEntry[]): ReferenceImageEntry[] => {
  const seen = new Set<string>();
  return entries.reduce<ReferenceImageEntry[]>((output, entry) => {
    const image = normalize(entry.image);
    if (!image || seen.has(image)) return output;
    seen.add(image);
    output.push({ ...entry, image });
    return output;
  }, []);
};

const loadImage = (source: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    if (/^https?:\/\//i.test(source)) image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('参考图读取失败，无法生成合并预览。'));
    image.src = source;
  });

const compositeBackground = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  type: ReferenceImageKind,
) => {
  const gradient = context.createLinearGradient(0, 0, 0, height);
  if (type === 'prop') {
    gradient.addColorStop(0, '#eef3f7');
    gradient.addColorStop(0.55, '#f7fafc');
  } else if (type === 'turnaround') {
    gradient.addColorStop(0, '#f1efe9');
    gradient.addColorStop(0.55, '#f8f6f1');
  } else {
    gradient.addColorStop(0, '#f7f3eb');
    gradient.addColorStop(0.55, '#fbfaf6');
  }
  gradient.addColorStop(1, '#ffffff');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
};

/**
 * 把同类参考图横向排成一张全景图。这里只整理输入槽位，不调用任何 AI 服务。
 */
export const composeReferencePanorama = async (
  entries: ReferenceImageEntry[],
  type: Exclude<ReferenceImageKind, 'scene'>,
): Promise<ReferenceImageEntry> => {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('当前环境不支持 Canvas 参考图合并。');
  }
  if (entries.length < 2) throw new Error('至少需要两张同类参考图才能合并。');

  const loaded = await Promise.all(entries.map(async (entry) => ({
    entry,
    image: await loadImage(entry.image),
  })));
  const count = loaded.length;
  const gap = type === 'character' ? (count <= 3 ? 40 : count <= 5 ? 30 : 24) : count <= 4 ? 28 : 22;
  const targetWidth = type === 'character'
    ? count <= 3 ? 620 : count <= 5 ? 520 : 420
    : type === 'prop'
      ? count <= 4 ? 460 : 360
      : count <= 3 ? 700 : 520;
  const usableWidth = MAX_COMPOSITE_WIDTH - HORIZONTAL_PADDING * 2 - gap * Math.max(0, count - 1);
  const cellWidth = Math.max(240, Math.min(targetWidth, Math.floor(usableWidth / count)));
  const averageAspect = loaded.reduce(
    (sum, item) => sum + item.image.width / Math.max(1, item.image.height),
    0,
  ) / count;
  const characterHeightFactor = Math.max(0.82, Math.min(1.7, 1.05 / Math.max(0.01, averageAspect)));
  const cellHeight = Math.round(
    type === 'character' ? cellWidth * characterHeightFactor : type === 'prop' ? cellWidth * 1.08 : cellWidth * 0.9,
  );
  const canvas = document.createElement('canvas');
  canvas.width = HORIZONTAL_PADDING * 2 + cellWidth * count + gap * Math.max(0, count - 1);
  canvas.height = VERTICAL_PADDING * 2 + cellHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建参考图合并画布。');

  compositeBackground(context, canvas.width, canvas.height, type);
  loaded.forEach(({ image }, index) => {
    const cellX = HORIZONTAL_PADDING + index * (cellWidth + gap);
    const scale = Math.min(cellWidth / image.width, cellHeight / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    const drawX = cellX + (cellWidth - drawWidth) / 2;
    const bottomAligned = type === 'character' && characterHeightFactor >= 1.3;
    const drawY = bottomAligned
      ? VERTICAL_PADDING + cellHeight - drawHeight
      : VERTICAL_PADDING + (cellHeight - drawHeight) / 2;

    context.fillStyle = 'rgba(0, 0, 0, 0.06)';
    context.beginPath();
    context.ellipse(
      cellX + cellWidth / 2,
      VERTICAL_PADDING + cellHeight - 8,
      Math.max(24, Math.min(cellWidth * 0.28, drawWidth * 0.34)),
      type === 'turnaround' ? 10 : 12,
      0,
      0,
      Math.PI * 2,
    );
    context.fill();
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  });

  const labels = entries.map((entry) => normalize(entry.label)).filter(Boolean);
  const label = labels.length <= 3 ? labels.join(' / ') : `${labels[0]} + ${labels.length - 1} others`;
  const subject = type === 'character' ? '角色' : type === 'prop' ? '道具' : '角色多视图';
  return {
    image: canvas.toDataURL('image/jpeg', 0.92),
    type,
    label,
    detail: `${subject}全景参考，按从左到右顺序包含：${labels.join('、')}`,
    isComposite: true,
    includedLabels: labels,
  };
};

const annotationForEntry = (entry: ReferenceImageEntry): string => {
  const labels = (entry.includedLabels || []).filter(Boolean).join('、') || entry.label;
  if (entry.type === 'scene') {
    return `场景参考图：${entry.label}。锁定环境、空间关系、光线和氛围。`;
  }
  if (entry.type === 'character') {
    return entry.isComposite
      ? `角色全景参考图：从左到右依次为 ${labels}。必须分别保持每个角色的脸型、发型、体态与服装，禁止混脸或混装。`
      : `角色参考图：${entry.label}。锁定人物身份、脸型、发型、体态与服装。`;
  }
  if (entry.type === 'turnaround') {
    return entry.isComposite
      ? `角色多视图合并图：从左到右依次为 ${labels}。按角色和目标机位选择对应分区，禁止混合身份。`
      : `角色多视图参考图：${entry.label}。选择与目标机位最接近的视图，保持身份、服装和比例。`;
  }
  if (entry.type === 'storyboard') {
    return `九宫格分镜参考：${entry.label}。这是同一段连续视频的视觉节拍表；按从左到右、从上到下的顺序演绎关键动作与镜头变化，但最终只输出一段连续画面，禁止输出分屏、拼贴或格线。`;
  }
  return entry.isComposite
    ? `道具全景参考图：从左到右依次为 ${labels}。分别保持各道具的造型、材质、颜色和关键细节。`
    : `道具参考图：${entry.label}。锁定造型、材质、颜色和关键细节。`;
};

const annotationForEntryEn = (entry: ReferenceImageEntry): string => {
  const labels = (entry.includedLabels || []).filter(Boolean).join(', ') || entry.label;
  if (entry.type === 'scene') return `Scene reference: ${entry.label}. Lock environment, spatial layout, lighting, and atmosphere.`;
  if (entry.type === 'character') {
    return entry.isComposite
      ? `Character panorama, left to right: ${labels}. Preserve each character's face, hair, body, and wardrobe without mixing identities or outfits.`
      : `Character reference: ${entry.label}. Lock identity, face, hair, body, and wardrobe.`;
  }
  if (entry.type === 'turnaround') {
    return entry.isComposite
      ? `Character view-sheet panorama, left to right: ${labels}. Use the matching subject and camera angle without mixing identities.`
      : `Character view-sheet: ${entry.label}. Use the closest camera angle and preserve identity, wardrobe, and proportions.`;
  }
  if (entry.type === 'storyboard') {
    return `Storyboard-grid reference: ${entry.label}. Treat its panels left-to-right, top-to-bottom as successive visual beats for one continuous video. Do not render a grid, collage, split screen, or panel borders.`;
  }
  return entry.isComposite
    ? `Prop panorama, left to right: ${labels}. Preserve each object's form, material, color, and defining details.`
    : `Prop reference: ${entry.label}. Lock form, material, color, and defining details.`;
};

const replaceKindWithComposite = (
  entries: ReferenceImageEntry[],
  kind: ReferenceImageKind,
  composite: ReferenceImageEntry,
): ReferenceImageEntry[] => {
  let inserted = false;
  return entries.reduce<ReferenceImageEntry[]>((output, entry) => {
    if (entry.type !== kind) {
      output.push(entry);
    } else if (!inserted) {
      output.push(composite);
      inserted = true;
    }
    return output;
  }, []);
};

/** 按模型槽位上限整理参考图；默认在超出上限时才合并同类图，生图可用 disableCompositing 强制单图。 */
export const buildReferenceImagePack = async (
  inputEntries: ReferenceImageEntry[],
  options: BuildReferenceImagePackOptions = {},
): Promise<ReferenceImagePack> => {
  const maxReferenceImages = Math.max(1, options.maxReferenceImages ?? DEFAULT_MAX_REFERENCES);
  const reservedReferenceSlots = Math.max(
    0,
    Math.min(maxReferenceImages, options.reservedReferenceSlots ?? 0),
  );
  const continuityReferenceImage = normalize(options.continuityReferenceImage) || undefined;
  const usableSlots = Math.max(
    0,
    maxReferenceImages - reservedReferenceSlots - (continuityReferenceImage ? 1 : 0),
  );
  const originalEntries = dedupeEntries(inputEntries);
  const continuityIsExtra = !!continuityReferenceImage &&
    !originalEntries.some((entry) => entry.image === continuityReferenceImage);
  const alwaysComposite = new Set(options.alwaysCompositeTypes || []);
  const disableCompositing = options.disableCompositing === true;
  let workingEntries = [...originalEntries];
  const compositeGroups: ReferenceCompositeSummary[] = [];

  if (!disableCompositing) {
    for (const type of ['character', 'prop', 'turnaround'] as const) {
      const sameType = workingEntries.filter((entry) => entry.type === type);
      const requestedNow = workingEntries.length + (continuityIsExtra ? 1 : 0) + reservedReferenceSlots;
      if (sameType.length <= 1 || (requestedNow <= maxReferenceImages && !alwaysComposite.has(type))) continue;
      try {
        const composite = await composeReferencePanorama(sameType, type);
        workingEntries = replaceKindWithComposite(workingEntries, type, composite);
        compositeGroups.push({ type, count: sameType.length, entry: composite });
      } catch (error) {
        console.warn(`[ReferencePack] ${type} 合并失败，继续使用单张参考图。`, error);
      }
    }
  }

  const withoutContinuity = continuityReferenceImage
    ? workingEntries.filter((entry) => entry.image !== continuityReferenceImage)
    : workingEntries;
  const selectedEntries = withoutContinuity.slice(0, usableSlots);
  const selectedSet = new Set(selectedEntries.map((entry) => entry.image));
  const droppedEntries = withoutContinuity.filter((entry) => !selectedSet.has(entry.image));
  const effectiveReferenceCount = selectedEntries.length + (continuityReferenceImage ? 1 : 0) + reservedReferenceSlots;
  const requestedReferenceCount = originalEntries.length + (continuityIsExtra ? 1 : 0) + reservedReferenceSlots;
  const characterGroup = compositeGroups.find((group) => group.type === 'character');
  const slots: ReferenceSlotInspection[] = selectedEntries.map((entry, index) => ({
    slot: index + 1,
    kind: 'reference',
    role: entry.type,
    label: entry.label,
    detail: annotationForEntry(entry),
    detailZh: annotationForEntry(entry),
    detailEn: annotationForEntryEn(entry),
    image: entry.image,
    includedLabels: entry.includedLabels,
  }));
  if (continuityReferenceImage) {
    slots.push({
      slot: slots.length + 1,
      kind: 'continuity',
      role: 'continuity',
      label: 'Start-frame continuity',
      detail: 'Preserve identity, lighting, and spatial continuity from the start frame.',
      detailZh: '保持人物身份、光线与空间位置和首帧连续。',
      detailEn: 'Preserve identity, lighting, and spatial continuity from the start frame.',
      image: continuityReferenceImage,
    });
  }
  const capacityBeforeReserved = Math.max(0, maxReferenceImages - reservedReferenceSlots);
  while (slots.length < capacityBeforeReserved) {
    slots.push({
      slot: slots.length + 1,
      kind: 'empty',
      role: 'empty',
      label: 'Available slot',
    });
  }
  for (let index = 0; index < reservedReferenceSlots && slots.length < maxReferenceImages; index += 1) {
    slots.push({
      slot: slots.length + 1,
      kind: 'reserved',
      role: 'system',
      label: 'Reserved safety slot',
      detail: 'Strict preview reserve for a template, layout, or continuity reference. The actual request may use it when no extra workflow image is needed.',
      detailZh: '严格预案为模板图、布局图或连续性参考预留；实际任务无需额外工作流图片时可以使用。',
      detailEn: 'Strict preview reserve for a template, layout, or continuity reference. The actual request may use it when no extra workflow image is needed.',
    });
  }
  while (slots.length < maxReferenceImages) {
    slots.push({
      slot: slots.length + 1,
      kind: 'empty',
      role: 'empty',
      label: 'Available slot',
    });
  }

  return {
    referenceImages: selectedEntries.map((entry) => entry.image),
    entries: selectedEntries,
    referenceAnnotations: selectedEntries.map(annotationForEntry),
    continuityReferenceImage,
    requestedReferenceCount,
    effectiveReferenceCount,
    maxReferenceImages,
    droppedEntries,
    compositeGroups,
    slots,
    droppedInspections: droppedEntries.map((entry) => ({ entry, reason: 'slot-limit' as const })),
    reservedReferenceSlots,
    usableReferenceSlots: usableSlots,
    usedCharacterPanorama: !!characterGroup,
    stitchedCharacterCount: characterGroup?.count || 0,
  };
};

export const describeReferencePack = (
  pack: ReferenceImagePack,
  language: 'zh' | 'en' = 'zh',
): string | null => {
  if (pack.compositeGroups.length === 0) {
    return pack.requestedReferenceCount > pack.maxReferenceImages
      ? language === 'zh'
        ? `参考图共 ${pack.requestedReferenceCount} 张，已按模型上限保留 ${pack.effectiveReferenceCount} 张。`
        : `${pack.requestedReferenceCount} references requested; ${pack.effectiveReferenceCount} retained within the model limit.`
      : null;
  }
  const labels: Record<ReferenceCompositeSummary['type'], { zh: string; en: string }> = {
    character: { zh: '角色图', en: 'character references' },
    prop: { zh: '道具图', en: 'prop references' },
    turnaround: { zh: '角色多视图', en: 'character view sheets' },
    storyboard: { zh: '九宫格分镜', en: 'storyboard grid' },
  };
  const merged = pack.compositeGroups
    .map((group) => language === 'zh'
      ? `${labels[group.type].zh} ${group.count} 张已整理为 1 张全景参考图`
      : `${group.count} ${labels[group.type].en} packed into one panorama`)
    .join(language === 'zh' ? '，' : '; ');
  const trimmed = pack.droppedEntries.length > 0
    ? language === 'zh'
      ? `；另有 ${pack.droppedEntries.length} 张超出当前模型槽位上限`
      : `; ${pack.droppedEntries.length} more omitted to fit the model limit`
    : '';
  return `${merged}${trimmed}${language === 'zh' ? '。' : '.'}`;
};
