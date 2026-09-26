import React, { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface ImagePreviewModalProps {
  imageUrl: string | null;
  imageUrls?: string[];
  title?: string;
  onClose: () => void;
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ imageUrl, imageUrls, title, onClose }) => {
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
      className="fixed inset-0 z-50 bg-[var(--overlay-full)] backdrop-blur-md flex items-center justify-center animate-in fade-in duration-200"
      onClick={onClose}
    >
      <button 
        className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-[var(--text-primary)] transition-colors z-10"
        onClick={onClose}
      >
        <X className="w-6 h-6" />
      </button>
      
      {title && (
        <div className="absolute top-6 left-6 z-10">
            <div className="bg-[var(--overlay-medium)] backdrop-blur-sm px-4 py-2 rounded-lg border border-[var(--overlay-border)]">
            <h3 className="text-[var(--text-primary)] font-bold text-sm">{title}</h3>
          </div>
        </div>
      )}

      {hasMultipleImages && (
        <>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setCurrentIndex((index) => (index - 1 + images.length) % images.length); }}
            className="absolute left-5 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/45 p-3 text-white transition-colors hover:bg-black/70"
            aria-label={text('上一张媒体', 'Previous media')}
          >
            <ChevronLeft className="h-7 w-7" />
          </button>
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); setCurrentIndex((index) => (index + 1) % images.length); }}
            className="absolute right-5 top-1/2 z-10 -translate-y-1/2 rounded-full bg-black/45 p-3 text-white transition-colors hover:bg-black/70"
            aria-label={text('下一张媒体', 'Next media')}
          >
            <ChevronRight className="h-7 w-7" />
          </button>
          <div className="absolute bottom-6 left-1/2 z-10 -translate-x-1/2 rounded-full border border-[var(--overlay-border)] bg-[var(--overlay-medium)] px-3 py-1.5 backdrop-blur-sm">
            <p className="text-xs text-[var(--text-primary)]/75">{currentIndex + 1} / {images.length}</p>
          </div>
        </>
      )}
      
      <div className="flex items-center justify-center p-8 w-full h-full">
        <img 
          key={currentImage}
          src={currentImage}
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
          alt={title || 'Preview'}
        />
      </div>
      
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10">
        <div className="bg-[var(--overlay-medium)] backdrop-blur-sm px-4 py-2 rounded-full border border-[var(--overlay-border)]">
          <p className="text-[var(--text-primary)]/60 text-xs">{text('点击空白处关闭', 'Click outside to close')}</p>
        </div>
      </div>
    </div>
  );
};

export default ImagePreviewModal;
