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
  PanelLeftClose,
  PanelLeftOpen,
  Languages,
} from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import type { Episode } from '../types';
import { useGenerationQueue } from '../contexts/GenerationQueueContext';
import { describeJobTitle, formatJobProgressLabel, jobDisplayState, jobKind, primaryRunningJobId, type JobKind } from '../services/generationQueue';
import { cancelJob, type JobStatus } from '../services/aiApiAdapter';
import LanguageModeSelector from './LanguageModeSelector';
import { useInterfaceLanguage } from '../contexts/InterfaceLanguageContext';

interface SidebarProps {
  currentStage: string;
  setStage: (stage: 'script' | 'assets' | 'director' | 'export' | 'prompts') => void;
  onExit: () => void;
  onGoHome?: () => void;
  projectName?: string;
  onShowModelConfig?: () => void;
  isNavigationLocked?: boolean;
  isBackgroundBusy?: boolean;
  episode?: Episode | null;
  episodeInfo?: { projectId: string; projectTitle: string; episodeTitle: string };
  onGoToProject?: () => void;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

type StageId = Parameters<SidebarProps['setStage']>[0];

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
  threeView: Layers,
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
  turnaround: '九宫格',
  threeView: '三视图',
  other: '任务',
};

const Sidebar: React.FC<SidebarProps> = ({ currentStage, setStage, onExit, onGoHome, projectName, onShowModelConfig, isNavigationLocked, isBackgroundBusy, episode, episodeInfo, onGoToProject, collapsed = false, onCollapsedChange }) => {
  const { theme, toggleTheme } = useTheme();
  const { language, setLanguage, text } = useInterfaceLanguage();
  const { jobs, runningCount, queuedCount, upsertJob } = useGenerationQueue();
  const [cancellingIds, setCancellingIds] = useState<string[]>([]);
  const showQueue = !isNavigationLocked && (isBackgroundBusy || jobs.length > 0);
  const navItems: Array<{ id: StageId; label: string; english: string; icon: typeof FileText }> = [
    { id: 'script', label: '剧本策划', english: 'Story Planning', icon: FileText },
    { id: 'assets', label: '视觉设定', english: 'Visual Development', icon: Users },
    { id: 'director', label: '镜头设计', english: 'Shot Design', icon: Clapperboard },
    { id: 'export', label: '剪辑交付', english: 'Delivery', icon: Film },
    { id: 'prompts', label: '提示词库', english: 'Prompt Library', icon: ListTree },
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
    <aside className={`${collapsed ? 'w-20' : 'w-72'} bg-[var(--bg-base)] border-r border-[var(--border-primary)] h-screen fixed left-0 top-0 flex flex-col z-50 select-none transition-[width] duration-300 ease-out`}>
      <button
        type="button"
        onClick={() => onCollapsedChange?.(!collapsed)}
        className="absolute -right-3 top-[5.25rem] z-10 flex h-7 w-7 items-center justify-center rounded-full border border-[var(--border-secondary)] bg-[var(--bg-surface)] text-[var(--text-muted)] shadow-lg transition-all hover:border-[var(--accent-border)] hover:text-[var(--accent-text)]"
        title={collapsed ? text('展开侧栏', 'Expand sidebar') : text('收起侧栏', 'Collapse sidebar')}
        aria-label={collapsed ? text('展开侧栏', 'Expand sidebar') : text('收起侧栏', 'Collapse sidebar')}
      >
        {collapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />}
      </button>

      <div className={`${collapsed ? 'px-3 pb-4 pt-5' : 'px-5 pb-5 pt-6'} border-b border-[var(--border-subtle)]`}>
        <button
          type="button"
          onClick={onGoHome || onExit}
          className={`${collapsed ? 'mx-auto mb-0 justify-center' : 'mb-5'} flex items-center gap-3 text-left transition-opacity hover:opacity-80`}
          title={text('返回项目列表', 'Back to projects')}
        >
          <img src="/logo.png" alt="Logo" className={`${collapsed ? 'h-10 w-10' : 'h-9 w-9'} flex-shrink-0 rounded-lg`} />
          {!collapsed && <div className="min-w-0 overflow-hidden">
            <h1 className="whitespace-nowrap text-base font-bold leading-none text-[var(--text-primary)] tracking-[0.16em]">SCENARA</h1>
            <p className="mt-1.5 whitespace-nowrap font-mono text-[8px] font-medium tracking-[0.19em] text-[var(--text-muted)]">
              AI STORY STUDIO
            </p>
          </div>}
        </button>
        {!collapsed && <button
          type="button"
          onClick={onExit}
          className="flex items-center gap-2 text-xs font-mono uppercase tracking-wide text-[var(--text-tertiary)] transition-colors group hover:text-[var(--text-primary)]"
          title={isNavigationLocked ? text('离开会中断未完成的剧本文本；生图/视频会在后台继续', 'Leaving interrupts unfinished script text; image and video jobs continue in the background') : undefined}
        >
          <ChevronLeft className="w-3 h-3 group-hover:-translate-x-1 transition-transform" />
          {episodeInfo ? text('返回项目概览', 'Back to project') : text('返回项目列表', 'Back to projects')}
        </button>}
      </div>

      {!collapsed && <div className="px-6 py-4 border-b border-[var(--border-subtle)]">
        {episodeInfo ? (
          <>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-1">{text('当前项目', 'CURRENT PROJECT')}</div>
            <button onClick={onGoToProject} className="text-xs text-[var(--accent-text)] hover:underline truncate block mb-2 text-left">
              <FolderOpen className="w-3 h-3 inline mr-1" />{episodeInfo.projectTitle}
            </button>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-1">{text('当前分集', 'CURRENT EPISODE')}</div>
            <div className="text-sm font-medium text-[var(--text-secondary)] truncate font-mono">{episodeInfo.episodeTitle}</div>
          </>
        ) : (
          <>
            <div className="text-[10px] text-[var(--text-muted)] uppercase tracking-widest mb-1">{text('当前项目', 'CURRENT PROJECT')}</div>
            <div className="text-sm font-medium text-[var(--text-secondary)] truncate font-mono">{projectName || text('未命名项目', 'Untitled project')}</div>
          </>
        )}
      </div>}

      {isNavigationLocked && !collapsed && (
        <div className="mx-4 mt-4 px-3 py-2.5 rounded-lg bg-[var(--warning)]/10 border border-[var(--warning)]/30">
          <div className="flex items-center gap-2">
            <Loader2 className="w-3.5 h-3.5 text-[var(--warning)] animate-spin flex-shrink-0" />
            <span className="text-[10px] font-medium text-[var(--warning)] uppercase tracking-wide">{text('剧本任务进行中，仍可返回项目列表', 'SCRIPT TASK RUNNING — YOU CAN STILL RETURN TO PROJECTS')}</span>
          </div>
        </div>
      )}

      <nav className={`${collapsed ? 'px-2 py-5' : 'px-3 py-5'} flex-1 space-y-2 overflow-y-auto`}>
        {navItems.map((item) => {
          const isActive = currentStage === item.id;
          const isLocked = isNavigationLocked && !isActive;
          return (
            <button key={item.id} onClick={() => setStage(item.id)}
              className={`relative flex w-full items-center rounded-xl border py-3.5 text-left transition-all duration-200 group ${collapsed ? 'justify-center px-2' : 'px-3'} ${
                isActive ? 'border-[var(--accent-border)] bg-[var(--nav-active-bg)] text-[var(--text-primary)] shadow-[0_8px_24px_rgba(0,0,0,0.16)]'
                : isLocked ? 'border-transparent text-[var(--text-muted)] opacity-50 cursor-not-allowed'
                : 'border-transparent text-[var(--text-tertiary)] hover:border-[var(--border-primary)] hover:text-[var(--text-secondary)] hover:bg-[var(--nav-hover-bg)]'
              }`}
              title={isLocked ? text('剧本任务进行中，离开会中断未完成的文本', 'A script task is running; leaving interrupts unfinished text') : collapsed ? text(item.label, item.english) : undefined}
            >
              {isActive && <span className={`absolute ${collapsed ? '-left-2' : '-left-3'} h-6 w-[3px] rounded-full bg-[var(--accent)] shadow-[0_0_10px_var(--accent)]`} />}
              <div className="flex items-center gap-3.5">
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-all ${isActive ? 'border-[var(--accent-border)] bg-[var(--accent-bg)]' : 'border-transparent bg-transparent group-hover:border-[var(--border-primary)] group-hover:bg-[var(--bg-elevated)]/60'}`}>
                  <item.icon strokeWidth={isActive ? 2 : 1.65} className={`w-[17px] h-[17px] ${isActive ? 'text-[var(--accent-text)]' : isLocked ? 'text-[var(--text-muted)]' : 'text-[var(--text-muted)] group-hover:text-[var(--text-secondary)]'}`} />
                </span>
                {!collapsed && <span className={`whitespace-nowrap font-sans text-[13px] tracking-[0.055em] transition-colors ${isActive ? 'font-semibold text-[var(--text-primary)]' : 'font-medium'}`}>
                  {text(item.label, item.english)}
                </span>}
              </div>
            </button>
          );
        })}
      </nav>

      {showQueue && !collapsed && (
        <div
          className="mx-4 mb-3 px-3 py-2 rounded-lg bg-[var(--accent-bg)] border border-[var(--accent-border)]"
          title={text('结果会自动写回剧集，可切换页面', 'Results are saved to the episode automatically; you may switch pages')}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Loader2 className="w-3.5 h-3.5 text-[var(--accent-text)] animate-spin shrink-0" />
              <span className="text-[10px] font-medium text-[var(--accent-text)] tracking-wide uppercase">
                {text('生成队列', 'GENERATION QUEUE')}
              </span>
            </div>
            <span
              className="text-[10px] font-mono text-[var(--text-muted)] shrink-0"
              title={text(`${runningCount} 个生成中 · ${queuedCount} 个排队`, `${runningCount} running · ${queuedCount} queued`)}
            >
              {jobs.length === 0
                ? '…'
                : runningCount > 0
                  ? `${runningProgress ?? 0}% · ${runningCount}/${jobs.length}`
                  : text(`排队 ${jobs.length}`, `${jobs.length} queued`)}
            </span>
          </div>
          {jobs.length > 0 && (
            <ul className="mt-2 space-y-1.5 max-h-56 overflow-y-scroll pr-1 custom-scrollbar">
              {jobs.map(renderQueueJob)}
            </ul>
          )}
        </div>
      )}

      {!collapsed ? <div className="mx-3 mb-3 space-y-1.5 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-3 shadow-sm">
        <LanguageModeSelector className="mb-2 justify-between" />
        <button onClick={toggleTheme} className="w-full flex items-center justify-between rounded-lg px-2 py-2 text-[var(--text-muted)] hover:bg-[var(--nav-hover-bg)] hover:text-[var(--text-primary)] cursor-pointer transition-colors" title={theme === 'dark' ? text('切换亮色主题', 'Switch to light theme') : text('切换暗色主题', 'Switch to dark theme')}>
          <span className="font-mono text-[10px] uppercase tracking-widest">
            {theme === 'dark' ? text('亮色主题', 'LIGHT THEME') : text('暗色主题', 'DARK THEME')}
          </span>
          {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        {onShowModelConfig && (
          <button onClick={onShowModelConfig} className="w-full flex items-center justify-between rounded-lg px-2 py-2 text-[var(--text-muted)] hover:bg-[var(--nav-hover-bg)] hover:text-[var(--text-primary)] cursor-pointer transition-colors">
            <span className="font-mono text-[10px] uppercase tracking-widest">{text('模型配置', 'MODEL SETTINGS')}</span>
            <Cpu className="w-4 h-4" />
          </button>
        )}
      </div> : <div className="mx-2 mb-3 flex flex-col items-center gap-1.5 rounded-2xl border border-[var(--border-primary)] bg-[var(--bg-primary)] p-2 shadow-sm">
        <button
          type="button"
          onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
          className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-[var(--nav-hover-bg)] hover:text-[var(--text-primary)]"
          title={text('切换到英文', 'Switch to Chinese')}
        >
          <Languages className="h-4 w-4" />
        </button>
        <button type="button" onClick={toggleTheme} className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-[var(--nav-hover-bg)] hover:text-[var(--text-primary)]" title={theme === 'dark' ? text('切换亮色主题', 'Switch to light theme') : text('切换暗色主题', 'Switch to dark theme')}>
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        {onShowModelConfig && <button type="button" onClick={onShowModelConfig} className="flex h-10 w-10 items-center justify-center rounded-xl text-[var(--text-muted)] transition-colors hover:bg-[var(--nav-hover-bg)] hover:text-[var(--text-primary)]" title={text('模型配置', 'Model settings')}>
          <Cpu className="h-4 w-4" />
        </button>}
      </div>}
    </aside>
  );
};

export default Sidebar;
