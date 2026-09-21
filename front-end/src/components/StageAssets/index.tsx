import React, { useState, useEffect } from 'react';
import { Users, Sparkles, RefreshCw, Loader2, MapPin, Archive, X, Search, Trash2, Package, Link2 } from 'lucide-react';
import { ProjectState, CharacterVariation, Character, Scene, Prop, AspectRatio, AssetLibraryItem, CharacterTurnaroundPanel, PropPresentationMode } from '../../types';
import type { ImageModelParams } from '../../types/model';
import { generateImage, generateVisualPrompts, generateArtDirection, generateCharacterTurnaroundPanels, generateCharacterTurnaroundImage, generateCharacterThreeViewImage, resolveCharacterCastingAspectRatio, applyCharacterCastingPositivePrompt, buildLookbookRegenerateVariation, listProjectPropNames, inferCharacterWardrobe, isWearableProp, normalizeCharacterWardrobeInPrompt, dedupeRepeatedPromptClauses, mergeCharacterCastingNegativePrompt, CHARACTER_IDENTITY_LOCK } from '../../services/aiService';
import { 
  getRegionalPrefix, 
  handleImageUpload, 
  getProjectLanguage, 
  getProjectVisualStyle,
  delay,
  generateId,
  compareIds 
} from './utils';
import { DEFAULTS, STYLES, GRID_LAYOUTS } from './constants';
import ImagePreviewModal from './ImagePreviewModal';
import CharacterCard from './CharacterCard';
import SceneCard from './SceneCard';
import PropCard from './PropCard';
import WardrobeModal from './WardrobeModal';
import TurnaroundModal from './TurnaroundModal';
import ThreeViewModal from './ThreeViewModal';
import { useAlert } from '../GlobalAlert';
import { getAllAssetLibraryItems, saveAssetToLibrary, deleteAssetFromLibrary } from '../../services/storageService';
import { applyLibraryItemToProject, createLibraryItemFromCharacter, createLibraryItemFromScene, createLibraryItemFromProp, cloneCharacterForProject } from '../../services/assetLibraryService';
import { AspectRatioSelector } from '../AspectRatioSelector';
import { getActiveImageModel, resolveShotGenerationModel } from '../../services/modelRegistry';
import { updatePromptWithVersion } from '../../services/promptVersionService';
import CharacterLibraryPickerModal from './CharacterLibraryPicker';
import ProjectAssetPicker from './ProjectAssetPicker';
import { loadSeriesProject } from '../../services/storageService';
import { SeriesProject } from '../../types';
import BilingualLabel from '../BilingualLabel';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';
import { addCharacterImageHistory, resolveCharacterImageView, sameCharacterImage } from '../../services/characterImageHistory';
import { resolveProductionBible } from '../../services/productionBibleService';

interface Props {
  project: ProjectState;
  updateProject: (updates: Partial<ProjectState> | ((prev: ProjectState) => ProjectState)) => void;
  onApiKeyError?: (error: any) => boolean;
  onGeneratingChange?: (isGenerating: boolean) => void;
}

const StageAssets: React.FC<Props> = ({ project, updateProject, onApiKeyError, onGeneratingChange }) => {
  const { showAlert } = useAlert();
  const { text } = useInterfaceLanguage();
  const [batchProgress, setBatchProgress] = useState<{current: number, total: number} | null>(null);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<{ url: string; imageUrls?: string[] } | null>(null);
  const openImagePreview = (url: string, imageUrls?: string[]) => setPreviewImage({ url, imageUrls });
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [libraryItems, setLibraryItems] = useState<AssetLibraryItem[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryFilter, setLibraryFilter] = useState<'all' | 'character' | 'scene' | 'prop'>('all');
  const [libraryProjectFilter, setLibraryProjectFilter] = useState('all');
  const [replaceTargetCharId, setReplaceTargetCharId] = useState<string | null>(null);
  const [turnaroundCharId, setTurnaroundCharId] = useState<string | null>(null);
  const [threeViewCharId, setThreeViewCharId] = useState<string | null>(null);
  const [showCharLibraryPicker, setShowCharLibraryPicker] = useState(false);
  const [showSceneLibraryPicker, setShowSceneLibraryPicker] = useState(false);
  const [showPropLibraryPicker, setShowPropLibraryPicker] = useState(false);
  const [pickerProject, setPickerProject] = useState<SeriesProject | null>(null);
  const [regeneratingPromptIds, setRegeneratingPromptIds] = useState<Set<string>>(new Set());
  const activeImageParams = (getActiveImageModel()?.params || {}) as Partial<ImageModelParams>;

  const markPromptRegenerating = (id: string, active: boolean) => {
    setRegeneratingPromptIds(prev => {
      const next = new Set(prev);
      if (active) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const loadPickerProject = async (): Promise<SeriesProject | null> => {
    if (!project.projectId) return null;
    try {
      const sp = await loadSeriesProject(project.projectId);
      setPickerProject(sp);
      return sp;
    } catch { return null; }
  };

  const upsertEpisodeRef = <TRef,>(
    refs: TRef[] | undefined,
    key: string,
    getKey: (ref: TRef) => string,
    nextRef: TRef
  ): TRef[] => {
    const currentRefs = refs || [];
    const hasRef = currentRefs.some(ref => getKey(ref) === key);
    if (!hasRef) return [...currentRefs, nextRef];
    return currentRefs.map(ref => (getKey(ref) === key ? nextRef : ref));
  };

  const upsertCharacterRef = (characterId: string, syncedVersion: number) =>
    upsertEpisodeRef(
      project.characterRefs,
      characterId,
      ref => ref.characterId,
      { characterId, syncedVersion, syncStatus: 'synced' as const }
    );

  const upsertSceneRef = (sceneId: string, syncedVersion: number) =>
    upsertEpisodeRef(
      project.sceneRefs,
      sceneId,
      ref => ref.sceneId,
      { sceneId, syncedVersion, syncStatus: 'synced' as const }
    );

  const upsertPropRef = (propId: string, syncedVersion: number) =>
    upsertEpisodeRef(
      project.propRefs,
      propId,
      ref => ref.propId,
      { propId, syncedVersion, syncStatus: 'synced' as const }
    );

  const appendLinkedLibraryAsset = <
    TAsset extends { id: string; version?: number },
    TField extends 'characters' | 'scenes' | 'props',
    TRefField extends 'characterRefs' | 'sceneRefs' | 'propRefs'
  >(params: {
    asset: TAsset;
    idPrefix: 'char' | 'scene' | 'prop';
    field: TField;
    refField: TRefField;
    upsertRef: (assetId: string, syncedVersion: number) => ProjectState[TRefField];
    onDone: () => void;
  }) => {
    if (!project.scriptData) return;

    const { asset, idPrefix, field, refField, upsertRef, onDone } = params;
    const linkedAsset = {
      ...asset,
      id: generateId(idPrefix),
      libraryId: asset.id,
      libraryVersion: asset.version || 1,
    };
    const nextRefs = upsertRef(asset.id, asset.version || 1);

    updateProject(prev => {
      const currentScriptData = prev.scriptData!;
      const currentItems = ((currentScriptData as any)[field] || []) as any[];
      return {
        ...prev,
        scriptData: invalidateShotGenerationMeta({
          ...currentScriptData,
          [field]: [...currentItems, linkedAsset],
        }),
        [refField]: nextRefs,
      };
    });

    onDone();
  };

  const cloneScriptData = <T extends ProjectState['scriptData']>(scriptData: T): T => {
    if (!scriptData) return scriptData;
    if (typeof structuredClone === 'function') {
      return structuredClone(scriptData);
    }
    return JSON.parse(JSON.stringify(scriptData)) as T;
  };

  const invalidateShotGenerationMeta = <T extends ProjectState['scriptData']>(scriptData: T): T => {
    if (!scriptData) return scriptData;
    return {
      ...scriptData,
      generationMeta: {
        ...(scriptData.generationMeta || {}),
        shotsKey: undefined,
        generatedAt: Date.now()
      }
    } as T;
  };

  useEffect(() => {
    const handler = () => {
      loadPickerProject().then(sp => { if (sp) setShowCharLibraryPicker(true); });
    };
    window.addEventListener('openCharacterLibraryPicker', handler);
    return () => window.removeEventListener('openCharacterLibraryPicker', handler);
  }, [project.projectId]);

  // 横竖屏选择状态：优先读取当前项目，旧项目回退到模型默认配置。
  const [aspectRatio, setAspectRatioState] = useState<AspectRatio>(
    // 项目未明确设置时，资产页的项目视频画幅默认横屏；不继承其他项目的用户偏好。
    () => project.aspectRatio || '16:9'
  );
  
  // 包装 setAspectRatio，同时持久化到当前项目。
  const setAspectRatio = (ratio: AspectRatio) => {
    setAspectRatioState(ratio);
    updateProject({ aspectRatio: ratio });
  };

  useEffect(() => {
    setAspectRatioState(project.aspectRatio || '16:9');
  }, [project.projectId, project.aspectRatio]);
  

  // 获取项目配置
  const language = getProjectLanguage(project.language, project.scriptData?.language);
  const visualStyle = getProjectVisualStyle(project.visualStyle, project.scriptData?.visualStyle);
  const genre = project.scriptData?.genre || DEFAULTS.genre;
  const shotPromptModel = resolveShotGenerationModel();

  /**
   * 上报生成状态给父组件，用于导航锁定
   * 检测角色、场景、道具、角色变体的生成状态
   */
  useEffect(() => {
    const hasGeneratingCharacters = project.scriptData?.characters.some(char => {
      const isCharGenerating = char.status === 'generating';
      const hasGeneratingVariations = char.variations?.some(v => v.status === 'generating');
      return isCharGenerating || hasGeneratingVariations || char.threeView?.status === 'generating';
    }) ?? false;

    const hasGeneratingScenes = project.scriptData?.scenes.some(scene => 
      scene.status === 'generating'
    ) ?? false;

    const hasGeneratingProps = (project.scriptData?.props || []).some(prop =>
      prop.status === 'generating'
    );

    const generating = !!batchProgress || hasGeneratingCharacters || hasGeneratingScenes || hasGeneratingProps;
    onGeneratingChange?.(generating);
  }, [batchProgress, project.scriptData]);

  // 组件卸载时重置生成状态
  useEffect(() => {
    return () => {
      onGeneratingChange?.(false);
    };
  }, []);

  const refreshLibrary = async () => {
    try {
      const items = await getAllAssetLibraryItems();
      setLibraryItems(items);
    } catch (e) {
      console.error('Failed to load asset library', e);
    } finally {
      setLibraryLoading(false);
    }
  };

  const openLibrary = (filter: 'all' | 'character' | 'scene' | 'prop', targetCharId: string | null = null) => {
    setLibraryFilter(filter);
    setReplaceTargetCharId(targetCharId);
    setLibraryLoading(true);
    setShowLibraryModal(true);
    void refreshLibrary();
  };

  const setShapeReferenceImage = (
    scriptData: NonNullable<ProjectState['scriptData']>,
    type: 'character' | 'scene' | 'prop',
    id: string,
    image?: string
  ): boolean => {
    if (type === 'character') {
      const target = scriptData.characters.find(c => compareIds(c.id, id));
      if (!target) return false;
      target.shapeReferenceImage = image;
      return true;
    }
    if (type === 'scene') {
      const target = scriptData.scenes.find(s => compareIds(s.id, id));
      if (!target) return false;
      target.shapeReferenceImage = image;
      return true;
    }
    const target = (scriptData.props || []).find(p => compareIds(p.id, id));
    if (!target) return false;
    target.shapeReferenceImage = image;
    return true;
  };

  const shapeReferenceStyleInstruction = `\n\nREFERENCE RULES: Use provided reference image ONLY for shape/silhouette/proportions/composition anchors. Do NOT copy the reference image's color grading, texture treatment, lighting style, or rendering medium.\nSTYLE LOCK: Final output MUST match the current project visual style (${visualStyle}).`;

  /**
   * 生成资源（角色或场景）
   */
  const handleGenerateAsset = async (type: 'character' | 'scene', id: string) => {
    const scriptSnapshot = project.scriptData;
    if (!scriptSnapshot) return;
    const historicalContext = resolveProductionBible(scriptSnapshot).historicalContext;

    // 设置生成状态
    updateProject(prev => {
      if (!prev.scriptData) return prev;
      const newData = cloneScriptData(prev.scriptData);
      if (type === 'character') {
        const c = newData.characters.find(c => compareIds(c.id, id));
        if (c) c.status = 'generating';
      } else {
        const s = newData.scenes.find(s => compareIds(s.id, id));
        if (s) s.status = 'generating';
      }
      return { ...prev, scriptData: newData };
    });

    try {
      let prompt = "";
      let negativePrompt = "";
      let characterReferenceImages: string[] = [];
      let characterHasTurnaroundReference = false;
      let shapeReferenceImage: string | undefined;

      if (type === 'character') {
        const char = scriptSnapshot.characters.find(c => compareIds(c.id, id));
        if (char) {
          shapeReferenceImage = char.shapeReferenceImage;
          if (shapeReferenceImage) {
            characterReferenceImages.push(shapeReferenceImage);
          }
          // 定妆生图默认纯文生图，遵循 visualPrompt；仅 shapeReferenceImage 显式上传时走 img2img

          if (char.visualPrompt) {
            prompt = `${char.visualPrompt}${historicalContext ? `\n\n时代与文化约束：${historicalContext}\n严格遵守以上时代的服装、发式、鞋履、材质与禁用元素；不得出现时代错位或现代元素。` : ''}`;
            negativePrompt = char.negativePrompt || '';
          } else {
            const prompts = await generateVisualPrompts(
              'character',
              { ...char, wardrobe: inferCharacterWardrobe(char, scriptSnapshot.props) },
              genre,
              shotPromptModel,
              visualStyle,
              language,
              scriptSnapshot.artDirection,
              undefined,
              listProjectPropNames(scriptSnapshot.props),
              historicalContext,
            );
            prompt = prompts.visualPrompt;
            negativePrompt = prompts.negativePrompt;

            // 保存生成的提示词
            updateProject(prev => {
              if (!prev.scriptData) return prev;
              const newData = cloneScriptData(prev.scriptData);
              const c = newData.characters.find(c => compareIds(c.id, id));
              if (c) {
                c.promptVersions = updatePromptWithVersion(
                  c.visualPrompt,
                  prompts.visualPrompt,
                  c.promptVersions,
                  'ai-generated',
                  'Auto-generated character prompt'
                );
                c.visualPrompt = prompts.visualPrompt;
                c.negativePrompt = prompts.negativePrompt;
              }
              return { ...prev, scriptData: newData };
            });
          }
        }
      } else {
        const scene = scriptSnapshot.scenes.find(s => compareIds(s.id, id));
        if (scene) {
          shapeReferenceImage = scene.shapeReferenceImage;
          if (scene.visualPrompt) {
            prompt = scene.visualPrompt;
            negativePrompt = scene.negativePrompt || '';
          } else {
            const prompts = await generateVisualPrompts('scene', scene, genre, shotPromptModel, visualStyle, language);
            prompt = prompts.visualPrompt;
            negativePrompt = prompts.negativePrompt;

            // 保存生成的提示词
            updateProject(prev => {
              if (!prev.scriptData) return prev;
              const newData = cloneScriptData(prev.scriptData);
              const s = newData.scenes.find(s => compareIds(s.id, id));
              if (s) {
                s.promptVersions = updatePromptWithVersion(
                  s.visualPrompt,
                  prompts.visualPrompt,
                  s.promptVersions,
                  'ai-generated',
                  'Auto-generated scene prompt'
                );
                s.visualPrompt = prompts.visualPrompt;
                s.negativePrompt = prompts.negativePrompt;
              }
              return { ...prev, scriptData: newData };
            });
          }
        }
      }

      // 添加地域特征前缀
      const regionalPrefix = getRegionalPrefix(language, type);
      let enhancedPrompt = regionalPrefix + prompt;

      // Scene image: enforce environment-only composition to avoid accidental people.
      if (type === 'scene') {
        enhancedPrompt += '. IMPORTANT: This is a pure environment/background scene with absolutely NO people, NO human figures, NO characters, NO silhouettes, NO crowds - empty scene only.';
      }

      if (type === 'character') {
        const rawCastingCharacter = scriptSnapshot.characters.find(c => compareIds(c.id, id));
        const effectiveWardrobe = inferCharacterWardrobe(rawCastingCharacter, scriptSnapshot.props);
        const castingCharacter = rawCastingCharacter
          ? { ...rawCastingCharacter, wardrobe: effectiveWardrobe }
          : rawCastingCharacter;
        if (rawCastingCharacter && effectiveWardrobe) {
          const normalizedPrompt = normalizeCharacterWardrobeInPrompt(rawCastingCharacter.visualPrompt || '', castingCharacter);
          if (rawCastingCharacter.wardrobe !== effectiveWardrobe || normalizedPrompt !== rawCastingCharacter.visualPrompt) {
            updateProject(prev => {
              if (!prev.scriptData) return prev;
              const newData = cloneScriptData(prev.scriptData);
              const c = newData.characters.find(c => compareIds(c.id, id));
              if (c) {
                c.wardrobe = effectiveWardrobe;
                if (normalizedPrompt) c.visualPrompt = normalizedPrompt;
              }
              return { ...prev, scriptData: newData };
            });
          }
        }
        enhancedPrompt = applyCharacterCastingPositivePrompt(
          enhancedPrompt,
          listProjectPropNames(scriptSnapshot.props),
          castingCharacter
        );
        negativePrompt = mergeCharacterCastingNegativePrompt(
          visualStyle,
          negativePrompt,
          castingCharacter
        );
      }

      if (shapeReferenceImage) {
        enhancedPrompt += shapeReferenceStyleInstruction;
      }

      // 重新生图仍复用 visualPrompt，Qwen 会画出几乎同一张；注入姿态变化但不改已存提示词
      if (type === 'character' && scriptSnapshot.characters.find(c => compareIds(c.id, id))?.referenceImage) {
        enhancedPrompt += `\n\n${buildLookbookRegenerateVariation()}`;
      }

      // 资产构图与成片画幅解耦：角色定妆固定竖构图，环境场景固定横构图。
      // 场景图是后续横向视频/镜头构图的空间锚点，不能因项目当前选择竖屏而被压成竖图。
      if (type === 'character' && characterReferenceImages.length > 0 && !shapeReferenceImage) {
        enhancedPrompt += `\n\n${CHARACTER_IDENTITY_LOCK}`;
        if (characterHasTurnaroundReference) {
          enhancedPrompt += ' If a 3x3 turnaround sheet is included, prioritize the panel that matches the camera angle and preserve angle-specific details.';
        }
      }

      const referenceImagesForGeneration = shapeReferenceImage
        ? [shapeReferenceImage]
        : type === 'character'
          ? characterReferenceImages
          : [];
      const imageUrl = await generateImage(
        enhancedPrompt,
        referenceImagesForGeneration,
        type === 'character' ? resolveCharacterCastingAspectRatio() : '16:9',
        false,
        type === 'character' && !shapeReferenceImage ? characterHasTurnaroundReference : false,
        negativePrompt,
        shapeReferenceImage
          ? { referencePackType: 'shape', target: { kind: type, id } }
          : type === 'character'
            ? { referencePackType: 'character', target: { kind: type, id } }
            : { referencePackType: 'scene', target: { kind: type, id } }
      );

      // 更新状态
      updateProject(prev => {
        if (!prev.scriptData) return prev;
        const newData = cloneScriptData(prev.scriptData);
        if (type === 'character') {
          const c = newData.characters.find(c => compareIds(c.id, id));
          if (c) {
            if (c.referenceImage) addCharacterImageHistory(c, c.referenceImage, 'generated', c.visualPrompt);
            c.referenceImage = imageUrl;
            c.status = 'completed';
            c.activeImageView = 'casting';
            addCharacterImageHistory(c, imageUrl, 'generated', c.visualPrompt);
          }
        } else {
          const s = newData.scenes.find(s => compareIds(s.id, id));
          if (s) {
            s.referenceImage = imageUrl;
            s.referenceImageUpdatedAt = Date.now();
            s.status = 'completed';
          }
        }
        return { ...prev, scriptData: newData };
      });

    } catch (e: any) {
      console.error(e);
      // 设置失败状态
      updateProject(prev => {
        if (!prev.scriptData) return prev;
        const newData = cloneScriptData(prev.scriptData);
        if (type === 'character') {
          const c = newData.characters.find(c => compareIds(c.id, id));
          if (c) c.status = 'failed';
        } else {
          const s = newData.scenes.find(s => compareIds(s.id, id));
          if (s) s.status = 'failed';
        }
        return { ...prev, scriptData: newData };
      });
      if (onApiKeyError && onApiKeyError(e)) {
        return;
      }
    }
  };
  const handleBatchGenerate = async (type: 'character' | 'scene') => {
    const items = type === 'character' 
      ? project.scriptData?.characters 
      : project.scriptData?.scenes;
    
    if (!items) return;

    const itemsToGen = items.filter(i => !i.referenceImage);
    const isRegenerate = itemsToGen.length === 0;

    if (isRegenerate) {
      showAlert(`确定要重新生成所有${type === 'character' ? '角色' : '场景'}图吗？`, {
        type: 'warning',
        showCancel: true,
        onConfirm: async () => {
          await executeBatchGenerate(items, type);
        }
      });
      return;
    }

    await executeBatchGenerate(itemsToGen, type);
  };

  const executeBatchGenerate = async (targetItems: any[], type: 'character' | 'scene') => {
    setBatchProgress({ current: 0, total: targetItems.length });

    try {
      for (let i = 0; i < targetItems.length; i++) {
        if (i > 0) await delay(DEFAULTS.batchGenerateDelay);
        
        await handleGenerateAsset(type, targetItems[i].id);
        setBatchProgress({ current: i + 1, total: targetItems.length });
      }
    } finally {
      setBatchProgress(null);
    }
  };

  /**
   * 上传角色图片
   */
  const handleUploadCharacterImage = async (charId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);

      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = cloneScriptData(prev.scriptData);
        const char = newData.characters.find(c => compareIds(c.id, charId));
        if (char) {
          if (char.referenceImage) addCharacterImageHistory(char, char.referenceImage, 'generated', char.visualPrompt);
          char.referenceImage = base64;
          char.status = 'completed';
          char.activeImageView = 'casting';
          addCharacterImageHistory(char, base64, 'uploaded', char.visualPrompt);
        }
        return { ...prev, scriptData: newData };
      });
    } catch (e: any) {
      showAlert(e.message, { type: 'error' });
    }
  };

  const handleApplyCharacterHistory = (charId: string, imageUrl: string) => {
    updateProject((prev) => {
      if (!prev.scriptData) return prev;
      const newData = cloneScriptData(prev.scriptData);
      const char = newData.characters.find(c => compareIds(c.id, charId));
      if (!char || (resolveCharacterImageView(char) === 'casting' && sameCharacterImage(char.referenceImage, imageUrl))) return prev;
      const selected = char.imageHistory?.find(entry => sameCharacterImage(entry.imageUrl, imageUrl));
      if (char.referenceImage) addCharacterImageHistory(char, char.referenceImage, 'generated', char.visualPrompt);
      char.referenceImage = imageUrl;
      char.status = 'completed';
      char.activeImageView = 'casting';
      addCharacterImageHistory(char, imageUrl, selected?.source || 'generated', selected?.prompt || char.visualPrompt);
      return { ...prev, scriptData: newData };
    });
  };

  const handleOpenCharacterView = (charId: string, view: 'turnaround' | 'threeView') => {
    updateProject((prev) => {
      if (!prev.scriptData) return prev;
      const newData = cloneScriptData(prev.scriptData);
      const char = newData.characters.find(c => compareIds(c.id, charId));
      const hasImage = view === 'turnaround' ? !!char?.turnaround?.imageUrl : !!char?.threeView?.imageUrl;
      if (!char || !hasImage || char.activeImageView === view) return prev;
      char.activeImageView = view;
      return { ...prev, scriptData: newData };
    });
    window.setTimeout(() => {
      if (view === 'turnaround') setTurnaroundCharId(charId);
      else setThreeViewCharId(charId);
    }, 0);
  };

  /**
   * 上传场景图片
   */
  const handleUploadSceneImage = async (sceneId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);

      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = cloneScriptData(prev.scriptData);
        const scene = newData.scenes.find(s => compareIds(s.id, sceneId));
        if (scene) {
          scene.referenceImage = base64;
          scene.status = 'completed';
        }
        return { ...prev, scriptData: newData };
      });
    } catch (e: any) {
      showAlert(e.message, { type: 'error' });
    }
  };

  const handleUploadShapeReferenceImage = async (
    type: 'character' | 'scene' | 'prop',
    id: string,
    file: File
  ) => {
    try {
      const base64 = await handleImageUpload(file);
      updateProject(prev => {
        if (!prev.scriptData) return prev;
        const newData = cloneScriptData(prev.scriptData);
        setShapeReferenceImage(newData, type, id, base64);
        return { ...prev, scriptData: newData };
      });
      const typeLabel = type === 'character' ? '角色' : type === 'scene' ? '场景' : '道具';
      showAlert(`已设置${typeLabel}参考图。生成时将保持当前剧本风格，仅参考构图和外形。`, { type: 'success' });
    } catch (e: any) {
      showAlert(e.message, { type: 'error' });
    }
  };

  const handleClearShapeReferenceImage = (
    type: 'character' | 'scene' | 'prop',
    id: string
  ) => {
    updateProject(prev => {
      if (!prev.scriptData) return prev;
      const newData = cloneScriptData(prev.scriptData);
      const updated = setShapeReferenceImage(newData, type, id, undefined);
      if (!updated) return prev;
      return { ...prev, scriptData: newData };
    });
  };

  const handleAddCharacterToLibrary = (char: Character) => {
    const saveItem = async () => {
      try {
        const item = createLibraryItemFromCharacter(char, project);
        await saveAssetToLibrary(item);
        showAlert(`已加入资产库：${char.name}`, { type: 'success' });
        refreshLibrary();
      } catch (e: any) {
        showAlert(e?.message || '加入资产库失败', { type: 'error' });
      }
    };

    if (!char.referenceImage) {
      showAlert('该角色暂无参考图，仍要加入资产库吗？', {
        type: 'warning',
        showCancel: true,
        onConfirm: saveItem
      });
      return;
    }

    void saveItem();
  };

  const handleAddSceneToLibrary = (scene: Scene) => {
    const saveItem = async () => {
      try {
        const item = createLibraryItemFromScene(scene, project);
        await saveAssetToLibrary(item);
        showAlert(`已加入资产库：${scene.location}`, { type: 'success' });
        refreshLibrary();
      } catch (e: any) {
        showAlert(e?.message || '加入资产库失败', { type: 'error' });
      }
    };

    if (!scene.referenceImage) {
      showAlert('该场景暂无参考图，仍要加入资产库吗？', {
        type: 'warning',
        showCancel: true,
        onConfirm: saveItem
      });
      return;
    }

    void saveItem();
  };

  const handleImportFromLibrary = (item: AssetLibraryItem) => {
    try {
      const updated = applyLibraryItemToProject(project, item);
      updateProject(() => ({
        ...updated,
        scriptData: invalidateShotGenerationMeta(updated.scriptData)
      }));
      showAlert(`已导入：${item.name}`, { type: 'success' });
    } catch (e: any) {
      showAlert(e?.message || '导入失败', { type: 'error' });
    }
  };

  const handleReplaceCharacterFromLibrary = (item: AssetLibraryItem, targetId: string) => {
    if (item.type !== 'character') {
      showAlert('请选择角色资产进行替换', { type: 'warning' });
      return;
    }
    if (!project.scriptData) return;

    const newData = cloneScriptData(project.scriptData);
    const index = newData.characters.findIndex((c) => compareIds(c.id, targetId));
    if (index === -1) return;

    const cloned = cloneCharacterForProject(item.data as Character);
    const previous = newData.characters[index];

    newData.characters[index] = {
      ...cloned,
      id: previous.id
    };

    const nextShots = project.shots.map((shot) => {
      if (!shot.characterVariations || !shot.characterVariations[targetId]) return shot;
      const { [targetId]: _removed, ...rest } = shot.characterVariations;
      return {
        ...shot,
        characterVariations: Object.keys(rest).length > 0 ? rest : undefined
      };
    });

    let nextRefs = project.characterRefs || [];
    if (previous.libraryId) {
      const hasOtherLinked = newData.characters.some(c => c.libraryId === previous.libraryId);
      if (!hasOtherLinked) {
        nextRefs = nextRefs.filter(ref => ref.characterId !== previous.libraryId);
      }
    }

    updateProject({
      scriptData: invalidateShotGenerationMeta(newData),
      shots: nextShots,
      characterRefs: nextRefs
    });
    showAlert(`已替换角色：${previous.name} → ${cloned.name}`, { type: 'success' });
    setShowLibraryModal(false);
    setReplaceTargetCharId(null);
  };

  const handleDeleteLibraryItem = async (itemId: string) => {
    try {
      await deleteAssetFromLibrary(itemId);
      setLibraryItems((prev) => prev.filter((item) => item.id !== itemId));
    } catch (e: any) {
      showAlert(e?.message || '删除资产失败', { type: 'error' });
    }
  };

  /**
   * 保存角色提示词
   */
  const handleSaveCharacterPrompt = (charId: string, newPrompt: string) => {
    if (!project.scriptData) return;
    const newData = cloneScriptData(project.scriptData);
    const char = newData.characters.find(c => compareIds(c.id, charId));
    if (char) {
      const normalizedPrompt = dedupeRepeatedPromptClauses(newPrompt);
      char.promptVersions = updatePromptWithVersion(
        char.visualPrompt,
        normalizedPrompt,
        char.promptVersions,
        'manual-edit'
      );
      char.visualPrompt = normalizedPrompt;
      updateProject({ scriptData: invalidateShotGenerationMeta(newData) });
    }
  };

  /**
   * 按当前项目风格重新生成单个资产提示词（不生图）
   */
  const handleRegenerateAssetPrompt = async (
    type: 'character' | 'scene' | 'prop',
    id: string
  ) => {
    if (!project.scriptData) return;
    const key = `${type}:${id}`;
    markPromptRegenerating(key, true);

    try {
      const historicalContext = resolveProductionBible(project.scriptData).historicalContext;
      let artDirection = project.scriptData.artDirection;
      if (!artDirection?.visualStyle || artDirection.visualStyle !== visualStyle) {
        artDirection = await generateArtDirection(
          project.scriptData.title || '未命名剧本',
          genre,
          project.scriptData.logline || '',
          project.scriptData.characters.map(c => ({
            name: c.name,
            gender: c.gender,
            age: c.age,
            personality: c.personality,
            species: c.species,
          })),
          project.scriptData.scenes.map(s => ({
            location: s.location,
            time: s.time,
            atmosphere: s.atmosphere,
          })),
          visualStyle,
          language,
          shotPromptModel
        );
        updateProject(prev => {
          if (!prev.scriptData) return prev;
          const newData = cloneScriptData(prev.scriptData);
          newData.artDirection = artDirection;
          return { ...prev, scriptData: newData };
        });
      }
      let prompts: { visualPrompt: string; negativePrompt: string };

      if (type === 'character') {
        const char = project.scriptData.characters.find(c => compareIds(c.id, id));
        if (!char) return;
        prompts = await generateVisualPrompts(
          'character',
          { ...char, wardrobe: inferCharacterWardrobe(char, project.scriptData.props) },
          genre,
          shotPromptModel,
          visualStyle,
          language,
          artDirection,
          undefined,
          listProjectPropNames(project.scriptData.props),
          historicalContext,
        );
        updateProject(prev => {
          if (!prev.scriptData) return prev;
          const newData = cloneScriptData(prev.scriptData);
          const target = newData.characters.find(c => compareIds(c.id, id));
          if (!target) return prev;
          target.promptVersions = updatePromptWithVersion(
            target.visualPrompt,
            prompts.visualPrompt,
            target.promptVersions,
            'ai-generated',
            'Regenerated character prompt'
          );
          target.visualPrompt = prompts.visualPrompt;
          target.negativePrompt = prompts.negativePrompt;
          newData.artDirection = artDirection;
          return { ...prev, scriptData: invalidateShotGenerationMeta(newData) };
        });
      } else if (type === 'scene') {
        const scene = project.scriptData.scenes.find(s => compareIds(s.id, id));
        if (!scene) return;
        prompts = await generateVisualPrompts(
          'scene',
          scene,
          genre,
          shotPromptModel,
          visualStyle,
          language,
          artDirection,
          undefined,
          undefined,
          historicalContext,
        );
        updateProject(prev => {
          if (!prev.scriptData) return prev;
          const newData = cloneScriptData(prev.scriptData);
          const target = newData.scenes.find(s => compareIds(s.id, id));
          if (!target) return prev;
          target.promptVersions = updatePromptWithVersion(
            target.visualPrompt,
            prompts.visualPrompt,
            target.promptVersions,
            'ai-generated',
            'Regenerated scene prompt'
          );
          target.visualPrompt = prompts.visualPrompt;
          target.negativePrompt = prompts.negativePrompt;
          newData.artDirection = artDirection;
          return { ...prev, scriptData: invalidateShotGenerationMeta(newData) };
        });
      } else {
        const prop = (project.scriptData.props || []).find(p => compareIds(p.id, id));
        if (!prop) return;
        prompts = await generateVisualPrompts(
          'prop',
          prop,
          genre,
          shotPromptModel,
          visualStyle,
          language,
          artDirection,
          undefined,
          undefined,
          historicalContext,
        );
        updateProject(prev => {
          if (!prev.scriptData) return prev;
          const newData = cloneScriptData(prev.scriptData);
          const target = (newData.props || []).find(p => compareIds(p.id, id));
          if (!target) return prev;
          target.promptVersions = updatePromptWithVersion(
            target.visualPrompt,
            prompts.visualPrompt,
            target.promptVersions,
            'ai-generated',
            'Regenerated prop prompt'
          );
          target.visualPrompt = prompts.visualPrompt;
          target.negativePrompt = prompts.negativePrompt;
          newData.artDirection = artDirection;
          return { ...prev, scriptData: invalidateShotGenerationMeta(newData) };
        });
      }
    } catch (e: any) {
      if (onApiKeyError?.(e)) return;
      showAlert(e?.message || '重新生成提示词失败', { type: 'error' });
    } finally {
      markPromptRegenerating(key, false);
    }
  };

  /**
   * 更新角色基本信息
   */
  const handleUpdateCharacterInfo = (charId: string, updates: { name?: string; gender?: string; age?: string; personality?: string; species?: string }) => {
    if (!project.scriptData) return;
    const newData = cloneScriptData(project.scriptData);
    const char = newData.characters.find(c => compareIds(c.id, charId));
    if (char) {
      if (updates.name !== undefined) char.name = updates.name;
      if (updates.gender !== undefined) char.gender = updates.gender;
      if (updates.age !== undefined) char.age = updates.age;
      if (updates.personality !== undefined) char.personality = updates.personality;
      if (updates.species !== undefined) char.species = updates.species;
      updateProject({ scriptData: invalidateShotGenerationMeta(newData) });
    }
  };

  /**
   * 保存场景提示词
   */
  const handleSaveScenePrompt = (sceneId: string, newPrompt: string) => {
    if (!project.scriptData) return;
    const newData = cloneScriptData(project.scriptData);
    const scene = newData.scenes.find(s => compareIds(s.id, sceneId));
    if (scene) {
      scene.promptVersions = updatePromptWithVersion(
        scene.visualPrompt,
        newPrompt,
        scene.promptVersions,
        'manual-edit'
      );
      scene.visualPrompt = newPrompt;
      updateProject({ scriptData: invalidateShotGenerationMeta(newData) });
    }
  };

  /**
   * 更新场景基本信息
   */
  const handleUpdateSceneInfo = (sceneId: string, updates: { location?: string; time?: string; atmosphere?: string }) => {
    if (!project.scriptData) return;
    const newData = cloneScriptData(project.scriptData);
    const scene = newData.scenes.find(s => compareIds(s.id, sceneId));
    if (scene) {
      if (updates.location !== undefined) scene.location = updates.location;
      if (updates.time !== undefined) scene.time = updates.time;
      if (updates.atmosphere !== undefined) scene.atmosphere = updates.atmosphere;
      updateProject({ scriptData: invalidateShotGenerationMeta(newData) });
    }
  };

  /**
   * 新建角色
   */
  const handleAddCharacter = () => {
    if (!project.scriptData) return;
    
    const newChar: Character = {
      id: generateId('char'),
      name: '新角色',
      gender: '未设定',
      age: '未设定',
      personality: '待补充',
      visualPrompt: '',
      variations: [],
      status: 'pending'
    };

    const newData = cloneScriptData(project.scriptData);
    newData.characters.push(newChar);
    updateProject({ scriptData: invalidateShotGenerationMeta(newData) });
    showAlert('新角色已创建，请编辑提示词并生成图片', { type: 'success' });
  };

  /**
   * 删除角色
   */
  const handleDeleteCharacter = (charId: string) => {
    if (!project.scriptData) return;
    const char = project.scriptData.characters.find(c => compareIds(c.id, charId));
    if (!char) return;

    showAlert(
      `确定要删除角色 "${char.name}" 吗？\n\n注意：这将会影响所有使用该角色的分镜，可能导致分镜关联错误。`,
      {
        type: 'warning',
        title: '删除角色',
        showCancel: true,
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: () => {
          const newData = cloneScriptData(project.scriptData!);
          newData.characters = newData.characters.filter(c => !compareIds(c.id, charId));
          const nextShots = project.shots.map(shot => {
            const nextCharacters = shot.characters.filter(cid => !compareIds(cid, charId));
            if (!shot.characterVariations) {
              if (nextCharacters.length === shot.characters.length) return shot;
              return { ...shot, characters: nextCharacters };
            }

            const nextVariations: Record<string, string> = {};
            Object.entries(shot.characterVariations as Record<string, string>).forEach(([key, value]) => {
              if (!compareIds(key, charId)) nextVariations[key] = value;
            });

            const hasVariationChanged = Object.keys(nextVariations).length !== Object.keys(shot.characterVariations).length;
            const hasCharacterChanged = nextCharacters.length !== shot.characters.length;
            if (!hasVariationChanged && !hasCharacterChanged) return shot;

            return {
              ...shot,
              characters: nextCharacters,
              characterVariations: Object.keys(nextVariations).length > 0 ? nextVariations : undefined,
            };
          });

          let nextRefs = project.characterRefs || [];
          if (char.libraryId) {
            const hasOtherLinkedCharacter = newData.characters.some(c => c.libraryId === char.libraryId);
            if (!hasOtherLinkedCharacter) {
              nextRefs = nextRefs.filter(ref => ref.characterId !== char.libraryId);
            }
          }

          updateProject({
            scriptData: invalidateShotGenerationMeta(newData),
            shots: nextShots,
            characterRefs: nextRefs
          });
          showAlert(`角色 "${char.name}" 已删除`, { type: 'success' });
        }
      }
    );
  };

  /**
   * 新建场景
   */
  const handleAddScene = () => {
    if (!project.scriptData) return;
    
    const newScene: Scene = {
      id: generateId('scene'),
      location: '新场景',
      time: '未设定',
      atmosphere: '待补充',
      visualPrompt: '',
      status: 'pending'
    };

    const newData = cloneScriptData(project.scriptData);
    newData.scenes.push(newScene);
    updateProject({ scriptData: invalidateShotGenerationMeta(newData) });
    showAlert('新场景已创建，请编辑提示词并生成图片', { type: 'success' });
  };

  /**
   * 删除场景
   */
  const handleDeleteScene = (sceneId: string) => {
    if (!project.scriptData) return;
    const scene = project.scriptData.scenes.find(s => compareIds(s.id, sceneId));
    if (!scene) return;

    showAlert(
      `确定要删除场景 "${scene.location}" 吗？\n\n注意：这将会影响所有使用该场景的分镜，可能导致分镜关联错误。`,
      {
        type: 'warning',
        title: '删除场景',
        showCancel: true,
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: () => {
          const newData = cloneScriptData(project.scriptData!);
          newData.scenes = newData.scenes.filter(s => !compareIds(s.id, sceneId));
          const nextShots = project.shots.filter(shot => !compareIds(shot.sceneId, sceneId));
          let nextRefs = project.sceneRefs || [];
          if (scene.libraryId) {
            const hasOtherLinkedScene = newData.scenes.some(s => s.libraryId === scene.libraryId);
            if (!hasOtherLinkedScene) {
              nextRefs = nextRefs.filter(ref => ref.sceneId !== scene.libraryId);
            }
          }
          updateProject({
            scriptData: invalidateShotGenerationMeta(newData),
            shots: nextShots,
            sceneRefs: nextRefs
          });
          showAlert(`场景 "${scene.location}" 已删除`, { type: 'success' });
        }
      }
    );
  };

  // ============================
  // 道具相关处理函数
  // ============================

  /**
   * 新建道具
   */
  const handleAddProp = () => {
    if (!project.scriptData) return;
    
    const newProp: Prop = {
      id: generateId('prop'),
      name: '新道具',
      category: '其他',
      description: '',
      presentationMode: 'unknown',
      visualPrompt: '',
      status: 'pending'
    };

    const newData = cloneScriptData(project.scriptData);
    if (!newData.props) newData.props = [];
    newData.props.push(newProp);
    updateProject({ scriptData: invalidateShotGenerationMeta(newData) });
    showAlert('新道具已创建，请编辑描述和提示词并生成图片', { type: 'success' });
  };

  /**
   * 删除道具
   */
  const handleDeleteProp = (propId: string) => {
    if (!project.scriptData) return;
    const prop = (project.scriptData.props || []).find(p => compareIds(p.id, propId));
    if (!prop) return;

    showAlert(
      `确定要删除道具 "${prop.name}" 吗？\n\n注意：这将会影响所有使用该道具的分镜。`,
      {
        type: 'warning',
        title: '删除道具',
        showCancel: true,
        confirmText: '删除',
        cancelText: '取消',
        onConfirm: () => {
          const newData = cloneScriptData(project.scriptData!);
          newData.props = (newData.props || []).filter(p => !compareIds(p.id, propId));
          // 清除所有镜头中对该道具的引用
          const nextShots = project.shots.map(shot => {
            if (!shot.props || !shot.props.some(id => compareIds(id, propId))) return shot;
            return { ...shot, props: shot.props.filter(id => !compareIds(id, propId)) };
          });

          let nextRefs = project.propRefs || [];
          if (prop.libraryId) {
            const hasOtherLinkedProp = (newData.props || []).some(p => p.libraryId === prop.libraryId);
            if (!hasOtherLinkedProp) {
              nextRefs = nextRefs.filter(ref => ref.propId !== prop.libraryId);
            }
          }

          updateProject({
            scriptData: invalidateShotGenerationMeta(newData),
            shots: nextShots,
            propRefs: nextRefs
          });
          showAlert(`道具 "${prop.name}" 已删除`, { type: 'success' });
        }
      }
    );
  };

  /**
   * 生成道具图片
   */
  const handleGeneratePropAsset = async (propId: string) => {
    const scriptSnapshot = project.scriptData;
    if (!scriptSnapshot) return;
    const historicalContext = resolveProductionBible(scriptSnapshot).historicalContext;

    // 设置生成状态
    updateProject(prev => {
      if (!prev.scriptData) return prev;
      const newData = cloneScriptData(prev.scriptData);
      const p = (newData.props || []).find(prop => compareIds(prop.id, propId));
      if (p) p.status = 'generating';
      return { ...prev, scriptData: newData };
    });

    try {
      const prop = scriptSnapshot.props?.find(p => compareIds(p.id, propId));
      if (!prop) return;

      let prompt = '';
      const shapeReferenceImage = prop.shapeReferenceImage;
      let negativePrompt = prop.negativePrompt || '';
      if (prop.visualPrompt) {
        prompt = prop.visualPrompt;
      } else {
        const prompts = await generateVisualPrompts(
          'prop',
          prop,
          genre,
          shotPromptModel,
          visualStyle,
          language,
          scriptSnapshot.artDirection,
          undefined,
          undefined,
          historicalContext,
        );
        prompt = prompts.visualPrompt;
        negativePrompt = prompts.negativePrompt || negativePrompt;

        // 保存 AI 生成的道具提示词和负面词，保证与角色/场景一致走统一链路
        updateProject(prev => {
          if (!prev.scriptData) return prev;
          const newData = cloneScriptData(prev.scriptData);
          const p = (newData.props || []).find(item => compareIds(item.id, propId));
          if (p) {
            p.promptVersions = updatePromptWithVersion(
              p.visualPrompt,
              prompts.visualPrompt,
              p.promptVersions,
              'ai-generated',
              'Auto-generated prop prompt'
            );
            p.visualPrompt = prompts.visualPrompt;
            p.negativePrompt = prompts.negativePrompt;
          }
          return { ...prev, scriptData: newData };
        });
      }

      // Prop image: enforce object-only shot without human figures.
      prompt += '. IMPORTANT: This is a standalone prop/item shot with absolutely NO people, NO human figures, NO characters - object only on clean/simple background.';
      if (shapeReferenceImage) {
        prompt += shapeReferenceStyleInstruction;
      }

      const imageUrl = await generateImage(
        prompt,
        shapeReferenceImage ? [shapeReferenceImage] : [],
        '16:9',
        false,
        false,
        negativePrompt,
        shapeReferenceImage
          ? { referencePackType: 'shape', target: { kind: 'prop', id: propId } }
          : { referencePackType: 'prop', target: { kind: 'prop', id: propId } }
      );

      // 更新状态
      updateProject(prev => {
        if (!prev.scriptData) return prev;
        const updatedData = cloneScriptData(prev.scriptData);
        const updated = (updatedData.props || []).find(p => compareIds(p.id, propId));
        if (updated) {
          updated.referenceImage = imageUrl;
          updated.referenceImageUpdatedAt = Date.now();
          updated.status = 'completed';
          if (!updated.visualPrompt) {
            updated.promptVersions = updatePromptWithVersion(
              updated.visualPrompt,
              prompt,
              updated.promptVersions,
              'ai-generated',
              'Auto-generated prop prompt'
            );
            updated.visualPrompt = prompt;
          }
          if (!updated.negativePrompt && negativePrompt) {
            updated.negativePrompt = negativePrompt;
          }
        }
        return { ...prev, scriptData: updatedData };
      });
    } catch (e: any) {
      console.error(e);
      updateProject(prev => {
        if (!prev.scriptData) return prev;
        const errData = cloneScriptData(prev.scriptData);
        const errP = (errData.props || []).find(p => compareIds(p.id, propId));
        if (errP) errP.status = 'failed';
        return { ...prev, scriptData: errData };
      });
      if (onApiKeyError && onApiKeyError(e)) return;
    }
  };
  const handleUploadPropImage = async (propId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);
      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = cloneScriptData(prev.scriptData);
        const prop = (newData.props || []).find(p => compareIds(p.id, propId));
        if (prop) {
          prop.referenceImage = base64;
          prop.status = 'completed';
        }
        return { ...prev, scriptData: newData };
      });
    } catch (e: any) {
      showAlert(e.message, { type: 'error' });
    }
  };

  /**
   * 保存道具提示词
   */
  const handleSavePropPrompt = (propId: string, newPrompt: string) => {
    if (!project.scriptData) return;
    const newData = cloneScriptData(project.scriptData);
    const prop = (newData.props || []).find(p => compareIds(p.id, propId));
    if (prop) {
      prop.promptVersions = updatePromptWithVersion(
        prop.visualPrompt,
        newPrompt,
        prop.promptVersions,
        'manual-edit'
      );
      prop.visualPrompt = newPrompt;
      updateProject({ scriptData: invalidateShotGenerationMeta(newData) });
    }
  };

  /**
   * 更新道具基本信息
   */
  const handleUpdatePropInfo = (propId: string, updates: {
    name?: string;
    category?: string;
    description?: string;
    presentationMode?: PropPresentationMode;
    presentationNote?: string;
  }) => {
    if (!project.scriptData) return;
    const newData = cloneScriptData(project.scriptData);
    const prop = (newData.props || []).find(p => compareIds(p.id, propId));
    if (prop) {
      if (updates.name !== undefined) prop.name = updates.name;
      if (updates.category !== undefined) prop.category = updates.category;
      if (updates.description !== undefined) prop.description = updates.description;
      if (updates.presentationMode !== undefined) prop.presentationMode = updates.presentationMode;
      if (updates.presentationNote !== undefined) prop.presentationNote = updates.presentationNote || undefined;
      updateProject({ scriptData: invalidateShotGenerationMeta(newData) });
    }
  };

  /**
   * 加入资产库（道具）
   */
  const handleAddPropToLibrary = (prop: Prop) => {
    const saveItem = async () => {
      try {
        const item = createLibraryItemFromProp(prop, project);
        await saveAssetToLibrary(item);
        showAlert(`已加入资产库：${prop.name}`, { type: 'success' });
        refreshLibrary();
      } catch (e: any) {
        showAlert(e?.message || '加入资产库失败', { type: 'error' });
      }
    };

    if (!prop.referenceImage) {
      showAlert('该道具暂无参考图，仍要加入资产库吗？', {
        type: 'warning',
        showCancel: true,
        onConfirm: saveItem
      });
      return;
    }

    void saveItem();
  };

  /**
   * 批量生成道具
   */
  const handleBatchGenerateProps = async () => {
    const items = (project.scriptData?.props || []).filter((prop) => !isWearableProp(prop));
    if (!items.length) return;

    const itemsToGen = items.filter(p => !p.referenceImage);
    const isRegenerate = itemsToGen.length === 0;

    if (isRegenerate) {
      showAlert('确定要重新生成所有道具图吗？', {
        type: 'warning',
        showCancel: true,
        onConfirm: async () => {
          await executeBatchGenerateProps(items);
        }
      });
      return;
    }

    await executeBatchGenerateProps(itemsToGen);
  };

  const executeBatchGenerateProps = async (targetItems: Prop[]) => {
    setBatchProgress({ current: 0, total: targetItems.length });

    try {
      for (let i = 0; i < targetItems.length; i++) {
        if (i > 0) await delay(DEFAULTS.batchGenerateDelay);
        await handleGeneratePropAsset(targetItems[i].id);
        setBatchProgress({ current: i + 1, total: targetItems.length });
      }
    } finally {
      setBatchProgress(null);
    }
  };

  /**
   * 添加角色变体
   */
  const handleAddVariation = (charId: string, name: string, prompt: string) => {
    if (!project.scriptData) return;
    const newData = cloneScriptData(project.scriptData);
    const char = newData.characters.find(c => compareIds(c.id, charId));
    if (!char) return;

    const newVar: CharacterVariation = {
      id: generateId('var'),
      name: name || "New Outfit",
      wardrobe: prompt || "",
      visualPrompt: prompt || char.visualPrompt || "",
      referenceImage: undefined
    };

    if (!char.variations) char.variations = [];
    char.variations.push(newVar);
    
    updateProject({ scriptData: newData });
  };

  /** 基础服装是镜头默认造型；服装变体只在镜头明确选择后覆盖。 */
  const handleSaveBaseWardrobe = (charId: string, wardrobe: string) => {
    if (!project.scriptData) return;
    const newData = cloneScriptData(project.scriptData);
    const char = newData.characters.find(c => compareIds(c.id, charId));
    if (!char) return;
    char.wardrobe = wardrobe;
    updateProject({ scriptData: newData });
  };

  /**
   * 删除角色变体
   */
  const handleDeleteVariation = (charId: string, varId: string) => {
    if (!project.scriptData) return;
    const newData = cloneScriptData(project.scriptData);
    const char = newData.characters.find(c => compareIds(c.id, charId));
    if (!char) return;
    
    char.variations = char.variations?.filter(v => !compareIds(v.id, varId));
    updateProject({ scriptData: newData });
  };

  /**
   * 生成角色变体
   */
  const handleGenerateVariation = async (charId: string, varId: string) => {
    const char = project.scriptData?.characters.find(c => compareIds(c.id, charId));
    const variation = char?.variations?.find(v => compareIds(v.id, varId));
    if (!char || !variation) return;

    // 设置生成状态
    if (project.scriptData) {
      const newData = cloneScriptData(project.scriptData);
      const c = newData.characters.find(c => compareIds(c.id, charId));
      const v = c?.variations?.find(v => compareIds(v.id, varId));
      if (v) v.status = 'generating';
      updateProject({ scriptData: newData });
    }
    try {
      const refImages = char.referenceImage ? [char.referenceImage] : [];
      const regionalPrefix = getRegionalPrefix(language, 'character');
      const enhancedPrompt = applyCharacterCastingPositivePrompt(
        `${regionalPrefix}Character "${char.name}" wearing NEW OUTFIT: ${variation.wardrobe || variation.visualPrompt}. This is an attire change only — keep the same subject and body plan as the reference, replace the base wardrobe completely, and preserve every specified garment color and material exactly.`,
        listProjectPropNames(project.scriptData?.props),
        char
      );
      const negativePrompt = mergeCharacterCastingNegativePrompt(
        visualStyle,
        variation.negativePrompt || char.negativePrompt,
        char
      );
      
      // 服装变体沿用定妆竖构图
      const imageUrl = await generateImage(
        enhancedPrompt,
        refImages,
        resolveCharacterCastingAspectRatio(),
        true,
        false,
        negativePrompt,
        { referencePackType: 'character', target: { kind: 'variation', characterId: charId, id: varId } }
      );

      const newData = cloneScriptData(project.scriptData!);
      const c = newData.characters.find(c => compareIds(c.id, charId));
      const v = c?.variations?.find(v => compareIds(v.id, varId));
      if (v) {
        v.referenceImage = imageUrl;
        v.status = 'completed';
      }

      updateProject({ scriptData: newData });
    } catch (e: any) {
      console.error(e);
      // 设置失败状态
      if (project.scriptData) {
        const newData = cloneScriptData(project.scriptData);
        const c = newData.characters.find(c => compareIds(c.id, charId));
        const v = c?.variations?.find(v => compareIds(v.id, varId));
        if (v) v.status = 'failed';
        updateProject({ scriptData: newData });
      }
      if (onApiKeyError && onApiKeyError(e)) {
        return;
      }
      showAlert("Variation generation failed", { type: 'error' });
    }
  };

  /**
   * 上传角色变体图片
   */
  const handleUploadVariationImage = async (charId: string, varId: string, file: File) => {
    try {
      const base64 = await handleImageUpload(file);

      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = cloneScriptData(prev.scriptData);
        const char = newData.characters.find(c => compareIds(c.id, charId));
        const variation = char?.variations?.find(v => compareIds(v.id, varId));
        if (variation) {
          variation.referenceImage = base64;
          variation.status = 'completed';
        }
        return { ...prev, scriptData: newData };
      });
    } catch (e: any) {
      showAlert(e.message, { type: 'error' });
    }
  };

  // ============================
  // 角色九宫格造型相关处理函数
  // ============================

  /**
   * 生成角色九宫格造型的视角描述（Step 1）
   */
  const handleGenerateTurnaroundPanels = async (charId: string) => {
    const char = project.scriptData?.characters.find(c => compareIds(c.id, charId));
    if (!char) return;

    // 设置状态为 generating_panels
    updateProject((prev) => {
      if (!prev.scriptData) return prev;
      const newData = cloneScriptData(prev.scriptData);
      const c = newData.characters.find(c => compareIds(c.id, charId));
      if (c) {
        c.turnaround = {
          panels: [],
          status: 'generating_panels',
        };
      }
      return { ...prev, scriptData: newData };
    });

    try {
      const panels = await generateCharacterTurnaroundPanels(
        char,
        visualStyle,
        project.scriptData?.artDirection,
        language,
        shotPromptModel
      );

      // 更新状态为 panels_ready
      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = cloneScriptData(prev.scriptData);
        const c = newData.characters.find(c => compareIds(c.id, charId));
        if (c) {
          c.turnaround = {
            panels,
            status: 'panels_ready',
          };
        }
        return { ...prev, scriptData: newData };
      });
    } catch (e: any) {
      console.error('九宫格视角描述生成失败:', e);
      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = cloneScriptData(prev.scriptData);
        const c = newData.characters.find(c => compareIds(c.id, charId));
        if (c && c.turnaround) {
          c.turnaround.status = 'failed';
        }
        return { ...prev, scriptData: newData };
      });
      if (onApiKeyError && onApiKeyError(e)) return;
      showAlert('九宫格视角描述生成失败', { type: 'error' });
    }
  };

  /**
   * 确认视角描述并生成九宫格图片（Step 2）
   */
  const handleConfirmTurnaroundPanels = async (charId: string, panels: CharacterTurnaroundPanel[]) => {
    const char = project.scriptData?.characters.find(c => compareIds(c.id, charId));
    if (!char) return;

    // 设置状态为 generating_image
    updateProject((prev) => {
      if (!prev.scriptData) return prev;
      const newData = cloneScriptData(prev.scriptData);
      const c = newData.characters.find(c => compareIds(c.id, charId));
      if (c && c.turnaround) {
        c.turnaround.status = 'generating_image';
        c.turnaround.panels = panels;
      }
      return { ...prev, scriptData: newData };
    });

    try {
      const imageUrl = await generateCharacterTurnaroundImage(
        char,
        panels,
        visualStyle,
        char.referenceImage,
        project.scriptData?.artDirection,
        { target: { kind: 'turnaround', characterId: charId } }
      );

      // 更新状态为 completed
      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = cloneScriptData(prev.scriptData);
        const c = newData.characters.find(c => compareIds(c.id, charId));
        if (c && c.turnaround) {
          c.turnaround.imageUrl = imageUrl;
          c.turnaround.status = 'completed';
          c.activeImageView = 'turnaround';
        }
        return { ...prev, scriptData: newData };
      });
    } catch (e: any) {
      console.error('九宫格造型图片生成失败:', e);
      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = cloneScriptData(prev.scriptData);
        const c = newData.characters.find(c => compareIds(c.id, charId));
        if (c && c.turnaround) {
          c.turnaround.status = 'failed';
        }
        return { ...prev, scriptData: newData };
      });
      if (onApiKeyError && onApiKeyError(e)) return;
      showAlert('九宫格造型图片生成失败', { type: 'error' });
    }
  };

  /**
   * 更新九宫格造型的单个面板
   */
  const handleUpdateTurnaroundPanel = (charId: string, index: number, updates: Partial<CharacterTurnaroundPanel>) => {
    updateProject((prev) => {
      if (!prev.scriptData) return prev;
      const newData = cloneScriptData(prev.scriptData);
      const c = newData.characters.find(c => compareIds(c.id, charId));
      if (c && c.turnaround && c.turnaround.panels[index]) {
        c.turnaround.panels[index] = { ...c.turnaround.panels[index], ...updates };
      }
      return { ...prev, scriptData: newData };
    });
  };

  /**
   * 重新生成九宫格造型（文案+图片全部重来）
   */
  const handleRegenerateTurnaround = (charId: string) => {
    handleGenerateTurnaroundPanels(charId);
  };

  /**
   * 仅重新生成九宫格造型图片（保留已有的视角描述文案）
   * 当用户对文案满意但图片效果不好时使用
   */
  const handleRegenerateTurnaroundImage = (charId: string) => {
    const char = project.scriptData?.characters.find(c => compareIds(c.id, charId));
    if (!char || !char.turnaround?.panels || char.turnaround.panels.length !== 9) return;
    
    // 直接使用已有的面板描述重新生成图片
    handleConfirmTurnaroundPanels(charId, char.turnaround.panels);
  };

  const handleGenerateThreeView = async (charId: string) => {
    const char = project.scriptData?.characters.find(c => compareIds(c.id, charId));
    if (!char) return;

    updateProject((prev) => {
      if (!prev.scriptData) return prev;
      const newData = cloneScriptData(prev.scriptData);
      const target = newData.characters.find(c => compareIds(c.id, charId));
      if (target) {
        target.threeView = {
          ...target.threeView,
          status: 'generating',
        };
      }
      return { ...prev, scriptData: newData };
    });

    try {
      const imageUrl = await generateCharacterThreeViewImage(
        char,
        visualStyle,
        char.referenceImage,
        { target: { kind: 'threeView', characterId: charId } }
      );
      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = cloneScriptData(prev.scriptData);
        const target = newData.characters.find(c => compareIds(c.id, charId));
        if (target) {
          target.threeView = { ...target.threeView, imageUrl, status: 'completed' };
          target.activeImageView = 'threeView';
        }
        return { ...prev, scriptData: newData };
      });
    } catch (e: any) {
      updateProject((prev) => {
        if (!prev.scriptData) return prev;
        const newData = cloneScriptData(prev.scriptData);
        const target = newData.characters.find(c => compareIds(c.id, charId));
        if (target) {
          target.threeView = { ...target.threeView, status: 'failed' };
        }
        return { ...prev, scriptData: newData };
      });
      if (onApiKeyError && onApiKeyError(e)) return;
      showAlert(e?.message || text('三视图生成失败', 'Three-view generation failed'), { type: 'error' });
    }
  };

  const handleRegenerateCharacterView = (char: Character) => {
    const view = resolveCharacterImageView(char);
    if (view === 'turnaround') {
      if (char.turnaround?.panels?.length === 9) handleRegenerateTurnaroundImage(char.id);
      else handleGenerateTurnaroundPanels(char.id);
      return;
    }
    if (view === 'threeView') {
      handleGenerateThreeView(char.id);
      return;
    }
    handleGenerateAsset('character', char.id);
  };

  // 空状态
  if (!project.scriptData) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-[var(--bg-secondary)] text-[var(--text-tertiary)]">
        <p>请先完成 Phase 01 剧本分析</p>
      </div>
    );
  }
  
  const allCharactersReady = project.scriptData.characters.every(c => c.referenceImage);
  const allScenesReady = project.scriptData.scenes.every(s => s.referenceImage);
  const visibleProps = (project.scriptData.props || []).filter((prop) => !isWearableProp(prop));
  const allPropsReady = visibleProps.length > 0 && visibleProps.every(p => p.referenceImage);
  const selectedChar = selectedCharId == null
    ? undefined
    : project.scriptData.characters.find(c => compareIds(c.id, selectedCharId));
  const getLibraryProjectName = (item: AssetLibraryItem): string => {
    const projectName = typeof item.projectName === 'string' ? item.projectName.trim() : '';
    return projectName || 'Unknown Project';
  };

  const projectNameOptions = Array.from<string>(
    new Set<string>(
      libraryItems.map((item) => getLibraryProjectName(item))
    )
  ).sort((a, b) => a.localeCompare(b, 'zh-CN'));
  const filteredLibraryItems = libraryItems.filter((item) => {
    if (libraryFilter !== 'all' && item.type !== libraryFilter) return false;
    if (libraryProjectFilter !== 'all') {
      const projectName = getLibraryProjectName(item);
      if (projectName !== libraryProjectFilter) return false;
    }
    if (!libraryQuery.trim()) return true;
    const query = libraryQuery.trim().toLowerCase();
    return item.name.toLowerCase().includes(query);
  });

  return (
    <div className={STYLES.mainContainer}>
      
      {/* Image Preview Modal */}
      <ImagePreviewModal 
        imageUrl={previewImage?.url || null}
        imageUrls={previewImage?.imageUrls}
        onClose={() => setPreviewImage(null)} 
      />

      {/* Global Progress Overlay */}
      {batchProgress && (
        <div className="absolute inset-0 z-50 bg-[var(--bg-base)]/80 flex flex-col items-center justify-center backdrop-blur-md animate-in fade-in">
          <Loader2 className="w-12 h-12 text-[var(--accent)] animate-spin mb-6" />
          <h3 className="text-xl font-bold text-[var(--text-primary)] mb-2">正在批量生成资源...</h3>
          <div className="w-64 h-1.5 bg-[var(--bg-hover)] rounded-full overflow-hidden mb-2">
            <div 
              className="h-full bg-[var(--accent)] transition-all duration-300" 
              style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
            />
          </div>
          <p className="text-[var(--text-tertiary)] font-mono text-xs">
            进度: {batchProgress.current} / {batchProgress.total}
          </p>
        </div>
      )}

      {/* Wardrobe Modal */}
      {selectedChar && (
        <WardrobeModal
          character={selectedChar}
          onClose={() => setSelectedCharId(null)}
          onBaseWardrobeSave={handleSaveBaseWardrobe}
          onAddVariation={handleAddVariation}
          onDeleteVariation={handleDeleteVariation}
          onGenerateVariation={handleGenerateVariation}
          onUploadVariation={handleUploadVariationImage}
          onImageClick={openImagePreview}
        />
      )}

      {/* Turnaround Modal */}
      {turnaroundCharId && (() => {
        const turnaroundChar = project.scriptData?.characters.find(c => compareIds(c.id, turnaroundCharId));
        return turnaroundChar ? (
          <TurnaroundModal
            character={turnaroundChar}
            onClose={() => setTurnaroundCharId(null)}
            onGeneratePanels={handleGenerateTurnaroundPanels}
            onConfirmPanels={handleConfirmTurnaroundPanels}
            onUpdatePanel={handleUpdateTurnaroundPanel}
            onRegenerate={handleRegenerateTurnaround}
            onRegenerateImage={handleRegenerateTurnaroundImage}
          onImageClick={openImagePreview}
          />
        ) : null;
      })()}

      {threeViewCharId && (() => {
        const threeViewChar = project.scriptData?.characters.find(c => compareIds(c.id, threeViewCharId));
        return threeViewChar ? (
          <ThreeViewModal
            character={threeViewChar}
            onClose={() => setThreeViewCharId(null)}
            onGenerate={handleGenerateThreeView}
          onImageClick={openImagePreview}
          />
        ) : null;
      })()}

      {/* Asset Library Modal */}
      {showLibraryModal && (
        <div className={STYLES.modalOverlay} onClick={() => {
          setShowLibraryModal(false);
          setReplaceTargetCharId(null);
        }}>
          <div className={STYLES.modalContainer} onClick={(e) => e.stopPropagation()}>
            <div className={STYLES.modalHeader}>
              <div className="flex items-center gap-3">
                <Archive className="w-4 h-4 text-[var(--accent-text)]" />
                <div>
                  <div className="text-sm font-bold text-[var(--text-primary)]">资产库</div>
                  <div className="text-[10px] text-[var(--text-tertiary)] font-mono uppercase tracking-widest">
                    {libraryItems.length} assets
                  </div>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowLibraryModal(false);
                  setReplaceTargetCharId(null);
                }}
                className="p-2 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] rounded"
                title="关闭"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className={STYLES.modalBody}>
              <div className="flex flex-wrap items-center gap-3 mb-6">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    value={libraryQuery}
                    onChange={(e) => setLibraryQuery(e.target.value)}
                    placeholder="搜索资产名称..."
                    className="w-full pl-9 pr-3 py-2 bg-[var(--bg-deep)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)]"
                  />
                </div>
                <div className="min-w-[180px]">
                  <select
                    value={libraryProjectFilter}
                    onChange={(e) => setLibraryProjectFilter(e.target.value)}
                    className="w-full px-3 py-2 bg-[var(--bg-deep)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-secondary)]"
                  >
                    <option value="all">全部项目</option>
                    {projectNameOptions.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2">
                  {(['all', 'character', 'scene', 'prop'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setLibraryFilter(type)}
                      className={`px-3 py-2 text-[10px] font-bold uppercase tracking-widest border rounded ${
                        libraryFilter === type
                          ? 'bg-[var(--btn-selected-bg)] text-[var(--btn-selected-text)] border-[var(--btn-selected-border)]'
                          : 'bg-transparent text-[var(--text-tertiary)] border-[var(--border-primary)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)]'
                      }`}
                    >
                      {type === 'all' ? '全部' : type === 'character' ? '角色' : type === 'scene' ? '场景' : '道具'}
                    </button>
                  ))}
                </div>
              </div>

              {libraryLoading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-5 h-5 text-[var(--text-tertiary)] animate-spin" />
                </div>
              ) : filteredLibraryItems.length === 0 ? (
                <div className="border border-dashed border-[var(--border-primary)] rounded-xl p-10 text-center text-[var(--text-muted)] text-sm">
                  暂无资产。可在角色或场景卡片中选择“加入资产库”。
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredLibraryItems.map((item) => {
                    const preview =
                      item.type === 'character'
                        ? (item.data as Character).referenceImage
                        : item.type === 'scene'
                        ? (item.data as Scene).referenceImage
                        : (item.data as Prop).referenceImage;
                    return (
                      <div
                        key={item.id}
                        className="bg-[var(--bg-deep)] border border-[var(--border-primary)] rounded-xl overflow-hidden hover:border-[var(--border-secondary)] transition-colors"
                      >
                        <div className="aspect-video bg-[var(--bg-elevated)] relative">
                          {preview ? (
                            <img src={preview} alt={item.name} className={`w-full h-full object-cover${item.type === 'character' ? ' object-top' : ''}`} />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-[var(--text-muted)]">
                              {item.type === 'character' ? (
                                <Users className="w-8 h-8 opacity-30" />
                              ) : item.type === 'scene' ? (
                                <MapPin className="w-8 h-8 opacity-30" />
                              ) : (
                                <Package className="w-8 h-8 opacity-30" />
                              )}
                            </div>
                          )}
                        </div>
                        <div className="p-4 space-y-3">
                          <div>
                            <div className="text-sm text-[var(--text-primary)] font-bold line-clamp-1">{item.name}</div>
                            <div className="text-[10px] text-[var(--text-tertiary)] font-mono uppercase tracking-widest mt-1">
                              {item.type === 'character' ? '角色' : item.type === 'scene' ? '场景' : '道具'}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)] font-mono mt-1 line-clamp-1">
                              {(item.projectName && item.projectName.trim()) || '未知项目'}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() =>
                                replaceTargetCharId
                                  ? handleReplaceCharacterFromLibrary(item, replaceTargetCharId)
                                  : handleImportFromLibrary(item)
                              }
                              className="flex-1 py-2 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
                            >
                              {replaceTargetCharId ? '替换当前角色' : '导入到当前项目'}
                            </button>
                            <button
                              onClick={() =>
                                showAlert('确定从资产库删除该资源吗？', {
                                  type: 'warning',
                                  showCancel: true,
                                  onConfirm: () => handleDeleteLibraryItem(item.id)
                                })
                              }
                              className="p-2 border border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--error-text)] hover:border-[var(--error-border)] rounded transition-colors"
                              title="删除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className={STYLES.header}>
        <div className="flex items-center gap-4">
          <h2 className="text-lg font-bold text-[var(--text-primary)] flex items-center gap-3">
            <Users className="w-5 h-5 text-[var(--accent)]" />
            <BilingualLabel primary="视觉设定" secondary="VISUAL DEVELOPMENT" mode="badge" />
          </h2>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => openLibrary('all')}
            disabled={!!batchProgress}
            className={STYLES.secondaryButton}
          >
            <Archive className="w-4 h-4" />
            {text('资产库', 'Asset Library')}
          </button>
          {/* 项目视频画幅；角色定妆、场景和道具资产使用各自固定的参考构图。 */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-tertiary)] uppercase">{text('项目视频比例', 'VIDEO RATIO')}</span>
            <AspectRatioSelector
              value={aspectRatio}
              onChange={setAspectRatio}
              allowSquare={(() => {
                // 根据当前激活的图片模型判断是否支持方形
                const activeModel = getActiveImageModel();
                return activeModel?.params?.supportedAspectRatios?.includes('1:1') ?? false;
              })()}
              disabled={!!batchProgress}
            />
          </div>
          <div className="w-px h-6 bg-[var(--bg-hover)]" />
          <div className="flex gap-2">
            <span className={STYLES.badge}>
              {project.scriptData.characters.length} CHARS
            </span>
            <span className={STYLES.badge}>
              {project.scriptData.scenes.length} SCENES
            </span>
            <span className={STYLES.badge}>
              {visibleProps.length} PROPS
            </span>
          </div>
        </div>
      </div>

      <div className={STYLES.content}>
        {/* Characters Section */}
        <section>
          <div className="flex items-end justify-between mb-6 border-b border-[var(--border-primary)] pb-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-[var(--accent)] rounded-full" />
                <BilingualLabel primary="角色定妆" secondary="CHARACTER CASTING" />
              </h3>
              <p className="text-xs text-[var(--text-tertiary)] mt-1 pl-3.5">{text('全身棚拍定妆，只锁脸、体型、服装和鞋子；背包等道具在镜头里再加', 'Full-body casting references lock the face, build, wardrobe, and footwear; shot-specific props are added later.')}</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={handleAddCharacter}
                disabled={!!batchProgress}
                className="px-3 py-1.5 bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Users className="w-3 h-3" />
                {text('新建角色', 'New Character')}
              </button>
              {project.projectId && (
                <button
                  onClick={() => {
                    if (project.projectId) {
                      loadSeriesProject(project.projectId).then(sp => { setPickerProject(sp); setShowCharLibraryPicker(true); }).catch(() => {});
                    }
                  }}
                  disabled={!!batchProgress}
                  className={STYLES.secondaryButton}
                >
                  <Link2 className="w-3 h-3" />
                  {text('从角色库添加', 'Add from Cast')}
                </button>
              )}
              <button 
                onClick={() => openLibrary('character')}
                disabled={!!batchProgress}
                className={STYLES.secondaryButton}
              >
                <Archive className="w-3 h-3" />
                {text('从资产库选择', 'Choose Asset')}
              </button>
              <button 
                onClick={() => handleBatchGenerate('character')}
                disabled={!!batchProgress}
                className={allCharactersReady ? STYLES.secondaryButton : STYLES.primaryButton}
              >
                {allCharactersReady ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                {allCharactersReady ? text('重新生成所有角色', 'Regenerate All') : text('一键生成所有角色', 'Generate All')}
              </button>
            </div>
          </div>

          <div className={GRID_LAYOUTS.characterCards}>
            {project.scriptData.characters.map((char) => (
              <CharacterCard
                key={char.id}
                character={char}
                isGenerating={char.status === 'generating'}
                shapeReferenceImage={char.shapeReferenceImage}
                referenceWorkflowName={activeImageParams.referenceWorkflowName}
                referenceSteps={activeImageParams.referenceSteps}
                onGenerate={() => handleRegenerateCharacterView(char)}
                onUpload={(file) => handleUploadCharacterImage(char.id, file)}
                onUploadShapeReference={(file) => handleUploadShapeReferenceImage('character', char.id, file)}
                onClearShapeReference={() => handleClearShapeReferenceImage('character', char.id)}
                onPromptSave={(newPrompt) => handleSaveCharacterPrompt(char.id, newPrompt)}
                onRegeneratePrompt={() => handleRegenerateAssetPrompt('character', char.id)}
                isRegeneratingPrompt={regeneratingPromptIds.has(`character:${char.id}`)}
                onOpenWardrobe={() => setSelectedCharId(char.id)}
                onOpenTurnaround={() => handleOpenCharacterView(char.id, 'turnaround')}
                onOpenThreeView={() => handleOpenCharacterView(char.id, 'threeView')}
                onImageClick={openImagePreview}
                onDelete={() => handleDeleteCharacter(char.id)}
                onUpdateInfo={(updates) => handleUpdateCharacterInfo(char.id, updates)}
                onAddToLibrary={() => handleAddCharacterToLibrary(char)}
                onReplaceFromLibrary={() => openLibrary('character', char.id)}
                onApplyHistory={(imageUrl) => handleApplyCharacterHistory(char.id, imageUrl)}
              />
            ))}
          </div>
        </section>

        {/* Scenes Section */}
        <section>
          <div className="flex items-end justify-between mb-6 border-b border-[var(--border-primary)] pb-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-[var(--success)] rounded-full" />
                <BilingualLabel primary="场景概念" secondary="LOCATIONS" />
              </h3>
              <p className="text-xs text-[var(--text-tertiary)] mt-1 pl-3.5">{text('为剧本场景生成环境参考图', 'Create environment references for the locations in the script.')}</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={handleAddScene}
                disabled={!!batchProgress}
                className="px-3 py-1.5 bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <MapPin className="w-3 h-3" />
                {text('新建场景', 'New Location')}
              </button>
              {project.projectId && (
                <button
                  onClick={() => { loadPickerProject().then(sp => { if (sp) setShowSceneLibraryPicker(true); }); }}
                  disabled={!!batchProgress}
                  className={STYLES.secondaryButton}
                >
                  <Link2 className="w-3 h-3" />
                  {text('从场景库添加', 'Add from Locations')}
                </button>
              )}
              <button 
                onClick={() => openLibrary('scene')}
                disabled={!!batchProgress}
                className={STYLES.secondaryButton}
              >
                <Archive className="w-3 h-3" />
                {text('从资产库选择', 'Choose Asset')}
              </button>
              <button 
                onClick={() => handleBatchGenerate('scene')}
                disabled={!!batchProgress}
                className={allScenesReady ? STYLES.secondaryButton : STYLES.primaryButton}
              >
                {allScenesReady ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                {allScenesReady ? text('重新生成所有场景', 'Regenerate All') : text('一键生成所有场景', 'Generate All')}
              </button>
            </div>
          </div>

          <div className={GRID_LAYOUTS.compactCards}>
            {project.scriptData.scenes.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                isGenerating={scene.status === 'generating'}
                shapeReferenceImage={scene.shapeReferenceImage}
                onGenerate={() => handleGenerateAsset('scene', scene.id)}
                onUpload={(file) => handleUploadSceneImage(scene.id, file)}
                onUploadShapeReference={(file) => handleUploadShapeReferenceImage('scene', scene.id, file)}
                onClearShapeReference={() => handleClearShapeReferenceImage('scene', scene.id)}
                onPromptSave={(newPrompt) => handleSaveScenePrompt(scene.id, newPrompt)}
                onRegeneratePrompt={() => handleRegenerateAssetPrompt('scene', scene.id)}
                isRegeneratingPrompt={regeneratingPromptIds.has(`scene:${scene.id}`)}
                onImageClick={openImagePreview}
                onDelete={() => handleDeleteScene(scene.id)}
                onUpdateInfo={(updates) => handleUpdateSceneInfo(scene.id, updates)}
                onAddToLibrary={() => handleAddSceneToLibrary(scene)}
              />
            ))}
          </div>
        </section>

        {/* Props Section */}
        <section>
          <div className="flex items-end justify-between mb-6 border-b border-[var(--border-primary)] pb-4">
            <div>
              <h3 className="text-sm font-bold text-[var(--text-primary)] uppercase tracking-widest flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
                <BilingualLabel primary="道具库" secondary="PROPS" />
              </h3>
              <p className="text-xs text-[var(--text-tertiary)] mt-1 pl-3.5">{text('管理分镜中需要保持一致性的道具/物品', 'Manage props and objects that must stay consistent across shots.')}</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={handleAddProp}
                disabled={!!batchProgress}
                className="px-3 py-1.5 bg-[var(--bg-hover)] hover:bg-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <Package className="w-3 h-3" />
                {text('新建道具', 'New Prop')}
              </button>
              {project.projectId && (
                <button
                  onClick={() => { loadPickerProject().then(sp => { if (sp) setShowPropLibraryPicker(true); }); }}
                  disabled={!!batchProgress}
                  className={STYLES.secondaryButton}
                >
                  <Link2 className="w-3 h-3" />
                  {text('从道具库添加', 'Add from Props')}
                </button>
              )}
              <button 
                onClick={() => openLibrary('prop')}
                disabled={!!batchProgress}
                className={STYLES.secondaryButton}
              >
                <Archive className="w-3 h-3" />
                {text('从资产库选择', 'Choose Asset')}
              </button>
              {visibleProps.length > 0 && (
                <button 
                  onClick={handleBatchGenerateProps}
                  disabled={!!batchProgress}
                  className={allPropsReady ? STYLES.secondaryButton : STYLES.primaryButton}
                >
                  {allPropsReady ? <RefreshCw className="w-3 h-3" /> : <Sparkles className="w-3 h-3" />}
                  {allPropsReady ? text('重新生成所有道具', 'Regenerate All') : text('一键生成所有道具', 'Generate All')}
                </button>
              )}
            </div>
          </div>

          {visibleProps.length === 0 ? (
            <div className="border border-dashed border-[var(--border-primary)] rounded-xl p-10 text-center text-[var(--text-muted)] text-sm">
              {text('暂无道具。点击“新建道具”添加需要在多个分镜中保持一致的物品。', 'No props yet. Add objects that need to remain consistent across multiple shots.')}
            </div>
          ) : (
            <div className={GRID_LAYOUTS.compactCards}>
              {visibleProps.map((prop) => (
                <PropCard
                  key={prop.id}
                  prop={prop}
                  isGenerating={prop.status === 'generating'}
                  shapeReferenceImage={prop.shapeReferenceImage}
                  onGenerate={() => handleGeneratePropAsset(prop.id)}
                  onUpload={(file) => handleUploadPropImage(prop.id, file)}
                  onUploadShapeReference={(file) => handleUploadShapeReferenceImage('prop', prop.id, file)}
                  onClearShapeReference={() => handleClearShapeReferenceImage('prop', prop.id)}
                  onPromptSave={(newPrompt) => handleSavePropPrompt(prop.id, newPrompt)}
                  onRegeneratePrompt={() => handleRegenerateAssetPrompt('prop', prop.id)}
                  isRegeneratingPrompt={regeneratingPromptIds.has(`prop:${prop.id}`)}
                onImageClick={openImagePreview}
                  onDelete={() => handleDeleteProp(prop.id)}
                  onUpdateInfo={(updates) => handleUpdatePropInfo(prop.id, updates)}
                  onAddToLibrary={() => handleAddPropToLibrary(prop)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Character Library Picker */}
      {showCharLibraryPicker && (
        <CharacterLibraryPickerModal
          isOpen={showCharLibraryPicker}
          onClose={() => setShowCharLibraryPicker(false)}
          project={pickerProject}
          existingCharacterIds={(project.scriptData?.characters || []).filter(c => c.libraryId).map(c => c.libraryId!)}
          onSelect={(libChar) => {
            appendLinkedLibraryAsset({
              asset: {
                ...libChar,
                variations: libChar.variations?.map(v => ({ ...v })) || [],
              },
              idPrefix: 'char',
              field: 'characters',
              refField: 'characterRefs',
              upsertRef: upsertCharacterRef,
              onDone: () => setShowCharLibraryPicker(false),
            });
          }}
        />
      )}

      {/* Scene Library Picker */}
      {showSceneLibraryPicker && (
        <ProjectAssetPicker
          isOpen={showSceneLibraryPicker}
          onClose={() => setShowSceneLibraryPicker(false)}
          project={pickerProject}
          assetType="scene"
          existingIds={(project.scriptData?.scenes || []).filter(s => !!s.libraryId).map(s => s.libraryId!)}
          onSelectScene={(libScene) => {
            appendLinkedLibraryAsset({
              asset: libScene,
              idPrefix: 'scene',
              field: 'scenes',
              refField: 'sceneRefs',
              upsertRef: upsertSceneRef,
              onDone: () => setShowSceneLibraryPicker(false),
            });
          }}
        />
      )}

      {/* Prop Library Picker */}
      {showPropLibraryPicker && (
        <ProjectAssetPicker
          isOpen={showPropLibraryPicker}
          onClose={() => setShowPropLibraryPicker(false)}
          project={pickerProject}
          assetType="prop"
          existingIds={(project.scriptData?.props || []).filter(p => !!p.libraryId).map(p => p.libraryId!)}
          onSelectProp={(libProp) => {
            appendLinkedLibraryAsset({
              asset: libProp,
              idPrefix: 'prop',
              field: 'props',
              refField: 'propRefs',
              upsertRef: upsertPropRef,
              onDone: () => setShowPropLibraryPicker(false),
            });
          }}
        />
      )}
    </div>
  );
};

export default StageAssets;
