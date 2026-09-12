import React from 'react';
import { Play, Download, FileVideo, Loader2 } from 'lucide-react';
import { DownloadState } from './constants';
import { useAlert } from '../GlobalAlert';
import { MasterExportMode, MasterVideoQuality } from '../../services/exportService';
import BilingualLabel from '../BilingualLabel';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface Props {
  completedShotsCount: number;
  totalShots: number;
  progress: number;
  downloadState: DownloadState;
  exportMode: MasterExportMode;
  exportQuality: MasterVideoQuality;
  onExportModeChange: (mode: MasterExportMode) => void;
  onExportQualityChange: (quality: MasterVideoQuality) => void;
  onPreview: () => void;
  onDownloadMaster: () => void;
}

const ActionButtons: React.FC<Props> = ({
  completedShotsCount,
  totalShots,
  progress,
  downloadState,
  exportMode,
  exportQuality,
  onExportModeChange,
  onExportQualityChange,
  onPreview,
  onDownloadMaster
}) => {
  const { showAlert } = useAlert();
  const { text } = useInterfaceLanguage();
  const { isDownloading, phase, progress: downloadProgress } = downloadState;
  const canDownloadMaster = progress === 100;
  const canDownloadSegments = completedShotsCount > 0;
  const canDownloadByMode = exportMode === 'segments-zip' ? canDownloadSegments : canDownloadMaster;

  const modeLabel = exportMode === 'segments-zip'
    ? text('下载分镜 ZIP', 'DOWNLOAD SHOT ZIP')
    : text('下载母版（WEBM）', 'DOWNLOAD MASTER (WEBM)');
  const cardBase = 'min-h-[156px] rounded-xl border border-[var(--border-primary)] bg-[var(--bg-surface)] p-4 flex flex-col justify-between shadow-sm';
  const titleClass = 'text-xs font-bold text-[var(--text-primary)] uppercase tracking-wider';
  const descClass = 'text-[10px] leading-relaxed text-[var(--text-tertiary)]';
  const ghostActionClass = 'h-10 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-elevated)] text-[var(--text-secondary)] hover:border-[var(--border-secondary)] hover:text-[var(--text-primary)] transition-colors text-xs font-semibold flex items-center justify-center gap-2';
  const disabledActionClass = 'h-10 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-elevated)] text-[var(--text-muted)] cursor-not-allowed text-xs font-semibold flex items-center justify-center gap-2';
  const primaryActionClass = 'h-10 rounded-lg border border-[var(--accent-border)] bg-[var(--accent)] text-[var(--accent-text)] hover:bg-[var(--accent-hover)] transition-colors text-xs font-bold flex items-center justify-center gap-2';
  const darkActionClass = 'h-10 rounded-lg border border-black/20 bg-black text-white hover:bg-black/90 transition-colors text-xs font-bold flex items-center justify-center gap-2';
  const loadingActionClass = 'h-10 rounded-lg border border-[var(--accent-border)] bg-[var(--accent)] text-[var(--accent-text)] cursor-wait text-xs font-bold flex items-center justify-center gap-2';

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
      <div className={cardBase}>
        <div className="space-y-1.5">
          <p className={titleClass}><BilingualLabel primary="预览校验" secondary="PREVIEW" /></p>
          <p className={descClass}>{text('快速检查镜头顺序与生成完整度', 'Review sequence and completeness')}</p>
        </div>
        <button
          onClick={onPreview}
          disabled={completedShotsCount === 0}
          className={
            completedShotsCount > 0 ? primaryActionClass : disabledActionClass
          }
        >
          <Play className="w-4 h-4" />
          {text('预览', 'PREVIEW')} ({completedShotsCount}/{totalShots})
        </button>
      </div>

      <div className={cardBase}>
        <div className="space-y-2">
          <p className={titleClass}><BilingualLabel primary="导出设置" secondary="EXPORT" /></p>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={exportMode}
              onChange={(event) => onExportModeChange(event.target.value as MasterExportMode)}
              disabled={isDownloading}
              className="h-8 bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-[var(--text-secondary)] rounded px-2 text-[11px] focus:outline-none"
            >
              <option value="master-video">{text('母版拼接', 'Master video')}</option>
              <option value="segments-zip">{text('分镜打包', 'Shot ZIP')}</option>
            </select>
            {exportMode === 'master-video' ? (
              <select
                value={exportQuality}
                onChange={(event) => onExportQualityChange(event.target.value as MasterVideoQuality)}
                disabled={isDownloading}
                className="h-8 bg-[var(--bg-elevated)] border border-[var(--border-primary)] text-[var(--text-secondary)] rounded px-2 text-[11px] focus:outline-none"
              >
                <option value="economy">{text('省流', 'Economy')}</option>
                <option value="balanced">{text('均衡', 'Balanced')}</option>
                <option value="pro">{text('高画质', 'Pro')}</option>
              </select>
            ) : (
              <div className="h-8 rounded border border-transparent bg-transparent" aria-hidden="true" />
            )}
          </div>
          <p className={descClass}>
            {exportMode === 'segments-zip'
              ? '分镜ZIP适合自己在剪辑软件二次创作。'
              : '母版拼接适合快速交付，质量档位会影响文件体积。'}
          </p>
        </div>
        <button
          onClick={onDownloadMaster}
          disabled={!canDownloadByMode || isDownloading}
          className={
            isDownloading
              ? loadingActionClass
              : canDownloadByMode
                ? darkActionClass
                : disabledActionClass
          }
        >
          {isDownloading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Download className="w-4 h-4" />
          )}
          {isDownloading ? `${phase} ${downloadProgress}%` : modeLabel}
        </button>
      </div>

      <div className={cardBase}>
        <div className="space-y-1.5">
          <p className={titleClass}><BilingualLabel primary="剪辑工程" secondary="NLE PROJECT" /></p>
          <p className={descClass}>{text('导出 PR、FCP 或达芬奇工程模板', 'Continue editing with your team')}</p>
        </div>
        <button
          className={ghostActionClass}
          onClick={() => showAlert('暂未开发', { type: 'info', title: '提示' })}
        >
          <FileVideo className="w-4 h-4" />
          {text('导出工程', 'EXPORT PROJECT')}
        </button>
      </div>
    </div>
  );
};

export default ActionButtons;
