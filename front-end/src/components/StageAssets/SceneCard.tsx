import React from 'react';
import { MapPin, Check, Loader2, Trash2, Edit2, AlertCircle, FolderPlus, Upload, X } from 'lucide-react';
import PromptEditor from './PromptEditor';
import ImageUploadButton from './ImageUploadButton';
import InlineEditableText from './InlineEditableText';

interface SceneCardProps {
  scene: {
    id: string;
    location: string;
    time: string;
    atmosphere: string;
    visualPrompt?: string;
    referenceImage?: string;
    status?: 'pending' | 'generating' | 'completed' | 'failed';
  };
  isGenerating: boolean;
  shapeReferenceImage?: string;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onUploadShapeReference: (file: File) => void;
  onClearShapeReference: () => void;
  onPromptSave: (newPrompt: string) => void;
  onImageClick: (imageUrl: string) => void;
  onDelete: () => void;
  onUpdateInfo: (updates: { location?: string; time?: string; atmosphere?: string }) => void;
  onAddToLibrary: () => void;
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
  onImageClick,
  onDelete,
  onUpdateInfo,
  onAddToLibrary,
}) => {
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
        onClick={() => scene.referenceImage && onImageClick(scene.referenceImage)}
      >
        {scene.referenceImage ? (
          <>
            <img src={scene.referenceImage} alt={scene.location} className="w-full h-full object-cover" />
            <div className="absolute top-2 right-2 p-1 bg-[var(--accent)] text-[var(--text-primary)] rounded shadow-lg backdrop-blur">
              <Check className="w-3 h-3" />
            </div>
          </>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-muted)] p-4 text-center">
            {isGenerating ? (
              <>
                <Loader2 className="w-10 h-10 mb-3 animate-spin text-[var(--accent)]" />
                <span className="text-[10px] text-[var(--text-tertiary)]">生成中...</span>
              </>
            ) : scene.status === 'failed' ? (
              <>
                <AlertCircle className="w-10 h-10 mb-3 text-[var(--error)]" />
                <span className="text-[10px] text-[var(--error)] mb-2">生成失败</span>
                <ImageUploadButton
                  variant="inline"
                  size="small"
                  onUpload={onUpload}
                  onGenerate={onGenerate}
                  isGenerating={isGenerating}
                  uploadLabel="上传"
                  generateLabel="重试"
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
                  uploadLabel="上传"
                  generateLabel="生成"
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
            label="场景提示词"
            placeholder="输入场景视觉描述..."
            maxHeight="max-h-[160px]"
          />
        </div>

        {/* Regenerate and Upload Buttons */}
        {scene.referenceImage && (
          <div className="mt-3 pt-3 border-t border-[var(--border-primary)]">
            <ImageUploadButton
              variant="separate"
              hasImage={true}
              onUpload={onUpload}
              onGenerate={onGenerate}
              isGenerating={isGenerating}
              uploadLabel="上传图片"
            />
          </div>
        )}

        <div className="mt-3 pt-3 border-t border-[var(--border-primary)]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">场景参考图</span>
            {shapeReferenceImage && (
              <button
                onClick={onClearShapeReference}
                disabled={isGenerating}
                className="text-[9px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30"
                title="清除场景参考图"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="px-2 py-1 bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer flex items-center gap-1">
              <Upload className="w-3 h-3" />
              上传场景参考图
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleShapeReferenceChange}
              />
            </label>
            <span className="text-[9px] text-[var(--text-muted)]">仅参考场景构图，风格遵循剧本</span>
          </div>
          {shapeReferenceImage && (
            <button
              onClick={() => onImageClick(shapeReferenceImage)}
              className="mt-2 w-full flex items-center gap-2 p-2 rounded border border-[var(--border-primary)] hover:border-[var(--border-secondary)] transition-colors text-left"
            >
              <img src={shapeReferenceImage} alt="场景参考图" className="w-10 h-10 rounded object-cover" />
              <span className="text-[10px] text-[var(--text-secondary)]">已设置场景参考图，下次生成将生效</span>
            </button>
          )}
        </div>

        <div className="mt-3 pt-3 border-t border-[var(--border-primary)]">
          <button
            onClick={onAddToLibrary}
            disabled={isGenerating}
            className="w-full py-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border-primary)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <FolderPlus className="w-3 h-3" />
            加入资产库
          </button>
        </div>

        {/* Delete Button */}
        <div className="mt-3 pt-3 border-t border-[var(--border-primary)]">
          <button
            onClick={onDelete}
            disabled={isGenerating}
            className="w-full py-2 bg-transparent hover:bg-[var(--error-bg)] text-[var(--error-text)] hover:text-[var(--error-text)] border border-[var(--error-border)] hover:border-[var(--error-border)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-2 transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Trash2 className="w-3 h-3" />
            删除场景
          </button>
        </div>
      </div>
    </div>
  );
};

export default SceneCard;
