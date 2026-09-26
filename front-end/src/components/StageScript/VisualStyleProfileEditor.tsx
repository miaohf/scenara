import React, { useEffect, useMemo, useState } from 'react';
import { Edit3, ImagePlus, RefreshCw, Save, Trash2, Upload, X } from 'lucide-react';
import type { VisualStyleProfile } from '../../types';
import { STYLES } from './constants';
import { resolveVisualStyleProfile } from '../../services/visualStyleProfileService';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface Props {
  styleKey: string;
  customPrompt: string;
  profiles: VisualStyleProfile[];
  isGenerating?: boolean;
  onSave: (profile: VisualStyleProfile) => void;
  onGeneratePreview: (profile: VisualStyleProfile) => void;
  onDelete?: (profile: VisualStyleProfile) => void;
  onInferFromImage?: (file: File) => Promise<{ stylePrompt: string; negativePrompt?: string; styleLabel?: string; previewImage: string }>;
  compact?: boolean;
  createRequest?: number;
}

const VisualStyleProfileEditor: React.FC<Props> = ({
  styleKey,
  customPrompt,
  profiles,
  isGenerating = false,
  onSave,
  onGeneratePreview,
  onDelete,
  onInferFromImage,
  compact = false,
  createRequest = 0,
}) => {
  const { text } = useInterfaceLanguage();
  const base = useMemo(() => resolveVisualStyleProfile(styleKey, profiles, customPrompt), [styleKey, profiles, customPrompt]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(base);

  const isPreset = styleKey !== 'custom' && !styleKey.startsWith('custom:');
  const savedProfile = profiles.find((profile) => profile.styleKey === styleKey && !profile.deleted);
  const [isInferring, setIsInferring] = useState(false);
  const [creating, setCreating] = useState(false);
  const buildDraftProfile = (): VisualStyleProfile => {
    const now = Date.now();
    const nextId = draft.id.includes(':') ? `style_${now.toString(36)}` : draft.id;
    const effectiveStyleKey = creating ? 'custom' : styleKey;
    return {
      ...draft,
      id: nextId,
      styleKey: effectiveStyleKey === 'custom' ? `custom:${nextId}` : effectiveStyleKey,
      source: effectiveStyleKey === 'custom' ? 'custom' : 'preset-override',
      createdAt: draft.createdAt || now,
      updatedAt: now,
    };
  };

  const saveDraft = () => {
    onSave(buildDraftProfile());
    setEditing(false);
    setCreating(false);
  };

  const generateDraftPreview = () => {
    const profile = buildDraftProfile();
    onSave(profile);
    onGeneratePreview(profile);
  };

  const startCreating = () => {
    const now = Date.now();
    setDraft({
      id: `new:${now.toString(36)}`,
      styleKey: 'custom',
      label: '新视觉风格',
      positivePrompt: '',
      negativePrompt: '',
      source: 'custom',
      createdAt: now,
      updatedAt: now,
    });
    setCreating(true);
    setEditing(true);
  };

  useEffect(() => {
    if (createRequest > 0) startCreating();
  }, [createRequest]);

  const inferFromImageFile = async (file: File) => {
    if (!onInferFromImage || !file.type.startsWith('image/')) return;
    setIsInferring(true);
    try {
      const result = await onInferFromImage(file);
      setDraft((current) => ({
        ...current,
        label: result.styleLabel || current.label,
        positivePrompt: result.stylePrompt,
        negativePrompt: result.negativePrompt || current.negativePrompt,
        previewImage: result.previewImage,
      }));
    } finally {
      setIsInferring(false);
    }
  };

  const handlePasteImage = async (event: React.ClipboardEvent<HTMLDivElement>) => {
    if (!onInferFromImage) return;
    const imageItem = Array.from(event.clipboardData.items).find((item) => item.type.startsWith('image/'));
    const file = imageItem?.getAsFile();
    if (!file) return;
    event.preventDefault();
    await inferFromImageFile(file);
  };

  return (
    <div className={compact ? 'space-y-2' : 'space-y-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/30 p-3'}>
      <div className="flex items-center justify-between gap-2">
        <div />
        <div className="flex shrink-0 gap-1">
          <button type="button" aria-label={text('生成预览', 'Generate preview')} title={text('生成预览', 'Generate preview')} disabled={isGenerating} onClick={() => onGeneratePreview(base)} className="rounded border border-[var(--border-secondary)] p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50">
            {isGenerating ? <RefreshCw className="h-3 w-3 animate-spin" /> : <ImagePlus className="h-3 w-3" />}
          </button>
          <button type="button" aria-label={text('编辑', 'Edit')} title={text('编辑', 'Edit')} onClick={() => { setDraft(base); setEditing(true); }} className="rounded border border-[var(--border-secondary)] p-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
            <Edit3 className="h-3 w-3" />
          </button>
          {savedProfile && onDelete && <button type="button" aria-label={text('删除', 'Delete')} title={text('删除', 'Delete')} onClick={() => onDelete(savedProfile)} className="rounded border border-red-900/60 p-1.5 text-red-300 hover:border-red-500"><Trash2 className="h-3 w-3" /></button>}
        </div>
      </div>
      {!compact && base.previewImage && !editing && <img src={base.previewImage} alt={`${base.label} 风格预览`} className="max-h-36 w-full rounded border border-[var(--border-primary)] object-cover" />}
      {!editing && !compact ? (
        <>
          <p className="line-clamp-3 whitespace-pre-wrap text-[10px] leading-relaxed text-[var(--text-secondary)]">{base.positivePrompt}</p>
          <p className="line-clamp-2 whitespace-pre-wrap text-[9px] leading-relaxed text-[var(--text-muted)]">负面：{base.negativePrompt}</p>
        </>
      ) : null}
      {!compact && (isPreset ? <p className="text-[9px] text-[var(--text-muted)]">{text('预设原始配置保留不变；保存后会更新共享覆盖。', 'Built-in preset settings stay unchanged; saving updates the shared override.')}</p> : <p className="text-[9px] text-[var(--text-muted)]">{text('可新增、编辑或删除所有项目共用的视觉风格。', 'Create, edit, or delete visual styles shared by all projects.')}</p>)}
      {editing && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(false); }} onPaste={handlePasteImage}>
          <div className="w-full max-w-xl space-y-3 rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-primary)] p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-[var(--text-primary)]">{creating ? text('新增视觉风格', 'Add Visual Style') : text('编辑视觉风格', 'Edit Visual Style')}</h3>
                {onInferFromImage && <p className="mt-1 text-[10px] text-[var(--text-muted)]">{text('可上传图片，或直接粘贴剪贴板中的图片反推风格', 'Upload an image or paste one from the clipboard to infer the style')}</p>}
              </div>
              <button type="button" onClick={() => setEditing(false)} className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)]"><X className="h-4 w-4" /></button>
            </div>
            <input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className={STYLES.input} placeholder={text('风格名称', 'Style name')} />
            <label className={STYLES.label}>{text('正向提示词', 'Positive Prompt')}</label>
            <textarea value={draft.positivePrompt} onChange={(e) => setDraft({ ...draft, positivePrompt: e.target.value })} className={`${STYLES.input} min-h-[130px] resize-y font-mono text-xs`} placeholder={text('正向风格提示词', 'Positive style prompt')} />
            <label className={STYLES.label}>{text('负面提示词', 'Negative Prompt')}</label>
            <textarea value={draft.negativePrompt} onChange={(e) => setDraft({ ...draft, negativePrompt: e.target.value })} className={`${STYLES.input} min-h-[90px] resize-y font-mono text-xs`} placeholder={text('负面提示词', 'Negative prompt')} />
            {onInferFromImage && (
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-[var(--border-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <Upload className="h-3.5 w-3.5" />
                {isInferring ? text('正在反推风格…', 'Inferring style…') : text('上传预览图反推提示词', 'Upload preview to infer prompt')}
                <input type="file" accept="image/*" className="hidden" disabled={isInferring} onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  await inferFromImageFile(file);
                }} />
              </label>
            )}
            <div className="flex justify-end gap-2 border-t border-[var(--border-primary)] pt-3">
              <button type="button" onClick={() => setEditing(false)} className="rounded px-3 py-2 text-xs text-[var(--text-muted)]"><X className="mr-1 inline h-3 w-3" />{text('取消', 'Cancel')}</button>
              <button type="button" disabled={isGenerating || !draft.positivePrompt.trim()} onClick={generateDraftPreview} className="rounded border border-[var(--border-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)] disabled:opacity-50"><ImagePlus className="mr-1 inline h-3 w-3" />{text('生成预览', 'Generate Preview')}</button>
              <button type="button" onClick={saveDraft} className="rounded border border-[var(--accent-border)] bg-[var(--accent)] px-3 py-2 text-xs font-semibold text-[var(--accent-text)] shadow-sm transition-colors hover:bg-[var(--accent-hover)]"><Save className="mr-1 inline h-3 w-3" />{text('确定', 'Confirm')}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VisualStyleProfileEditor;
