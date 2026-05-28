import React from 'react';
import { Layers, Database, Clock, Loader2 } from 'lucide-react';
import { STYLES, DownloadState } from './constants';

interface Props {
  assetsDownloadState: DownloadState;
  onDownloadAssets: () => void;
  onShowLogs: () => void;
  onExportData: () => void;
  onImportData: () => void;
  isDataExporting: boolean;
  isDataImporting: boolean;
}

const SecondaryOptions: React.FC<Props> = ({
  assetsDownloadState,
  onDownloadAssets,
  onShowLogs,
  onExportData,
  onImportData,
  isDataExporting,
  isDataImporting
}) => {
  const { isDownloading, phase, progress } = assetsDownloadState;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      {/* Source Assets Download */}
      <div 
        onClick={onDownloadAssets}
        className={isDownloading ? STYLES.card.active : STYLES.card.base}
      >
        {isDownloading && (
          <div className={STYLES.card.loading}>
            <Loader2 className="w-6 h-6 text-[var(--accent-text)] animate-spin mb-2" />
            <p className="text-xs text-[var(--text-primary)] font-mono">{phase}</p>
            <div className="w-32 h-1 bg-[var(--bg-hover)] rounded-full overflow-hidden mt-2">
              <div className="h-full bg-[var(--accent)] transition-all duration-300" style={{ width: `${progress}%` }}></div>
            </div>
          </div>
        )}
        <Layers className={`w-5 h-5 mb-4 transition-colors ${
          isDownloading ? 'text-[var(--accent-text)]' : 'text-[var(--text-muted)] group-hover:text-[var(--accent-text)]'
        }`} />
        <div>
          <h4 className="text-sm font-bold text-[var(--text-primary)] mb-1">源素材</h4>
          <p className="text-[10px] text-[var(--text-tertiary)]">下载全部已生成图片和原始视频片段。</p>
        </div>
      </div>

      {/* Export / Import Data */}
      <div className={STYLES.card.base}>
        <Database className="w-5 h-5 text-[var(--text-muted)] group-hover:text-[var(--accent-text)] mb-4 transition-colors" />
        <div>
          <h4 className="text-sm font-bold text-[var(--text-primary)] mb-1">数据备份</h4>
          <p className="text-[10px] text-[var(--text-tertiary)]">导出当前剧集数据，或导入其他设备备份。</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onExportData();
              }}
              disabled={isDataExporting}
              className={
                isDataExporting
                  ? 'px-3 py-2 text-[10px] rounded-md bg-[var(--accent)]/70 text-[var(--text-primary)] cursor-wait'
                  : 'px-3 py-2 text-[10px] rounded-md bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border-secondary)]'
              }
            >
              {isDataExporting ? '导出中...' : '导出当前集'}
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onImportData();
              }}
              disabled={isDataImporting}
              className={
                isDataImporting
                  ? 'px-3 py-2 text-[10px] rounded-md bg-[var(--accent)]/70 text-[var(--text-primary)] cursor-wait'
                  : 'px-3 py-2 text-[10px] rounded-md bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:bg-[var(--border-secondary)]'
              }
            >
              {isDataImporting ? '导入中...' : '导入'}
            </button>
          </div>
        </div>
      </div>

      {/* Render Logs */}
      <div 
        onClick={onShowLogs}
        className={STYLES.card.base}
      >
        <Clock className="w-5 h-5 text-[var(--text-muted)] group-hover:text-[var(--accent-text)] mb-4 transition-colors" />
        <div>
          <h4 className="text-sm font-bold text-[var(--text-primary)] mb-1">渲染日志</h4>
          <p className="text-[10px] text-[var(--text-tertiary)]">查看生成历史与状态。</p>
        </div>
      </div>
    </div>
  );
};

export default SecondaryOptions;
