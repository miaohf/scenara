import React from 'react';
import { Check, History } from 'lucide-react';
import type { AssetImageHistoryEntry } from '../../types';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';
import { sameAssetImage } from '../../services/assetImageHistory';

interface AssetImageHistoryStripProps {
  history: AssetImageHistoryEntry[];
  currentImage?: string;
  onPreview: (url: string, urls: string[], onDelete?: (url: string) => void, onApply?: (url: string) => void) => void;
  onApply: (url: string) => void;
  onDelete: (url: string) => void;
  imageClassName?: string;
}

const AssetImageHistoryStrip: React.FC<AssetImageHistoryStripProps> = ({ history, currentImage, onPreview, onApply, onDelete, imageClassName = '' }) => {
  const { text } = useInterfaceLanguage();
  if (!history.length) return null;
  const urls = history.map((item) => item.imageUrl);

  return (
    <div className="mb-3 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)]/25 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[var(--text-tertiary)]"><History className="h-3 w-3" />{text('历史版本', 'History')}</span>
        <span className="text-[9px] text-[var(--text-muted)]">{history.length} {text('个版本', history.length === 1 ? 'version' : 'versions')}</span>
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {history.map((entry, index) => {
          const isCurrent = sameAssetImage(entry.imageUrl, currentImage);
          return (
            <div key={entry.id} className="w-[4.75rem] shrink-0">
              <div className="relative">
                <button onClick={() => onPreview(entry.imageUrl, urls, onDelete, onApply)} className={`aspect-square w-full overflow-hidden rounded border bg-[var(--bg-deep)] transition-colors ${isCurrent ? 'border-[var(--accent)]' : 'border-[var(--border-primary)] hover:border-[var(--border-secondary)]'}`} aria-label={text(`历史版本 ${index + 1}`, `History version ${index + 1}`)}>
                  <img src={entry.imageUrl} alt={text(`历史版本 ${index + 1}`, `History version ${index + 1}`)} className={`h-full w-full object-cover ${imageClassName}`} />
                </button>
                {isCurrent && (
                  <span className="pointer-events-none absolute right-1 top-1 rounded-full border border-[var(--accent-border)] bg-[var(--accent-text)] p-1 text-[var(--bg-base)] shadow" title={text('当前图片', 'Current image')}>
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AssetImageHistoryStrip;
