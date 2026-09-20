import React from 'react';
import { User, Check, Shirt, Trash2, Edit2, AlertCircle, FolderPlus, Grid3x3, Images, Link2, Upload, X, Loader2, History } from 'lucide-react';
import { Character } from '../../types';
import PromptEditor from './PromptEditor';
import ImageUploadButton from './ImageUploadButton';
import InlineEditableText from './InlineEditableText';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';
import {
  getCharacterImageHistory,
  resolveCharacterDisplayImage,
  resolveCharacterImageView,
  sameCharacterImage,
} from '../../services/characterImageHistory';

interface CharacterCardProps {
  character: Character;
  isGenerating: boolean;
  shapeReferenceImage?: string;
  referenceWorkflowName?: string;
  referenceSteps?: number;
  onGenerate: () => void;
  onUpload: (file: File) => void;
  onUploadShapeReference: (file: File) => void;
  onClearShapeReference: () => void;
  onPromptSave: (newPrompt: string) => void;
  onRegeneratePrompt?: () => void;
  isRegeneratingPrompt?: boolean;
  onOpenWardrobe: () => void;
  onOpenTurnaround: () => void;
  onOpenThreeView: () => void;
  onImageClick: (imageUrl: string, imageUrls?: string[]) => void;
  onDelete: () => void;
  onUpdateInfo: (updates: { name?: string; gender?: string; age?: string; personality?: string; species?: string }) => void;
  onAddToLibrary: () => void;
  onReplaceFromLibrary: () => void;
  onApplyHistory: (imageUrl: string) => void;
}

const CharacterCard: React.FC<CharacterCardProps> = ({
  character,
  isGenerating,
  shapeReferenceImage,
  referenceWorkflowName,
  referenceSteps,
  onGenerate,
  onUpload,
  onUploadShapeReference,
  onClearShapeReference,
  onPromptSave,
  onRegeneratePrompt,
  isRegeneratingPrompt = false,
  onOpenWardrobe,
  onOpenTurnaround,
  onOpenThreeView,
  onImageClick,
  onDelete,
  onUpdateInfo,
  onAddToLibrary,
  onReplaceFromLibrary,
  onApplyHistory,
}) => {
  const { text } = useInterfaceLanguage();
  const isLinked = !!character.libraryId;
  const activeImageView = resolveCharacterImageView(character);
  const displayImage = resolveCharacterDisplayImage(character);
  const imageHistory = getCharacterImageHistory(character);
  const isSheetView = activeImageView !== 'casting' && !!displayImage;
  const handleShapeReferenceChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onUploadShapeReference(file);
    e.target.value = '';
  };

  return (
    <div className={`bg-[var(--bg-surface)] border rounded-xl overflow-hidden flex flex-col group transition-all hover:shadow-lg ${isLinked ? 'border-[var(--accent-border)] hover:border-[var(--accent)]' : 'border-[var(--border-primary)] hover:border-[var(--border-secondary)]'}`}>
      {isLinked && (
        <div className="px-4 py-1.5 bg-[var(--accent-bg)] border-b border-[var(--accent-border)] flex items-center gap-1.5">
          <Link2 className="w-3 h-3 text-[var(--accent-text)]" />
          <span className="text-[9px] font-mono text-[var(--accent-text)] uppercase tracking-widest">{text('项目角色', 'PROJECT CHARACTER')}</span>
        </div>
      )}
      <div className="flex gap-3 p-3 pb-0">
        {/* Character Image */}
        <div className={`${isSheetView ? 'w-44' : 'w-36'} flex-shrink-0 transition-[width] duration-200`}>
          <div 
            className={`${isSheetView ? 'aspect-video' : 'aspect-[9/16]'} bg-[var(--bg-elevated)] relative rounded-lg overflow-hidden cursor-pointer transition-[aspect-ratio] duration-200`}
            onClick={() => displayImage && onImageClick(displayImage)}
          >
            {displayImage ? (
              <>
                <img
                  key={displayImage}
                  src={displayImage}
                  alt={character.name}
                  className="w-full h-full object-contain"
                />
                {isSheetView && (
                  <div className="absolute left-1.5 top-1.5 rounded border border-white/15 bg-black/65 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white/90 backdrop-blur-sm">
                    {activeImageView === 'turnaround' ? text('九宫格', 'Turnaround') : text('三视图', 'Three-view')}
                  </div>
                )}
                {isGenerating && (
                  <div className="absolute inset-0 bg-black/50 flex flex-col items-center justify-center gap-1">
                    <Loader2 className="w-6 h-6 animate-spin text-white" />
                    <span className="text-[10px] text-white font-bold tracking-wider">{text('重新出图中', 'RENDERING')}</span>
                  </div>
                )}
                {!isGenerating && (
                  <div className="absolute top-1.5 right-1.5 p-1 bg-[var(--accent)] text-[var(--accent-on)] rounded shadow-lg">
                    <Check className="w-3 h-3" />
                  </div>
                )}
              </>
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-[var(--text-muted)] p-2 text-center">
                {character.status === 'failed' ? (
                  <>
                    <AlertCircle className="w-8 h-8 mb-2 text-[var(--error)]" />
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
                    <User className="w-8 h-8 mb-2 opacity-10" />
                    <ImageUploadButton
                      variant="inline"
                      size="small"
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
        </div>

        {/* Character Info & Actions */}
        <div className="flex-1 flex flex-col min-w-0 justify-between">
          {/* Header */}
          <div>
            <InlineEditableText
              value={character.name}
              onSave={(next) => onUpdateInfo({ name: next })}
              inputClassName="font-bold text-[var(--text-primary)] text-base mb-1 bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-2 py-1 w-full focus:outline-none focus:border-[var(--accent)]"
              renderDisplay={(value, startEdit) => (
                <div className="flex items-center gap-2 mb-1 group/name">
                  <h3 className="font-bold text-[var(--text-primary)] text-base">{value}</h3>
                  <button
                    onClick={startEdit}
                    className="opacity-0 group-hover/name:opacity-100 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-opacity"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                </div>
              )}
            />
            <div className="flex items-center gap-2">
              <InlineEditableText
                value={character.gender}
                onSave={(next) => onUpdateInfo({ gender: next })}
                inputClassName="text-[10px] text-[var(--text-primary)] font-mono uppercase bg-[var(--bg-hover)] border border-[var(--border-secondary)] px-2 py-0.5 rounded focus:outline-none focus:border-[var(--accent)] w-20"
                renderDisplay={(value, startEdit) => (
                  <span
                    onClick={startEdit}
                    className="text-[10px] text-[var(--text-tertiary)] font-mono uppercase bg-[var(--bg-elevated)] px-2 py-0.5 rounded cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
                  >
                    {value}
                  </span>
                )}
              />
              <InlineEditableText
                value={character.age}
                onSave={(next) => onUpdateInfo({ age: next })}
                inputClassName="text-[10px] text-[var(--text-primary)] bg-[var(--bg-hover)] border border-[var(--border-secondary)] px-2 py-0.5 rounded focus:outline-none focus:border-[var(--accent)] w-20"
                renderDisplay={(value, startEdit) => (
                  <span
                    onClick={startEdit}
                    className="text-[10px] text-[var(--text-tertiary)] cursor-pointer hover:text-[var(--text-secondary)] transition-colors"
                  >
                    {value}
                  </span>
                )}
              />
              <InlineEditableText
                value={character.species || ''}
                onSave={(next) => onUpdateInfo({ species: next })}
                inputClassName="text-[10px] text-[var(--text-primary)] font-mono bg-[var(--bg-hover)] border border-[var(--border-secondary)] px-2 py-0.5 rounded focus:outline-none focus:border-[var(--accent)] w-24"
                renderDisplay={(value, startEdit) => (
                  <span
                    onClick={startEdit}
                    className="text-[10px] text-[var(--text-tertiary)] font-mono bg-[var(--bg-elevated)] px-2 py-0.5 rounded cursor-pointer hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)] transition-colors"
                    title={text('物种，如 human / 黑背幼犬 / 拟人棕猫', 'Species, such as human, puppy, or anthropomorphic cat')}
                  >
                    {value || text('物种', 'Species')}
                  </span>
                )}
              />
              {character.variations && character.variations.length > 0 && (
                <span className="text-[9px] text-[var(--text-tertiary)] font-mono flex items-center gap-1 bg-[var(--bg-elevated)] px-1.5 py-0.5 rounded">
                  <Shirt className="w-2.5 h-2.5" /> +{character.variations.length}
                </span>
              )}
            </div>
          </div>

          {/* Actions Row */}
          <div className="flex flex-col gap-2 mt-2 w-full max-w-[19rem] self-end">
            {/* Manage Wardrobe Button */}
            <button 
              onClick={onOpenWardrobe}
              className="w-full px-3 py-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider whitespace-nowrap flex items-center justify-center gap-1.5 border border-[var(--border-primary)] transition-colors"
            >
              <Shirt className="w-3 h-3" />
              {text('服装变体', 'Wardrobe Variants')}
            </button>

            <div className="grid w-full grid-cols-2 gap-2">
              <button
                onClick={onOpenTurnaround}
                className={`min-w-0 px-2 py-2 rounded text-[10px] font-bold uppercase tracking-wide whitespace-nowrap flex items-center justify-center gap-1.5 border transition-colors ${
                  activeImageView === 'turnaround'
                    ? 'bg-[var(--accent-bg)] hover:bg-[var(--accent-hover-bg)] text-[var(--accent-text)] border-[var(--accent-border)]'
                    : 'bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border-[var(--border-primary)]'
                }`}
              >
                <Grid3x3 className="w-3 h-3" />
                {text('九宫格', 'Turnaround')}
                {character.turnaround?.status === 'completed' && <Check className="w-2.5 h-2.5" />}
              </button>
              <button
                onClick={onOpenThreeView}
                className={`min-w-0 px-2 py-2 rounded text-[10px] font-bold uppercase tracking-wide whitespace-nowrap flex items-center justify-center gap-1.5 border transition-colors ${
                  activeImageView === 'threeView'
                    ? 'bg-[var(--accent-bg)] hover:bg-[var(--accent-hover-bg)] text-[var(--accent-text)] border-[var(--accent-border)]'
                    : 'bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] border-[var(--border-primary)]'
                }`}
              >
                <Images className="w-3 h-3" />
                {text('三视图', 'Three-view')}
                {character.threeView?.status === 'completed' && <Check className="w-2.5 h-2.5" />}
              </button>
            </div>

            {/* Upload Button */}
            {character.referenceImage && (
              <div className="w-full">
                <ImageUploadButton
                  variant="separate"
                  hasImage={true}
                  onUpload={onUpload}
                  onGenerate={onGenerate}
                  isGenerating={isGenerating}
                  uploadLabel={text('上传', 'Upload')}
                />
              </div>
            )}

            <button
              onClick={onReplaceFromLibrary}
              disabled={isGenerating}
              className="w-full px-3 py-2 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider whitespace-nowrap flex items-center justify-center gap-1.5 border border-[var(--border-primary)] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <FolderPlus className="w-3 h-3" />
              {text('从资产库替换', 'Replace from Library')}
            </button>
          </div>
        </div>
      </div>

      {/* Prompt Section & Generate Button */}
      <div className="p-3 flex-1 flex flex-col">
        {/* Prompt Section */}
        <div className="flex-1 mb-3">
          <PromptEditor
            prompt={character.visualPrompt || ''}
            onSave={onPromptSave}
            onRegenerate={onRegeneratePrompt}
            isRegenerating={isRegeneratingPrompt}
            label={text('角色提示词', 'Character Prompt')}
            placeholder={text('输入角色的视觉描述...', 'Describe the character visually...')}
          />
        </div>

        <div className="mb-3 border border-[var(--border-primary)] rounded-lg p-2.5 bg-[var(--bg-elevated)]/40">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-mono text-[var(--text-tertiary)] uppercase tracking-wider">{text('角色参考图', 'CHARACTER REFERENCE')}</span>
            {shapeReferenceImage && (
              <button
                onClick={onClearShapeReference}
                disabled={isGenerating}
                className="text-[9px] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-30"
                title={text('清除角色参考图', 'Clear character reference')}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label className="px-2 py-1 bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded text-[9px] font-bold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer flex items-center gap-1">
              <Upload className="w-3 h-3" />
              {text('上传角色参考图', 'Upload Reference')}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleShapeReferenceChange}
              />
            </label>
            <span className="text-[9px] text-[var(--text-muted)]">{text('仅参考角色外形，风格遵循剧本', 'Uses shape only; style follows the script')}</span>
          </div>
          {shapeReferenceImage && (
            <button
              onClick={() => onImageClick(shapeReferenceImage)}
              className="mt-2 w-full flex items-center gap-2 p-2 rounded border border-[var(--border-primary)] hover:border-[var(--border-secondary)] transition-colors text-left"
            >
              <img src={shapeReferenceImage} alt={text('角色参考图', 'Character reference')} className="w-10 h-10 rounded object-cover object-top" />
              <span className="text-[10px] text-[var(--text-secondary)]">
                {referenceWorkflowName
                  ? text(
                    `已设置角色参考图；下次走 ${referenceWorkflowName}${referenceSteps ? ` · ${referenceSteps} Steps` : ''}`,
                    `Reference set; next generation uses ${referenceWorkflowName}${referenceSteps ? ` · ${referenceSteps} steps` : ''}`
                  )
                  : text('已设置角色参考图，下次生成将生效', 'Reference set; it will apply to the next generation')}
              </span>
            </button>
          )}
        </div>

        {imageHistory.length > 0 && (
          <div className="mb-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)]/25 p-2.5">
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]">
                <History className="h-3 w-3" />
                {text('历史版本', 'History')}
              </span>
              <span className="text-[9px] text-[var(--text-muted)]">
                {imageHistory.length} {text('个版本', imageHistory.length === 1 ? 'version' : 'versions')}
              </span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {imageHistory.map((entry, index) => {
                const isCurrent = activeImageView === 'casting' && sameCharacterImage(entry.imageUrl, character.referenceImage);
                return (
                  <div key={entry.id} className="w-[4.75rem] shrink-0">
                    <button
                      onClick={() => onImageClick(entry.imageUrl, imageHistory.map((item) => item.imageUrl))}
                      className={`aspect-square w-full overflow-hidden rounded border bg-[var(--bg-deep)] transition-colors ${isCurrent ? 'border-[var(--accent)]' : 'border-[var(--border-primary)] hover:border-[var(--border-secondary)]'}`}
                      aria-label={text(`历史版本 ${index + 1}`, `History version ${index + 1}`)}
                    >
                      <img src={entry.imageUrl} alt={text(`历史版本 ${index + 1}`, `History version ${index + 1}`)} className="h-full w-full object-cover object-top" />
                    </button>
                    <button
                      onClick={() => onApplyHistory(entry.imageUrl)}
                      disabled={isCurrent}
                      className={`mt-1 w-full rounded border px-1 py-1 text-[8px] font-bold uppercase tracking-wider transition-colors ${isCurrent ? 'cursor-default border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent-text)]' : 'border-[var(--border-secondary)] bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                    >
                      {isCurrent ? text('当前', 'Current') : text('使用', 'Use')}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-2 flex gap-2">
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
            {text('删除角色', 'Delete Character')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CharacterCard;
