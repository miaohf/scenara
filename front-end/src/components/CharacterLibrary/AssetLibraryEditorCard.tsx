import React, { useEffect, useMemo, useState } from 'react';
import { Users, MapPin, Package, Upload, Trash2, RotateCcw, Save, Link2 } from 'lucide-react';
import { Character, Scene, Prop } from '../../types';

export type LibraryAssetType = 'character' | 'scene' | 'prop';
export type LibraryAsset = Character | Scene | Prop;

interface AssetLibraryEditorCardProps {
  type: LibraryAssetType;
  asset: LibraryAsset;
  refCount: number;
  onSave: (nextAsset: LibraryAsset) => void;
  onDelete: () => void;
  onUploadImage: (file: File) => void;
  onPreviewImage: (imageUrl: string) => void;
}

const EDITABLE_FIELDS: Record<LibraryAssetType, string[]> = {
  character: ['name', 'gender', 'age', 'personality', 'coreFeatures', 'visualPrompt'],
  scene: ['location', 'time', 'atmosphere', 'visualPrompt'],
  prop: ['name', 'category', 'description', 'visualPrompt'],
};

const getAssetTitle = (type: LibraryAssetType, asset: LibraryAsset): string => {
  if (type === 'character') return (asset as Character).name;
  if (type === 'scene') return (asset as Scene).location;
  return (asset as Prop).name;
};

const getAssetSubtitle = (type: LibraryAssetType, asset: LibraryAsset): string => {
  if (type === 'character') {
    const character = asset as Character;
    return `${character.gender || '-'} · ${character.age || '-'}`;
  }
  if (type === 'scene') {
    const scene = asset as Scene;
    return `${scene.time || '-'} · ${scene.atmosphere || '-'}`;
  }
  return (asset as Prop).category || '-';
};

const getAssetIcon = (type: LibraryAssetType) => {
  if (type === 'character') return Users;
  if (type === 'scene') return MapPin;
  return Package;
};

const getTypeLabel = (type: LibraryAssetType): string => {
  if (type === 'character') return '角色';
  if (type === 'scene') return '场景';
  return '道具';
};

const AssetLibraryEditorCard: React.FC<AssetLibraryEditorCardProps> = ({
  type,
  asset,
  refCount,
  onSave,
  onDelete,
  onUploadImage,
  onPreviewImage,
}) => {
  const [draft, setDraft] = useState<LibraryAsset>(asset);
  const AssetIcon = getAssetIcon(type);

  useEffect(() => {
    setDraft(asset);
  }, [asset]);

  const hasChanges = useMemo(() => {
    const fields = EDITABLE_FIELDS[type];
    return fields.some((field) => {
      const oldValue = ((asset as any)[field] ?? '').toString();
      const newValue = ((draft as any)[field] ?? '').toString();
      return oldValue !== newValue;
    });
  }, [type, asset, draft]);

  const updateField = (field: string, value: string) => {
    setDraft((prev) => ({ ...(prev as any), [field]: value } as LibraryAsset));
  };

  const getValue = (field: string): string => ((draft as any)[field] ?? '').toString();
  const previewImage = (draft as any).referenceImage as string | undefined;
  const version = (draft as any).version || 1;

  return (
    <div className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl overflow-hidden hover:border-[var(--border-secondary)] transition-colors">
      <div className="aspect-video bg-[var(--bg-elevated)] relative">
        {previewImage ? (
          <img
            src={previewImage}
            alt={getAssetTitle(type, draft)}
            className="w-full h-full object-cover cursor-pointer"
            onClick={() => onPreviewImage(previewImage)}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-muted)]">
            <AssetIcon className="w-9 h-9 opacity-30 mb-2" />
            <span className="text-[10px] font-mono uppercase tracking-widest">{getTypeLabel(type)}</span>
          </div>
        )}
        <div className="absolute left-2 top-2 px-2 py-0.5 text-[9px] font-mono rounded bg-[var(--accent-bg)] text-[var(--accent-text)] uppercase tracking-widest">
          v{version}
        </div>
        {refCount > 0 && (
          <div className="absolute right-2 top-2 px-2 py-0.5 text-[9px] font-mono rounded bg-[var(--bg-base)]/80 text-[var(--text-tertiary)] flex items-center gap-1">
            <Link2 className="w-3 h-3" />
            {refCount} 集引用
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        <div>
          <div className="text-sm font-bold text-[var(--text-primary)] line-clamp-1">
            {getAssetTitle(type, draft)}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] font-mono mt-1 line-clamp-1">
            {getAssetSubtitle(type, draft)}
          </div>
        </div>

        {type === 'character' && (
          <>
            <input
              value={getValue('name')}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="角色名称"
              className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)]"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={getValue('gender')}
                onChange={(e) => updateField('gender', e.target.value)}
                placeholder="性别"
                className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)]"
              />
              <input
                value={getValue('age')}
                onChange={(e) => updateField('age', e.target.value)}
                placeholder="年龄"
                className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)]"
              />
            </div>
            <textarea
              value={getValue('personality')}
              onChange={(e) => updateField('personality', e.target.value)}
              rows={2}
              placeholder="性格描述"
              className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)] resize-none"
            />
            <textarea
              value={getValue('coreFeatures')}
              onChange={(e) => updateField('coreFeatures', e.target.value)}
              rows={2}
              placeholder="核心外观特征（可选）"
              className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)] resize-none"
            />
          </>
        )}

        {type === 'scene' && (
          <>
            <input
              value={getValue('location')}
              onChange={(e) => updateField('location', e.target.value)}
              placeholder="场景地点"
              className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)]"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                value={getValue('time')}
                onChange={(e) => updateField('time', e.target.value)}
                placeholder="时间"
                className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)]"
              />
              <input
                value={getValue('atmosphere')}
                onChange={(e) => updateField('atmosphere', e.target.value)}
                placeholder="氛围"
                className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)]"
              />
            </div>
          </>
        )}

        {type === 'prop' && (
          <>
            <input
              value={getValue('name')}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder="道具名称"
              className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)]"
            />
            <input
              value={getValue('category')}
              onChange={(e) => updateField('category', e.target.value)}
              placeholder="道具分类"
              className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)]"
            />
            <textarea
              value={getValue('description')}
              onChange={(e) => updateField('description', e.target.value)}
              rows={2}
              placeholder="道具描述"
              className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)] resize-none"
            />
          </>
        )}

        <textarea
          value={getValue('visualPrompt')}
          onChange={(e) => updateField('visualPrompt', e.target.value)}
          rows={4}
          placeholder="视觉提示词"
          className="w-full px-3 py-2 bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-secondary)] resize-y"
        />

        <div className="flex gap-2">
          <label className="flex-1 py-2 border border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)] rounded text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-2 cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5" />
            上传图片
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onUploadImage(file);
                e.currentTarget.value = '';
              }}
            />
          </label>
          <button
            onClick={() => setDraft(asset)}
            disabled={!hasChanges}
            className="px-3 py-2 border border-[var(--border-primary)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:border-[var(--border-secondary)] rounded disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title="重置"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onSave(draft)}
            disabled={!hasChanges}
            className="flex-1 py-2 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] rounded text-[10px] font-bold uppercase tracking-widest flex items-center justify-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            保存修改
          </button>
          <button
            onClick={onDelete}
            className="px-3 py-2 border border-[var(--error-border)] text-[var(--error-text)] hover:bg-[var(--error-bg)] rounded transition-colors"
            title="删除"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AssetLibraryEditorCard;
