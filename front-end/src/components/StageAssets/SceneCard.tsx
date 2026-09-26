import React from 'react';
import { MapPin, Loader2, Trash2, Edit2, AlertCircle, FolderPlus, Upload, X } from 'lucide-react';
import PromptEditor from './PromptEditor';
import ImageUploadButton from './ImageUploadButton';
import InlineEditableText from './InlineEditableText';
import AssetIntelligenceEditor from './AssetIntelligenceEditor';
import type { AssetDNA, SceneSpatialTopology } from '../../types';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';
import AssetImageHistoryStrip from './AssetImageHistoryStrip';
import { getAssetImageHistory } from '../../services/assetImageHistory';

interface SceneCardProps {
  scene: {
    id: string;
    location: string;
    time: string;
    atmosphere: string;
    visualPrompt?: string;
    referenceImage?: string;
    imageHistory?: import('../../types').AssetImageHistoryEntry[];
    status?: 'pending' | 'generating' | 'completed' | 'failed';
    assetDNA?: AssetDNA;
    spatialTopology?: SceneSpatialTopology;
  };
  isGenerating: boolean;
  shapeReferenceImage?: string;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onUploadShapeReference: (file: File) => void;
  onClearShapeReference: () => void;
  onPromptSave: (newPrompt: string) => void;
  onRegeneratePrompt?: () => void;
  isRegeneratingPrompt?: boolean;
  onImageClick: (imageUrl: string, imageUrls?: string[], onDelete?: (imageUrl: string) => void, onApply?: (imageUrl: string) => void) => void;
  onApplyHistory: (imageUrl: string) => void;
  onDeleteHistory: (imageUrl: string) => void;
  onDelete: () => void;
  onUpdateInfo: (updates: { location?: string; time?: string; atmosphere?: string }) => void;
  onAddToLibrary: () => void;
  onSaveAssetDNA: (assetDNA: AssetDNA) => void;
  onSaveSpatialTopology: (spatialTopology: SceneSpatialTopology) => void;
}

const SceneCard: React.FC<SceneCardProps> = ({
  scene,
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
  onApplyHistory,
  onDeleteHistory,
  onDelete,
  onUpdateInfo,
  onAddToLibrary,
  onSaveAssetDNA,
  onSaveSpatialTopology,
}) => {
  const { text } = useInterfaceLanguage();
  const imageHistory = getAssetImageHistory(scene as any);
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
        onClick={() => {
          if (isGenerating || !scene.referenceImage) return;
          onImageClick(scene.referenceImage, imageHistory.map((item) => item.imageUrl), onDeleteHistory);
        }}
      >
        {scene.referenceImage ? (
          <>
            <img src={scene.referenceImage} alt={scene.location} className="w-full h-full object-cover" />
            {isGenerating && (
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--bg-base)]/35 backdrop-blur-[1px]">
                <Loader2 className="h-9 w-9 animate-spin text-[var(--accent-text)] drop-shadow" />
              </div>
            )}
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-muted)] p-4 text-center">
            {isGenerating ? (
              <>
                <Loader2 className="w-10 h-10 mb-3 animate-spin text-[var(--accent)]" />
                <span className="text-[10px] text-[var(--text-tertiary)]">{text('生成中...', 'Generating...')}</span>
              </>
            ) : scene.status === 'failed' ? (
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
                <MapPin className="w-10 h-10 mb-3 opacity-10" />
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
            value={scene.location}
            onSave={(next) => onUpdateInfo({ location: next })}
            inputClassName="font-bold text-[var(--text-secondary)] text-sm bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-2 py-1 flex-1 min-w-0 focus:outline-none focus:border-[var(--accent)]"
            renderDisplay={(value, startEdit) => (
              <div className="flex items-center gap-2 flex-1 min-w-0 group/location">
                <h3 className="font-bold text-[var(--text-secondary)] text-sm truncate" title={value}>{value}</h3>
                <button
                  onClick={startEdit}
                  className="opacity-0 group-hover/location:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-opacity flex-shrink-0"
                >
                  <Edit2 className="w-3 h-3" />
                </button>
              </div>
            )}
          />
          <InlineEditableText
            value={scene.time}
            onSave={(next) => onUpdateInfo({ time: next })}
            inputClassName="px-1.5 py-0.5 bg-[var(--bg-hover)] border border-[var(--border-secondary)] text-[var(--text-secondary)] text-[9px] rounded uppercase font-mono focus:outline-none focus:border-[var(--accent)] w-24 shrink-0"
            renderDisplay={(value, startEdit) => (
              <span
                onClick={startEdit}
                className="px-1.5 py-0.5 bg-[var(--bg-elevated)] text-[var(--text-tertiary)] text-[9px] rounded border border-[var(--border-primary)] uppercase font-mono cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors shrink-0 whitespace-nowrap overflow-hidden max-w-[80px] text-center"
                title={value}
              >
                {value}
              </span>
            )}
          />
        </div>
        <InlineEditableText
          value={scene.atmosphere}
          onSave={(next) => onUpdateInfo({ atmosphere: next })}
          inputClassName="text-[10px] text-[var(--text-secondary)] w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-2 py-1 mb-3 focus:outline-none focus:border-[var(--accent)]"
          renderDisplay={(value, startEdit) => (
            <p
              onClick={startEdit}
              className="text-[10px] text-[var(--text-tertiary)] line-clamp-1 mb-3 cursor-pointer hover:text-[var(--text-secondary)] transition-colors"
            >
              {value}
            </p>
          )}
        />

        {/* Scene Prompt Section */}
        <div className="mt-3 pt-3 border-t border-[var(--border-primary)]">
          <PromptEditor
            prompt={scene.visualPrompt || ''}
            onSave={onPromptSave}
            onRegenerate={onRegeneratePrompt}
            isRegenerating={isRegeneratingPrompt}
            label={text('场景提示词', 'Scene Prompt')}
            placeholder={text('输入场景视觉描述...', 'Describe the location visually...')}
            maxHeight="max-h-[160px]"
          />
        </div>

        <AssetIntelligenceEditor
          key={JSON.stringify({ assetDNA: scene.assetDNA || {}, spatialTopology: scene.spatialTopology || {} })}
          assetDNA={scene.assetDNA}
          spatialTopology={scene.spatialTopology}
          onSaveAssetDNA={onSaveAssetDNA}
          onSaveSpatialTopology={onSaveSpatialTopology}
        />

        <AssetImageHistoryStrip history={imageHistory} currentImage={scene.referenceImage} onPreview={onImageClick} onApply={onApplyHistory} onDelete={onDeleteHistory} />

        {/* Regenerate and Upload Buttons */}
        {scene.referenceImage && (
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
            <span className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">{text('场景参考图', 'SCENE REFERENCE')}</span>
            {shapeReferenceImage && (
              <button
                onClick={onClearShapeReference}
                disabled={isGenerating}
                className="text-[9px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30"
                title={text('清除场景参考图', 'Clear scene reference')}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="px-2 py-1 bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer flex items-center gap-1">
              <Upload className="w-3 h-3" />
              {text('上传场景参考图', 'Upload Reference')}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleShapeReferenceChange}
              />
            </label>
            <span className="text-[9px] text-[var(--text-muted)]">{text('仅参考场景构图，风格遵循剧本', 'Uses composition only; style follows the script')}</span>
          </div>
          {shapeReferenceImage && (
            <button
              onClick={() => onImageClick(shapeReferenceImage)}
              className="mt-2 w-full flex items-center gap-2 p-2 rounded border border-[var(--border-primary)] hover:border-[var(--border-secondary)] transition-colors text-left"
            >
              <img src={shapeReferenceImage} alt={text('场景参考图', 'Scene reference')} className="w-10 h-10 rounded object-cover" />
              <span className="text-[10px] text-[var(--text-secondary)]">{text('已设置场景参考图，下次生成将生效', 'Reference set; it will apply to the next generation')}</span>
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
            {text('删除场景', 'Delete Scene')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SceneCard;
