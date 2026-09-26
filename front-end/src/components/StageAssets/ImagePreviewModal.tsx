import React, { useEffect, useMemo, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface ImagePreviewModalProps {
  imageUrl: string | null;
  imageUrls?: string[];
  onClose: () => void;
  onDeleteImage?: (imageUrl: string) => void;
  onApplyImage?: (imageUrl: string) => void;
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ imageUrl, imageUrls, onClose, onDeleteImage, onApplyImage }) => {
  const { text } = useInterfaceLanguage();
  const images = useMemo(() => {
    const candidates = imageUrls && imageUrls.length > 0 ? imageUrls : imageUrl ? [imageUrl] : [];
    return candidates.filter((url, index) => url && candidates.indexOf(url) === index);
  }, [imageUrl, imageUrls]);
  const [currentIndex, setCurrentIndex] = useState(() => Math.max(0, images.indexOf(imageUrl || '')));

  useEffect(() => {
    setCurrentIndex(Math.max(0, images.indexOf(imageUrl || '')));
  }, [imageUrl, images]);

  useEffect(() => {
    if (!imageUrl) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (images.length < 2) return;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setCurrentIndex((index) => (index - 1 + images.length) % images.length);
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setCurrentIndex((index) => (index + 1) % images.length);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [imageUrl, images, onClose]);

  if (!imageUrl) return null;
  const currentImage = images[currentIndex] || imageUrl;
  const hasMultipleImages = images.length > 1;

  return (
    <div 
      className="absolute inset-0 z-50 bg-[var(--bg-base)]/95 flex items-center justify-center backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div className="absolute top-6 right-6 z-10 flex items-center gap-2">
        {onApplyImage && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onApplyImage(currentImage); }}
            className="flex items-center gap-1.5 rounded-full border border-[var(--accent-border)] bg-[var(--accent-bg)]/90 px-3 py-2 text-xs text-[var(--accent-text)] transition-colors hover:bg-[var(--accent-hover-bg)]"
            title={text('使用当前图片', 'Use current image')}
          >
            <Check className="h-4 w-4" />
            {text('使用', 'Use')}
          </button>
        )}
        {onDeleteImage && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); onDeleteImage(currentImage); }}
            className="flex items-center gap-1.5 rounded-full border border-[var(--error-border)] bg-[var(--error-bg)]/80 px-3 py-2 text-xs text-[var(--error-text)] transition-colors hover:bg-[var(--error-bg)]"
            title={text('删除当前历史图片', 'Delete current history image')}
          >
            <Trash2 className="h-4 w-4" />
            {text('删除', 'Delete')}
          </button>
        )}
        <button
          onClick={onClose}
          className="rounded-full p-3 transition-colors hover:bg-[var(--text-primary)]/10 group"
        >
          <X className="h-6 w-6 text-[var(--text-primary)] transition-transform group-hover:rotate-90" />
        </button>
      </div>
      <div className="flex items-center justify-center p-8 w-full h-full">
        <img 
          src={currentImage}
          alt="Preview" 
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      {hasMultipleImages && (
        <>
          <button type="button" onClick={(event) => { event.stopPropagation(); setCurrentIndex((index) => (index - 1 + images.length) % images.length); }} className="absolute left-5 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/45 p-3 text-white transition-colors hover:bg-black/70" aria-label={text('上一张历史定妆照', 'Previous casting photo')}>
            <ChevronLeft className="h-7 w-7" />
          </button>
          <button type="button" onClick={(event) => { event.stopPropagation(); setCurrentIndex((index) => (index + 1) % images.length); }} className="absolute right-5 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/45 p-3 text-white transition-colors hover:bg-black/70" aria-label={text('下一张历史定妆照', 'Next casting photo')}>
            <ChevronRight className="h-7 w-7" />
          </button>
          <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[var(--overlay-border)] bg-[var(--overlay-medium)] px-3 py-1.5 backdrop-blur-sm">
            <p className="text-xs text-[var(--text-primary)]/75">{currentIndex + 1} / {images.length}</p>
          </div>
        </>
      )}
      <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-[var(--bg-base)]/60 backdrop-blur rounded-lg border border-[var(--overlay-border)]">
            <p className="text-xs text-[var(--text-secondary)] font-mono">{text('← / → 切换，点击空白处关闭', '← / → to navigate, click outside to close')}</p>
      </div>
    </div>
  );
};

export default ImagePreviewModal;
