import React from 'react';
import { Package, Check, Loader2, Trash2, Edit2, AlertCircle, FolderPlus, Upload, X } from 'lucide-react';
import { Prop, PropPresentationMode } from '../../types';
import { PROP_CATEGORIES } from './constants';
import PromptEditor from './PromptEditor';
import ImageUploadButton from './ImageUploadButton';
import InlineEditableText from './InlineEditableText';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface PropCardProps {
  prop: Prop;
  isGenerating: boolean;
  shapeReferenceImage?: string;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onUploadShapeReference: (file: File) => void;
  onClearShapeReference: () => void;
  onPromptSave: (newPrompt: string) => void;
  onRegeneratePrompt?: () => void;
  isRegeneratingPrompt?: boolean;
  onImageClick: (imageUrl: string) => void;
  onDelete: () => void;
  onUpdateInfo: (updates: {
    name?: string;
    category?: string;
    description?: string;
    presentationMode?: PropPresentationMode;
    presentationNote?: string;
  }) => void;
  onAddToLibrary: () => void;
}

const PropCard: React.FC<PropCardProps> = ({
  prop,
  isGenerating,
  shapeReferenceImage,
  onGenerate,
  onUpload,
  onUploadShapeReference,
  onClearShapeReference,
  onPromptSave,
  onRegeneratePrompt,
  isRegeneratingPrompt = false,
  onImageClick,
  onDelete,
  onUpdateInfo,
  onAddToLibrary,
}) => {
  const { text } = useInterfaceLanguage();
  const handleShapeReferenceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onUploadShapeReference(file);
    e.target.value = '';
  };

  return (
    <div className="bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl overflow-hidden flex flex-col group hover:border-[var(--border-secondary)] transition-all hover:shadow-lg">
      <div
        className="aspect-video bg-[var(--bg-elevated)] relative cursor-pointer"
        onClick={() => prop.referenceImage && onImageClick(prop.referenceImage)}
      >
        {prop.referenceImage ? (
          <>
            <img src={prop.referenceImage} alt={prop.name} className="w-full h-full object-cover" />
            <div className="absolute top-2 right-2 p-1 bg-[var(--accent)] text-[var(--text-primary)] rounded shadow-lg backdrop-blur">
              <Check className="w-3 h-3" />
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-muted)] p-4 text-center">
            {isGenerating ? (
              <>
                <Loader2 className="w-10 h-10 mb-3 animate-spin text-[var(--accent)]" />
                <span className="text-[10px] text-[var(--text-tertiary)]">{text('生成中...', 'Generating...')}</span>
              </>
            ) : prop.status === 'failed' ? (
              <>
                <AlertCircle className="w-10 h-10 mb-3 text-[var(--error)]" />
                <span className="text-[10px] text-[var(--error)] mb-2">{text('生成失败', 'Generation failed')}</span>
                <ImageUploadButton
                  variant="inline"
                  size="small"
                  onUpload={onUpload}
                  onGenerate={onGenerate}
                  isGenerating={isGenerating}
                  uploadLabel={text('上传', 'Upload')}
                  generateLabel={text('重试', 'Retry')}
                />
              </>
            ) : (
              <>
                <Package className="w-10 h-10 mb-3 opacity-10" />
                <ImageUploadButton
                  variant="inline"
                  size="medium"
                  onUpload={onUpload}
                  onGenerate={onGenerate}
                  isGenerating={isGenerating}
                  uploadLabel={text('上传', 'Upload')}
                  generateLabel={text('生成', 'Generate')}
                />
              </>
            )}
          </div>
        )}
      </div>

      <div className="p-3 border-t border-[var(--border-primary)] bg-[var(--bg-base)]">
        <div className="flex justify-between items-center mb-1 gap-2">
          <InlineEditableText
            value={prop.name}
            onSave={(next) => onUpdateInfo({ name: next })}
            inputClassName="font-bold text-[var(--text-secondary)] text-sm bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-2 py-1 flex-1 min-w-0 focus:outline-none focus:border-[var(--accent)]"
            renderDisplay={(value, startEdit) => (
              <div className="flex items-center gap-2 flex-1 min-w-0 group/name">
                <h3 className="font-bold text-[var(--text-secondary)] text-sm truncate" title={value}>
                  {value}
                </h3>
                <button
                  onClick={startEdit}
                  className="opacity-0 group-hover/name:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-opacity flex-shrink-0"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}
          />
          <select
            value={prop.category}
            onChange={(e) => onUpdateInfo({ category: e.target.value })}
            className="px-1.5 py-0.5 bg-[var(--bg-elevated)] text-[var(--text-tertiary)] text-[9px] rounded border border-[var(--border-primary)] font-mono cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors shrink-0 focus:outline-none"
          >
            {PROP_CATEGORIES.map((cat) => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2 mb-2">
          <span className="text-[9px] font-mono text-[var(--text-muted)] uppercase tracking-wider shrink-0">
            {text('呈现方式', 'Presentation')}
          </span>
          <select
            value={prop.presentationMode || 'unknown'}
            onChange={(e) => onUpdateInfo({ presentationMode: e.target.value as PropPresentationMode })}
            className="min-w-0 flex-1 px-1.5 py-1 bg-[var(--bg-elevated)] text-[var(--text-tertiary)] text-[9px] rounded border border-[var(--border-primary)] cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors focus:outline-none"
            title={text('只在镜头中需要时作为提示词约束使用', 'Used as a prompt constraint only when relevant in a shot')}
          >
            <option value="unknown">{text('未指定', 'Unspecified')}</option>
            <option value="handheld">{text('手提/手持', 'Handheld')}</option>
            <option value="worn">{text('穿戴/背负', 'Worn')}</option>
            <option value="placed">{text('放置', 'Placed')}</option>
            <option value="mounted">{text('安装/悬挂', 'Mounted')}</option>
            <option value="used">{text('使用中', 'In use')}</option>
            <option value="background">{text('背景出现', 'Background')}</option>
          </select>
        </div>

        <InlineEditableText
          value={prop.presentationNote || ''}
          onSave={(next) => onUpdateInfo({ presentationNote: next })}
          required={false}
          multiline={false}
          inputClassName="text-[10px] text-[var(--text-secondary)] w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-2 py-1 mb-2 focus:outline-none focus:border-[var(--accent)]"
          renderDisplay={(value, startEdit) => (
            <p
              onClick={startEdit}
              className="text-[9px] text-[var(--text-muted)] line-clamp-1 mb-2 cursor-pointer hover:text-[var(--text-secondary)] transition-colors"
              title={text('可选：补充短的使用或位置事实，例如“两个短提手，不使用肩带”', 'Optional: add a short handling or position fact, e.g. “two short handles; no shoulder strap”')}
            >
              {value || text('点击添加使用/位置说明（可选）...', 'Click to add handling/position note (optional)...')}
            </p>
          )}
        />

        <InlineEditableText
          value={prop.description || ''}
          onSave={(next) => onUpdateInfo({ description: next })}
          required={false}
          multiline={true}
          rows={2}
          inputClassName="text-[10px] text-[var(--text-secondary)] w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-2 py-1 mb-3 focus:outline-none focus:border-[var(--accent)] resize-none"
          renderDisplay={(value, startEdit) => (
            <p
              onClick={startEdit}
              className="text-[10px] text-[var(--text-tertiary)] line-clamp-2 mb-3 cursor-pointer hover:text-[var(--text-secondary)] transition-colors min-h-[28px]"
            >
              {value || text('点击添加道具描述...', 'Click to add a prop description...')}
            </p>
          )}
        />

        <div className="mt-3 pt-3 border-t border-[var(--border-primary)]">
          <PromptEditor
            prompt={prop.visualPrompt || ''}
            onSave={onPromptSave}
            onRegenerate={onRegeneratePrompt}
            isRegenerating={isRegeneratingPrompt}
            label={text('道具提示词', 'Prop Prompt')}
            placeholder={text('输入道具的视觉描述...', 'Describe the prop visually...')}
            maxHeight="max-h-[160px]"
          />
        </div>

        {prop.referenceImage && (
          <div className="mt-3 pt-3 border-t border-[var(--border-primary)]">
            <ImageUploadButton
              variant="separate"
              hasImage={true}
              onUpload={onUpload}
              onGenerate={onGenerate}
              isGenerating={isGenerating}
              uploadLabel={text('上传图片', 'Upload Image')}
            />
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-[var(--border-primary)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">{text('道具参考图', 'PROP REFERENCE')}</span>
            {shapeReferenceImage && (
              <button
                onClick={onClearShapeReference}
                disabled={isGenerating}
                className="text-[9px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30"
                title={text('清除道具参考图', 'Clear prop reference')}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="px-2 py-1 bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer flex items-center gap-1">
              <Upload className="w-3 h-3" />
              {text('上传道具参考图', 'Upload Reference')}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleShapeReferenceChange}
              />
            </label>
            <span className="text-[9px] text-[var(--text-muted)]">{text('仅参考道具外形，风格遵循剧本', 'Uses shape only; style follows the script')}</span>
          </div>
          {shapeReferenceImage && (
            <button
              onClick={() => onImageClick(shapeReferenceImage)}
              className="mt-2 w-full flex items-center gap-2 p-2 rounded border border-[var(--border-primary)] hover:border-[var(--border-secondary)] transition-colors text-left"
            >
              <img src={shapeReferenceImage} alt={text('道具参考图', 'Prop reference')} className="w-10 h-10 rounded object-cover" />
              <span className="text-[10px] text-[var(--text-secondary)]">{text('已设置道具参考图，下次生成将生效', 'Reference set; it will apply to the next generation')}</span>
            </button>
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-[var(--border-primary)] flex gap-2">
          <button
            onClick={onAddToLibrary}
            disabled={isGenerating}
            className="flex-1 py-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-primary)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <FolderPlus className="w-3 h-3" />
            {text('加入资产库', 'Add to Library')}
          </button>
          <button
            onClick={onDelete}
            disabled={isGenerating}
            className="flex-1 py-2 bg-transparent hover:bg-[var(--error-bg)] text-[var(--error-text)] hover:text-[var(--error-text)] border border-[var(--error-border)] hover:border-[var(--error-border)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3 h-3" />
            {text('删除道具', 'Delete Prop')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default PropCard;
