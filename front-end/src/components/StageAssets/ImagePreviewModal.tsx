import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface ImagePreviewModalProps {
  imageUrl: string | null;
  imageUrls?: string[];
  onClose: () => void;
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ imageUrl, imageUrls, onClose }) => {
  const { text } = useInterfaceLanguage();
  const images = useMemo(() => {
    const candidates = imageUrls && imageUrls.length > 0 ? imageUrls : imageUrl ? [imageUrl] : [];
    return candidates.filter((url, index) => url && candidates.indexOf(url) === index);
  }, [imageUrl, imageUrls]);
  const [currentIndex, setCurrentIndex] = useState(() => Math.max(0, images.indexOf(imageUrl || '')));

  useEffect(() => {
    setCurrentIndex(Math.max(0, images.indexOf(imageUrl || '')));
  }, [imageUrl, images]);

  if (!imageUrl) return null;
  const currentImage = images[currentIndex] || imageUrl;
  const hasMultipleImages = images.length > 1;

  return (
    <div 
      className="absolute inset-0 z-50 bg-[var(--bg-base)]/95 flex items-center justify-center backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <button 
        onClick={onClose}
        className="absolute top-6 right-6 p-3 hover:bg-[var(--text-primary)]/10 rounded-full transition-colors group z-10"
      >
        <X className="w-6 h-6 text-[var(--text-primary)] group-hover:rotate-90 transition-transform" />
      </button>
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
        <p className="text-xs text-[var(--text-secondary)] font-mono">{text('点击空白处关闭', 'Click outside to close')}</p>
      </div>
    </div>
  );
};

export default ImagePreviewModal;
