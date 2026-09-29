import React, { useEffect, useMemo, useState } from 'react';
import { Check, ImagePlus, RefreshCw, X } from 'lucide-react';
import { STYLES } from './constants';

interface Option {
  label: string;
  value: string;
  desc?: string;
  previewImage?: string;
}

interface Props {
  label: string;
  icon?: React.ReactNode;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  customInput?: string;
  onCustomInputChange?: (value: string) => void;
  customPlaceholder?: string;
  gridCols?: 1 | 2;
  helpText?: string;
  helpLink?: { text: string; url: string };
  /** 点击只切换参考图预览，不改已生效的选项；真正生效由外部提交动作完成 */
  previewOnly?: boolean;
  onPreviewChange?: (value: string) => void;
  managementSlot?: React.ReactNode | ((value: string) => React.ReactNode);
  labelAction?: React.ReactNode;
  onRegeneratePreview?: (value: string) => void;
  onApplyPreview?: (value: string) => void;
  generatingPreviewValues?: string[];
}

const OptionSelector: React.FC<Props> = ({
  label,
  icon,
  options,
  value,
  onChange,
  customInput,
  onCustomInputChange,
  customPlaceholder,
  gridCols = 2,
  helpText,
  helpLink,
  previewOnly = false,
  onPreviewChange,
  managementSlot,
  labelAction,
  onRegeneratePreview,
  generatingPreviewValues = [],
}) => {
  const [previewValue, setPreviewValue] = useState<string | null>(value);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewRatio, setPreviewRatio] = useState<number | null>(null);
  const previewTargetValue = previewValue || value;
  const previewTarget = useMemo(
    () => options.find((item) => item.value === previewTargetValue) || null,
    [options, previewTargetValue]
  );
  const selectedPreviewOption = useMemo(
    () => options.find((item) => item.value === previewValue && !!item.previewImage) || null,
    [previewValue, options]
  );
  const valuePreviewOption = useMemo(
    () => options.find((item) => item.value === value && !!item.previewImage) || null,
    [value, options]
  );
  const isPreviewingOther = previewOnly && !!previewValue && previewValue !== value;
  const activePreviewOption = selectedPreviewOption || (isPreviewingOther ? null : valuePreviewOption);
  const hasAnyPreview = options.some((item) => !!item.previewImage);
  const showPreviewImage = !!activePreviewOption?.previewImage && !previewFailed;
  const emptyPreviewText = previewFailed
    ? '参考图加载失败，可重新生成'
    : previewTarget && !previewTarget.previewImage
      ? '该风格还没有参考图'
      : '点击风格按钮可查看参考图';
  const canGenerateMissingPreview = !!onRegeneratePreview && !!previewTarget && (!previewTarget.previewImage || previewFailed);

  const renderManagement = (className: string) => {
    if (!managementSlot) return null;
    return (
      <div className={className} onClick={(event) => event.stopPropagation()}>
        {typeof managementSlot === 'function' ? managementSlot(previewTargetValue) : managementSlot}
      </div>
    );
  };

  useEffect(() => {
    setPreviewValue(value);
  }, [value]);

  useEffect(() => {
    setPreviewFailed(false);
    setPreviewRatio(null);
  }, [activePreviewOption?.previewImage]);

  const isCompactPreview = previewRatio !== null && previewRatio < 1.3;

  const handleOptionClick = (opt: Option) => {
    setPreviewValue(opt.value);
    onPreviewChange?.(opt.value);
    if (previewOnly) return;
    onChange(opt.value);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <label className={`${STYLES.label} flex items-center gap-2`}>
          {icon}
          {label}
        </label>
        {labelAction}
      </div>
      <div className={`grid grid-cols-${gridCols} gap-2`}>
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleOptionClick(opt)}
            title={opt.desc}
            className={`px-${gridCols === 1 ? '3' : '2'} py-2.5 text-[11px] font-medium rounded-md transition-all text-${gridCols === 1 ? 'left' : 'center'} border ${
              value === opt.value
                ? `${STYLES.button.selected} ring-1 ring-[var(--accent-border)]`
                : previewOnly && previewValue === opt.value
                  ? `${STYLES.button.secondary} border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--text-primary)] ring-1 ring-[var(--accent-border)]`
                : `${STYLES.button.secondary} border`
            }`}
          >
            <span className="block">{opt.label}{value === opt.value && <Check className="ml-1 inline h-3 w-3 align-middle" aria-label="已应用" />}</span>
          </button>
        ))}
      </div>
      {(hasAnyPreview || managementSlot) && (
        <div className={`overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)] ${showPreviewImage && isCompactPreview ? 'mx-auto w-fit max-w-full' : ''}`}>
          {showPreviewImage && activePreviewOption?.previewImage ? (
            <div
              onClick={() => setIsPreviewOpen(true)}
              className={`group relative block cursor-zoom-in bg-black ${isCompactPreview ? 'mx-auto w-fit max-w-full' : 'aspect-video w-full'}`}
              aria-label={`放大查看 ${activePreviewOption.label} 参考图`}
            >
              {!isCompactPreview && (
                <img
                  src={activePreviewOption.previewImage}
                  alt=""
                  aria-hidden
                  className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl brightness-50"
                />
              )}
              <img
                src={activePreviewOption.previewImage}
                alt={`${activePreviewOption.label} reference`}
                className={isCompactPreview
                  ? 'relative z-[1] block max-h-72 w-auto max-w-full object-contain'
                  : 'relative z-[1] h-full w-full object-contain'}
                loading="lazy"
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth > 0 && naturalHeight > 0) {
                    setPreviewRatio(naturalWidth / naturalHeight);
                  }
                }}
                onError={() => setPreviewFailed(true)}
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] h-14 bg-gradient-to-t from-black/70 to-transparent" />
              <div className="pointer-events-none absolute inset-0 z-[2] bg-black/0 transition-colors group-hover:bg-black/20" />
              {renderManagement('absolute bottom-2 right-2 z-10 rounded-md bg-[var(--bg-primary)]/90')}
            </div>
          ) : (
            <div className="relative flex aspect-video flex-col items-center justify-center gap-3 px-3 text-center text-[10px] text-[var(--text-muted)]">
              <span>{emptyPreviewText}</span>
              {canGenerateMissingPreview && (
                <button
                  type="button"
                  disabled={generatingPreviewValues.includes(previewTargetValue)}
                  onClick={() => onRegeneratePreview?.(previewTargetValue)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50"
                >
                  {generatingPreviewValues.includes(previewTargetValue)
                    ? <RefreshCw className="h-3 w-3 animate-spin" />
                    : <ImagePlus className="h-3 w-3" />}
                  生成预览
                </button>
              )}
              {renderManagement('absolute bottom-2 right-2 z-10 rounded-md bg-[var(--bg-primary)]/90')}
            </div>
          )}
        </div>
      )}

      {isPreviewOpen && activePreviewOption?.previewImage && (
        <div
          className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setIsPreviewOpen(false)}
        >
          <div
            className="relative w-full max-w-5xl"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setIsPreviewOpen(false)}
              className="absolute right-2 top-2 z-10 rounded bg-black/65 p-1.5 text-white hover:bg-black/80"
              aria-label="关闭预览"
            >
              <X className="h-4 w-4" />
            </button>
            <img
              src={activePreviewOption.previewImage}
              alt={`${activePreviewOption.label} enlarged reference`}
              className="max-h-[86vh] w-full rounded-lg border border-white/20 object-contain bg-black"
            />
            <div className="mt-2 text-center text-xs text-white/90">
              {activePreviewOption.label}
            </div>
          </div>
        </div>
      )}
      {(previewOnly ? previewValue : value) === 'custom' && onCustomInputChange && (
        <div className="pt-1">
          <input 
            type="text"
            value={customInput}
            onChange={(e) => onCustomInputChange(e.target.value)}
            className={`${STYLES.input} font-mono`}
            placeholder={customPlaceholder}
          />
        </div>
      )}
      {helpText && (
        <div className="pt-1 px-3 py-2 bg-[var(--nav-hover-bg)] border border-[var(--border-primary)] rounded-md">
          <p className="text-[10px] text-[var(--text-tertiary)] leading-relaxed">
            💡 提示：{helpText}
            {helpLink && (
              <>
                {' '}
                <a 
                  href={helpLink.url} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] underline underline-offset-2 transition-colors font-medium"
                >
                  {helpLink.text}
                </a>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
};

export default OptionSelector;
