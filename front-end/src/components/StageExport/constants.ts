/**
 * StageExport 样式常量和类型定义
 */

// 样式常量
export const STYLES = {
  // 主容器
  container: "flex flex-col h-full bg-[var(--bg-secondary)] overflow-hidden",
  
  // 头部
  header: {
    container: "h-16 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]/95 px-6 flex items-center justify-between shrink-0",
    title: "text-lg font-bold text-[var(--text-primary)] flex items-center gap-3",
    subtitle: "text-xs text-[var(--text-muted)] font-mono font-normal uppercase tracking-wider bg-[var(--bg-base)]/30 px-2 py-1 rounded",
    status: "text-[10px] text-[var(--text-tertiary)] font-mono uppercase bg-[var(--bg-elevated)] border border-[var(--border-primary)] px-2 py-1 rounded"
  },
  
  // 按钮样式
  button: {
    primary: "h-12 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--text-primary)] border border-[var(--accent)] shadow-lg shadow-[var(--accent-shadow)] rounded-lg flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-widest transition-all",
    secondary: "h-12 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] border border-[var(--btn-primary-bg)] shadow-lg shadow-[var(--btn-primary-shadow)] rounded-lg flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-widest transition-all",
    tertiary: "h-12 bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] border border-[var(--border-secondary)] hover:border-[var(--border-primary)] rounded-lg flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-widest transition-all",
    disabled: "h-12 bg-[var(--bg-elevated)] text-[var(--text-muted)] border border-[var(--border-primary)] cursor-not-allowed rounded-lg flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-widest transition-all",
    loading: "h-12 bg-[var(--accent)] text-[var(--text-primary)] border border-[var(--accent)] cursor-wait rounded-lg flex items-center justify-center gap-2 font-bold text-xs uppercase tracking-widest transition-all"
  },
  
  // 卡片样式
  card: {
    base: "p-5 bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl hover:border-[var(--border-secondary)] transition-colors group cursor-pointer flex flex-col justify-between h-32 relative overflow-hidden",
    active: "p-5 bg-[var(--bg-surface)] border border-[var(--accent)] cursor-wait rounded-xl transition-all flex flex-col justify-between h-32 relative overflow-hidden",
    loading: "absolute inset-0 bg-[var(--accent)]/20 backdrop-blur-sm flex flex-col items-center justify-center z-10"
  },
  
  // 模态框样式
  modal: {
    overlay: "fixed inset-0 bg-[var(--bg-base)]/80 backdrop-blur-sm flex items-center justify-center z-50 p-4",
    container: "bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl max-w-4xl w-full max-h-[80vh] flex flex-col shadow-2xl",
    header: "p-6 border-b border-[var(--border-primary)] flex items-center justify-between",
    content: "flex-1 overflow-y-auto p-6 space-y-2",
    footer: "p-4 border-t border-[var(--border-primary)] bg-[var(--bg-primary)] flex justify-end items-center"
  },
  
  // 视频播放器模态框
  videoModal: {
    overlay: "fixed inset-0 bg-[var(--bg-base)]/95 backdrop-blur-sm flex items-center justify-center z-50 p-4",
    container: "bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-xl max-w-6xl w-full flex flex-col shadow-2xl overflow-hidden",
    player: "bg-[var(--bg-base)] relative flex items-center justify-center overflow-hidden",
    controls: "p-4 border-t border-[var(--border-primary)] bg-[var(--bg-primary)] flex items-center justify-between shrink-0"
  },
  
  // 状态面板
  statusPanel: {
    container: "bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-xl p-8 shadow-2xl relative overflow-hidden group",
    decoration: {
      top: "absolute top-0 right-0 p-48 bg-[var(--accent-bg)] blur-[120px] rounded-full pointer-events-none",
      bottom: "absolute bottom-0 left-0 p-32 bg-[var(--success-bg)] blur-[100px] rounded-full pointer-events-none"
    },
    progressBadge: "text-right bg-[var(--bg-base)]/20 p-4 rounded-lg border border-[var(--overlay-border)] backdrop-blur-sm min-w-[160px]",
    stat: "flex flex-col",
    statLabel: "text-[9px] text-[var(--text-muted)] uppercase tracking-widest font-bold mb-0.5",
    statValue: "text-sm font-mono text-[var(--text-secondary)]"
  },
  
  // 时间线
  timeline: {
    container: "h-20 bg-[var(--bg-sunken)] rounded-lg border border-[var(--border-primary)] flex items-center px-2 gap-1 overflow-x-auto custom-scrollbar relative shadow-inner",
    segment: "h-14 min-w-[4px] flex-1 rounded-[2px] transition-all relative group flex flex-col justify-end overflow-hidden",
    segmentComplete: "bg-[var(--accent-bg-hover)] border border-[var(--accent-border)] hover:bg-[var(--accent-bg-hover)]",
    segmentIncomplete: "bg-[var(--bg-elevated)] border border-[var(--border-primary)] hover:bg-[var(--bg-hover)]",
    tooltip: "absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20 whitespace-nowrap"
  },
  
  // 日志项
  logItem: {
    container: "bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-lg overflow-hidden hover:border-[var(--border-secondary)] transition-colors",
    header: "p-4 cursor-pointer",
    details: "px-4 pb-4 border-t border-[var(--border-primary)] pt-3 space-y-3"
  },
  
  // 统计面板
  statsPanel: {
    container: "p-6 border-b border-[var(--border-primary)] bg-[var(--bg-primary)]",
    grid: "grid grid-cols-1 md:grid-cols-3 gap-4",
    card: "bg-[var(--bg-surface)] border border-[var(--border-primary)] rounded-lg p-4",
    label: "text-[10px] text-[var(--text-muted)] uppercase tracking-widest font-bold mb-1"
  }
};

// 状态颜色映射
export const STATUS_COLORS = {
  success: 'text-[var(--success-text)] bg-[var(--success-bg)] border-[var(--success-border)]',
  failed: 'text-[var(--error-text)] bg-[var(--error-bg)] border-[var(--error-border)]',
  pending: 'text-[var(--warning-text)] bg-[var(--warning-bg)] border-[var(--warning-border)]'
};

// 日志类型图标映射
export const LOG_TYPE_ICONS = {
  character: '👤',
  'character-variation': '👤',
  scene: '🎬',
  keyframe: '🖼️',
  video: '🎥',
  default: '📝'
};

// 下载状态类型
export interface DownloadState {
  isDownloading: boolean;
  phase: string;
  progress: number;
}

// 视频播放器状态类型
export interface VideoPlayerState {
  showVideoPlayer: boolean;
  currentShotIndex: number;
  isPlaying: boolean;
}
