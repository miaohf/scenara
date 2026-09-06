import React, { useState } from 'react';
import {
  FileText,
  Users,
  Clapperboard,
  Film,
  ChevronLeft,
  ListTree,
  Cpu,
  Sun,
  Moon,
  Loader2,
  FolderOpen,
  Video,
  Image as ImageIcon,
  Grid3x3,
  User,
  MapPin,
  Package,
  Shirt,
  Layers,
  Clock3,
  X,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import type { Episode } from '../types';
import { useGenerationQueue } from '../contexts/GenerationQueueContext';
import { describeJobTitle, formatJobProgressLabel, jobDisplayState, jobKind, primaryRunningJobId, type JobKind } from '../services/generationQueue';
import { cancelJob, type JobStatus } from '../services/aiApiAdapter';

interface SidebarProps {
  currentStage: string;
  setStage: (stage: 'script' | 'assets' | 'director' | 'export' | 'prompts') => void;
  onExit: () => void;
  projectName?: string;
  onShowModelConfig?: () => void;
  isNavigationLocked?: boolean;
  isBackgroundBusy?: boolean;
  episode?: Episode | null;
  episodeInfo?: { projectId: string; projectTitle: string; episodeTitle: string };
  onGoToProject?: () => void;
}

const JOB_KIND_ICON: Record<JobKind, typeof Video> = {
  video: Video,
  keyframe: ImageIcon,
  image: ImageIcon,
  nineGrid: Grid3x3,
  character: User,
  scene: MapPin,
  prop: Package,
  variation: Shirt,
  turnaround: Layers,
  other: Loader2,
};

const JOB_KIND_LABEL: Record<JobKind, string> = {
  video: '视频',
  keyframe: '关键帧',
  image: '图片',
  nineGrid: '网格',
  character: '角色',
  scene: '场景',
  prop: '道具',
  variation: '造型',
  turnaround: '三视图',
  other: '任务',
};

const Sidebar: React.FC<SidebarProps> = ({ currentStage, setStage, onExit, projectName, onShowModelConfig, isNavigationLocked, isBackgroundBusy, episode, episodeInfo, onGoToProject }) => {
  const { theme, toggleTheme } = useTheme();
  const { jobs, runningCount, queuedCount, upsertJob } = useGenerationQueue();
  const [cancellingIds, setCancellingIds] = useState<string[]>([]);
  const showQueue = !isNavigationLocked && (isBackgroundBusy || jobs.length > 0);
  const navItems = [
    { id: 'script', label: '剧本与故事', icon: FileText, sub: '阶段 01' },
    { id: 'assets', label: '角色与场景', icon: Users, sub: '阶段 02' },
    { id: 'director', label: '导演工作台', icon: Clapperboard, sub: '阶段 03' },
    { id: 'export', label: '成片与导出', icon: Film, sub: '阶段 04' },
    { id: 'prompts', label: '提示词管理', icon: ListTree, sub: '高级' },
  ];

  const runnerId = primaryRunningJobId(jobs);
  const runningJob = jobs.find((job) => job.id === runnerId);
  const runningProgress = typeof runningJob?.progress === 'number' ? runningJob.progress : null;

  const handleCancelQueueJob = async (job: JobStatus, event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (cancellingIds.includes(job.id)) return;
    setCancellingIds((current) => [...current, job.id]);
    try {
      const cancelled = await cancelJob(job.id);
      upsertJob(cancelled);
    } catch (error) {
      console.warn('取消任务失败:', error);
    } finally {
      setCancellingIds((current) => current.filter((id) => id !== job.id));
    }
  };

  const renderQueueJob = (job: JobStatus) => {
    const kind = jobKind(job);
    const Icon = JOB_KIND_ICON[kind];
    const running = jobDisplayState(job, jobs) === 'running';
    const title = describeJobTitle(job, episode);
    const kindLabel = kind === 'keyframe' && job.target?.kind === 'keyframe'
      ? (job.target.type === 'end' ? '尾帧' : '首帧')
      : JOB_KIND_LABEL[kind];
    const progressLabel = formatJobProgressLabel(job, running ? 'running' : 'queued');
    const cancelling = cancellingIds.includes(job.id);

    return (
      <li key={job.id} className="group/job space-y-1">
        <div className="flex items-center gap-2 text-[10px]">
          <span className={`shrink-0 ${running ? 'text-[var(--accent-text)]' : 'text-[var(--text-muted)]'}`} title={kindLabel}>
            <Icon className="w-3 h-3" />
          </span>
          <span className="min-w-0 flex-1 truncate text-[var(--text-secondary)]" title={`${title} · ${kindLabel}`}>
            {title}
          </span>
          <button
            type="button"
            onClick={(event) => void handleCancelQueueJob(job, event)}
            disabled={cancelling}
            className={`${cancelling ? 'inline-flex' : 'hidden group-hover/job:inline-flex'} shrink-0 items-center justify-center rounded p-0.5 text-[var(--error-text)] hover:bg-[var(--error)]/15 disabled:opacity-50`}
            title="取消任务"
          >
            {cancelling ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
          </button>
          <span className={`shrink-0 ${cancelling ? 'hidden' : 'group-hover/job:hidden'} ${running ? 'font-mono text-[var(--accent-text)]' : 'inline-flex items-center gap-0.5 font-mono text-[var(--text-muted)]'}`} title={running ? '生成中' : '排队'}>
            {running ? progressLabel : (
              <>
                <Clock3 className="w-3 h-3" />
                {progressLabel}
              </>
            )}
          </span>
        </div>
        {running && (
          <div className="h-0.5 rounded-full bg-[var(--bg-hover)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] transition-all duration-300"
              style={{ width: `${Math.max(typeof job.progress === 'number' ? job.progress : 0, 4)}%` }}
            />
          </div>
        )}
      </li>
    );
  };

  return (
    <aside className="w-72 bg-[var(--bg-base)] border-r border-[var(--border-primary)] h-screen fixed left-0 top-0 flex flex-col z-50 select-none">
      <div className="p-6 border-b border-[var(--border-subtle)]">
        <div className="flex items-center gap-3 mb-6">
          <img src="/logo.png" alt="Logo" className="w-8 h-8 flex-shrink-0" />
          <div className="overflow-hidden">
            <h1 className="text-sm font-bold text-[var(--text-primary)] tracking-wider">SCENARA</h1>
          </div>
        </div>
        <button
          onClick={onExit}
          className={`flex items-center gap-2 transition-colors text-xs font-mono uppercase tracking-wide group ${isNavigationLocked ? 'text-[var(--text-muted)] opacity-50 cursor-not-allowed' : 'text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'}`}
          title={isNavigationLocked ? '剧本任务进行中，离开会中断未完成的文本' : undefined}
        >
          <ChevronLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
          {episodeInfo ? '返回项目概览' : '返回项目列表'}
        </button>
      </div>

      <div className="px-6 py-4 border-b border-[var(--border-subtle)]">
        {episodeInfo ? (
          <>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-1">当前项目</div>
            <button onClick={onGoToProject} className="text-xs text-[var(--accent-text)] hover:underline truncate block mb-2 text-left">
              <FolderOpen className="w-3 h-3 inline mr-1" />{episodeInfo.projectTitle}
            </button>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-1">当前集数</div>
            <div className="text-sm font-medium text-[var(--text-secondary)] truncate font-mono">{episodeInfo.episodeTitle}</div>
          </>
        ) : (
          <>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-1">当前项目</div>
            <div className="text-sm font-medium text-[var(--text-secondary)] truncate font-mono">{projectName || '未命名项目'}</div>
          </>
        )}
      </div>

      {isNavigationLocked && (
        <div className="mx-4 mt-4 px-3 py-2.5 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/30">
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-[var(--warning)] animate-spin flex-shrink-0" />
            <span className="text-[10px] font-medium text-[var(--warning)] uppercase tracking-wide">剧本任务进行中</span>
          </div>
        </div>
      )}

      <nav className="flex-1 py-6 space-y-1 overflow-y-auto">
        {navItems.map((item) => {
          const isActive = currentStage === item.id;
          const isLocked = isNavigationLocked && !isActive;
          return (
            <button key={item.id} onClick={() => setStage(item.id as any)}
              className={`w-full flex items-center justify-between px-6 py-4 transition-all duration-200 group relative border-l-2 ${
                isActive ? 'border-[var(--text-primary)] bg-[var(--nav-active-bg)] text-[var(--text-primary)]'
                : isLocked ? 'border-transparent text-[var(--text-muted)] opacity-50 cursor-not-allowed'
                : 'border-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--nav-hover-bg)]'
              }`}
              title={isLocked ? '剧本任务进行中，离开会中断未完成的文本' : undefined}
            >
              <div className="flex items-center gap-3">
                <item.icon className={`w-4 h-4 ${isActive ? 'text-[var(--text-primary)]' : isLocked ? 'text-[var(--text-muted)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'}`} />
                <span className="font-medium text-xs tracking-wider uppercase">{item.label}</span>
              </div>
              <span className={`text-[10px] font-mono ${isActive ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-muted)]'}`}>{item.sub}</span>
            </button>
          );
        })}
      </nav>

      {showQueue && (
        <div
          className="mx-4 mb-3 px-3 py-2 rounded-lg bg-[var(--accent-bg)] border border-[var(--accent-border)]"
          title="结果会自动写回剧集，可切换页面"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Loader2 className="w-3.5 h-3.5 text-[var(--accent-text)] animate-spin shrink-0" />
              <span className="text-[10px] font-medium text-[var(--accent-text)] tracking-wide uppercase">
                ComfyUI Task Queue
              </span>
            </div>
            <span
              className="text-[10px] font-mono text-[var(--text-muted)] shrink-0"
              title={`${runningCount} 个生成中 · ${queuedCount} 个排队`}
            >
              {jobs.length === 0
                ? '…'
                : runningCount > 0
                  ? `${runningProgress ?? 0}% · ${runningCount}/${jobs.length}`
                  : `排队 ${jobs.length}`}
            </span>
          </div>
          {jobs.length > 0 && (
            <ul className="mt-2 space-y-1.5 max-h-56 overflow-y-scroll pr-1 custom-scrollbar">
              {jobs.map(renderQueueJob)}
            </ul>
          )}
        </div>
      )}

      <div className="p-6 border-t border-[var(--border-subtle)] space-y-4">
        <button onClick={toggleTheme} className="w-full flex items-center justify-between text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer transition-colors" title={theme === 'dark' ? '切换亮色主题' : '切换暗色主题'}>
          <span className="font-mono text-[10px] uppercase tracking-widest">{theme === 'dark' ? '亮色主题' : '暗色主题'}</span>
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        {onShowModelConfig && (
          <button onClick={onShowModelConfig} className="w-full flex items-center justify-between text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer transition-colors">
            <span className="font-mono text-[10px] uppercase tracking-widest">模型配置</span>
            <Cpu className="w-4 h-4" />
          </button>
        )}
      </div>
    </aside>
  );
};

export default Sidebar;
