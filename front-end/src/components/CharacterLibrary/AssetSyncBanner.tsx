import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface OutdatedRef {
  assetId: string;
  syncedVersion: number;
}

interface Props {
  title: string;
  outdatedRefs: OutdatedRef[];
  resolveName: (assetId: string) => string;
  onSyncAll: () => void;
}

const AssetSyncBanner: React.FC<Props> = ({ title, outdatedRefs, resolveName, onSyncAll }) => {
  if (outdatedRefs.length === 0) return null;

  const names = outdatedRefs.map(ref => resolveName(ref.assetId));

  return (
    <div className="mx-4 mt-4 px-4 py-3 rounded-lg bg-[var(--accent-bg)] border border-[var(--accent-border)]">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-[var(--accent-text)] flex-shrink-0" />
          <div>
            <span className="text-xs font-medium text-[var(--accent-text)]">
              {outdatedRefs.length} updates available for {title}
            </span>
            <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{names.join(', ')}</p>
          </div>
        </div>
        <button
          onClick={onSyncAll}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--accent-bg-hover)] hover:bg-[var(--accent-border)] text-[var(--accent-text)] text-[10px] font-bold uppercase tracking-widest rounded transition-colors"
        >
          <RefreshCw className="w-3 h-3" />Sync All
        </button>
      </div>
    </div>
  );
};

export default AssetSyncBanner;
