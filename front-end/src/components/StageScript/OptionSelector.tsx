import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
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
  onPreviewChange
}) => {
  const [previewValue, setPreviewValue] = useState<string | null>(value);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
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
  const appliedOption = useMemo(
    () => options.find((item) => item.value === value) || null,
    [options, value]
  );

  useEffect(() => {
    setPreviewValue(value);
  }, [value]);

  useEffect(() => {
    setPreviewFailed(false);
  }, [activePreviewOption?.previewImage]);

  const handleOptionClick = (opt: Option) => {
    setPreviewValue(opt.value);
    onPreviewChange?.(opt.value);
    if (previewOnly) return;
    onChange(opt.value);
  };

  return (
    <div className="space-y-2">
      <label className={`${STYLES.label} flex items-center gap-2`}>
        {icon}
        {label}
        {previewOnly && appliedOption && (
          <span className="ml-auto rounded bg-[var(--accent-bg-hover)] px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-[var(--text-primary)]">
            当前 {appliedOption.label}
          </span>
        )}
      </label>
      <div className={`grid grid-cols-${gridCols} gap-2`}>
        {options.map((opt) => (
          <button
            key={opt.value}
            onClick={() => handleOptionClick(opt)}
            title={opt.desc}
            className={`px-${gridCols === 1 ? '3' : '2'} py-2.5 text-[11px] font-medium rounded-md transition-all text-${gridCols === 1 ? 'left' : 'center'} border ${
              value === opt.value
                ? STYLES.button.selected
                : previewOnly && previewValue === opt.value
                  ? `${STYLES.button.secondary} border border-dashed border-[var(--accent-border)] text-[var(--text-secondary)]`
                : `${STYLES.button.secondary} border`
            }`}
          >
            <span className="block">{opt.label}</span>
            {previewOnly && value === opt.value ? (
              <span className="mt-0.5 block text-[9px] font-normal opacity-80">当前项目</span>
            ) : previewOnly && previewValue === opt.value ? (
              <span className="mt-0.5 block text-[9px] font-normal opacity-80">仅预览</span>
            ) : null}
          </button>
        ))}
      </div>
      {hasAnyPreview && (
        <div className="min-h-[156px] overflow-hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-surface)]">
          {showPreviewImage && activePreviewOption?.previewImage ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setIsPreviewOpen(true)}
                className="group relative block w-full"
                title="点击放大"
              >
                <img
                  src={activePreviewOption.previewImage}
                  alt={`${activePreviewOption.label} reference`}
                  className="h-[156px] w-full object-cover"
                  loading="lazy"
                  onError={() => setPreviewFailed(true)}
                />
                <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/12" />
                <div className="absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
                  点击放大
                </div>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-2 py-1.5">
                  <p className="text-[10px] font-semibold text-white">
                    {previewOnly && isPreviewingOther
                      ? `预览 · ${activePreviewOption.label}（未应用）`
                      : `当前 · ${activePreviewOption.label}`}
                  </p>
                </div>
              </button>
            </div>
          ) : (
            <div className="flex h-[156px] items-center justify-center px-3 text-center text-[10px] text-[var(--text-muted)]">
              点击风格按钮可查看参考图
            </div>
          )}
        </div>
      )}
      {previewOnly && (
        <p className="text-[10px] leading-relaxed text-[var(--text-muted)]">
          {isPreviewingOther
            ? `正在预览「${options.find((item) => item.value === previewValue)?.label || previewValue}」，当前项目风格仍为「${appliedOption?.label || value}」。点击「生成分镜脚本」后才会切换。`
            : `当前项目风格是「${appliedOption?.label || value}」。点击其他风格只换参考图，点「生成分镜脚本」后才会写入分镜。`}
        </p>
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
