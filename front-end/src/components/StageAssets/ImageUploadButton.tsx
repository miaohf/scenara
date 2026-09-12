import React from 'react';
import { Upload, Sparkles, Loader2 } from 'lucide-react';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface ImageUploadButtonProps {
  onUpload: (file: File) => void;
  onGenerate?: () => void;
  isGenerating?: boolean;
  hasImage?: boolean;
  uploadLabel?: string;
  generateLabel?: string;
  size?: 'small' | 'medium' | 'large';
  variant?: 'inline' | 'separate';
}

const ImageUploadButton: React.FC<ImageUploadButtonProps> = ({
  onUpload,
  onGenerate,
  isGenerating = false,
  hasImage = false,
  uploadLabel,
  generateLabel,
  size = 'medium',
  variant = 'separate',
}) => {
  const { text } = useInterfaceLanguage();
  const resolvedUploadLabel = uploadLabel || text('上传', 'Upload');
  const resolvedGenerateLabel = generateLabel || text('生成', 'Generate');
  const sizeClasses = {
    small: 'px-3 py-1.5 text-[10px]',
    medium: 'px-4 py-2 text-xs',
    large: 'px-6 py-3 text-sm',
  };

  const buttonClass = `${sizeClasses[size]} bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border-secondary)] rounded font-bold transition-all border border-[var(--border-secondary)] flex items-center gap-1 cursor-pointer`;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onUpload(file);
      e.target.value = '';
    }
  };

  if (variant === 'inline') {
    return (
      <div className="flex gap-1">
        {onGenerate && (
          <button
            onClick={onGenerate}
            disabled={isGenerating}
            className={buttonClass}
          >
            {isGenerating ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            {resolvedGenerateLabel}
          </button>
        )}
        <label className={buttonClass}>
          <Upload className="w-3 h-3" />
          {resolvedUploadLabel}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleFileChange}
          />
        </label>
      </div>
    );
  }

  // Separate variant for regenerate image + upload
  return (
    <div className="flex gap-2">
      {onGenerate && hasImage && (
        <button
          onClick={onGenerate}
          disabled={isGenerating}
          className={`flex-1 py-1.5 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 border border-[var(--border-primary)] transition-colors`}
          title={text('重新出图：换姿态和构图，不改已保存的提示词', 'Regenerate with a new pose and composition while preserving the saved prompt')}
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              {text('生成中...', 'Generating...')}
            </>
          ) : (
            <>
              <Sparkles className="w-3 h-3" />
              {resolvedGenerateLabel === text('生成', 'Generate') ? text('重新生图', 'Regenerate') : resolvedGenerateLabel}
            </>
          )}
        </button>
      )}
      <label className={`flex-1 py-1.5 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] rounded text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 border border-[var(--border-primary)] transition-colors cursor-pointer`}>
        <Upload className="w-3 h-3" />
        {resolvedUploadLabel}
        <input
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
      </label>
    </div>
  );
};

export default ImageUploadButton;
