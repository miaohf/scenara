import React, { useMemo } from 'react';
import { BookOpen, Wand2, BrainCircuit, AlertCircle, ChevronRight } from 'lucide-react';
import OptionSelector from './OptionSelector';
import { DURATION_OPTIONS, LANGUAGE_OPTIONS, VISUAL_STYLE_OPTIONS, STYLES } from './constants';
import VisualStyleProfileEditor from './VisualStyleProfileEditor';
import type { VisualStyleProfile } from '../../types';
import ModelSelector from '../ModelSelector';
import { getChatModelApiName } from '../../services/modelRegistry';
import { parseDurationToSeconds } from '../../services/durationParser';
import BilingualLabel from '../BilingualLabel';
import { useInterfaceLanguage } from '../../contexts/InterfaceLanguageContext';

interface Props {
  title: string;
  duration: string;
  language: string;
  model: string;
  visualStyle: string;
  customDurationInput: string;
  customModelInput: string;
  isProcessing: boolean;
  error: string | null;
  onShowModelConfig?: () => void;
  onTitleChange: (value: string) => void;
  onDurationChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onVisualStyleChange: (value: string) => void;
  onVisualStylePreview?: (value: string) => void;
  onCustomDurationChange: (value: string) => void;
  onCustomModelChange: (value: string) => void;
  visualStyleProfiles?: VisualStyleProfile[];
  generatingStylePreviewKeys?: string[];
  onSaveVisualStyleProfile?: (profile: VisualStyleProfile) => void;
  onGenerateStylePreview?: (profile: VisualStyleProfile) => void;
  onDeleteVisualStyle?: (profile: VisualStyleProfile) => void;
  onAddVisualStyle?: () => void;
  onInferVisualStyleProfile?: (file: File) => Promise<{ stylePrompt: string; negativePrompt?: string; styleLabel?: string; previewImage: string }>;
  styleCreateRequest?: number;
  onRegenerateStylePreview?: (styleKey: string) => void;
  onApplyVisualStylePreview?: (styleKey: string) => void;
  enableQualityCheck: boolean;
  onToggleQualityCheck: (value: boolean) => void;
  onAnalyze: () => void;
  onGenerateFramework?: () => void;
  onGenerateVisuals?: () => void;
  canGenerateVisuals?: boolean;
  analyzeButtonLabel?: string;
  canCancelAnalyze?: boolean;
  onCancelAnalyze?: () => void;
}

const formatDuration = (totalSeconds: number): string => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const parts: string[] = [];

  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
};

const ConfigPanel: React.FC<Props> = ({
  title,
  duration,
  language,
  model,
  visualStyle,
  customDurationInput,
  customModelInput,
  isProcessing,
  error,
  onShowModelConfig,
  onTitleChange,
  onDurationChange,
  onLanguageChange,
  onModelChange,
  onVisualStyleChange,
  onVisualStylePreview,
  onCustomDurationChange,
  onCustomModelChange,
  visualStyleProfiles = [],
  generatingStylePreviewKeys = [],
  onSaveVisualStyleProfile,
  onGenerateStylePreview,
  onDeleteVisualStyle,
  onAddVisualStyle,
  onInferVisualStyleProfile,
  styleCreateRequest = 0,
  onRegenerateStylePreview,
  onApplyVisualStylePreview,
  enableQualityCheck,
  onToggleQualityCheck,
  onAnalyze,
  onGenerateFramework,
  onGenerateVisuals,
  canGenerateVisuals = false,
  analyzeButtonLabel,
  canCancelAnalyze,
  onCancelAnalyze
}) => {
  const { text } = useInterfaceLanguage();
  const rawDurationValue = duration === 'custom' ? customDurationInput : duration;
  const parsedDurationSeconds = parseDurationToSeconds(rawDurationValue);
  const hasDurationInput = rawDurationValue.trim().length > 0;
  const visualStyleOptions = useMemo(
    () => {
      const presets = VISUAL_STYLE_OPTIONS.filter((option) => !visualStyleProfiles.some((profile) => profile.styleKey === option.value && profile.deleted)).map((option) => {
        const override = visualStyleProfiles.find((profile) => profile.styleKey === option.value && !profile.deleted);
        return { ...option, previewImage: override?.previewImage || option.previewImage };
      });
      const customProfiles = visualStyleProfiles
        .filter((profile) => profile.styleKey?.startsWith('custom:') && !profile.deleted)
        .map((profile) => ({ label: `✨ ${profile.label}`, value: profile.styleKey as string, desc: '共享自定义视觉风格', previewImage: profile.previewImage }));
      return [...presets, ...customProfiles];
    },
    [visualStyleProfiles]
  );

  return (
    <div className="w-96 border-r border-[var(--border-primary)] flex flex-col bg-[var(--bg-primary)]">
      <div className="h-14 px-5 border-b border-[var(--border-primary)] flex items-center justify-between shrink-0">
        <h2 className="text-sm font-bold text-[var(--text-primary)] tracking-wide flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-[var(--text-tertiary)]" />
          <BilingualLabel primary="剧本策划" secondary="STORY PLANNING" mode="stacked" />
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        <div className="space-y-2">
          <label className={STYLES.label}>{text('项目标题', 'Project Title')}</label>
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            className={STYLES.input}
            placeholder={text('输入项目名称...', 'Enter project title...')}
          />
        </div>

        <div className="space-y-2">
          <label className={STYLES.label}>{text('输出语言', 'Output Language')}</label>
          <div className="relative">
            <select
              value={language}
              onChange={(e) => onLanguageChange(e.target.value)}
              className={STYLES.select}
            >
              {LANGUAGE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <div className="absolute right-3 top-3 pointer-events-none">
              <ChevronRight className="w-4 h-4 text-[var(--text-muted)] rotate-90" />
            </div>
          </div>
        </div>

        <OptionSelector
          label={text('目标时长', 'Target Duration')}
          options={DURATION_OPTIONS}
          value={duration}
          onChange={onDurationChange}
          customInput={customDurationInput}
          onCustomInputChange={onCustomDurationChange}
          customPlaceholder={text('输入时长（如 90s、3m）', 'Enter duration (e.g. 90s, 3m)')}
          gridCols={2}
        />

        <div className="mt-2 text-[10px] leading-relaxed">
          {parsedDurationSeconds !== null ? (
            <p className="text-[var(--text-tertiary)]">
              {text('当前将按', 'Planning shots for')} <span className="font-mono text-[var(--text-secondary)]">{parsedDurationSeconds}s</span>
              （{formatDuration(parsedDurationSeconds)}）{text('规划分镜。', ' total.')}
            </p>
          ) : hasDurationInput ? (
            <p className="text-[var(--error)]">
              {text('时长格式无效。支持示例：90s、3m、3min、2m30s、2:30。', 'Invalid duration. Examples: 90s, 3m, 3min, 2m30s, 2:30.')}
            </p>
          ) : (
            <p className="text-[var(--text-muted)]">{text('支持格式：90s、3m、3min、2m30s、2:30。', 'Supported formats: 90s, 3m, 3min, 2m30s, 2:30.')}</p>
          )}
        </div>

        <div className="space-y-2">
          <ModelSelector
            type="chat"
            value={model}
            onChange={onModelChange}
            disabled={isProcessing}
            label={text('分镜描述模型', 'Storyboard Model')}
          />
          <p className="text-[9px] text-[var(--text-muted)]">
            {text('与「模型配置 → CHAT → 当前使用」同步，剧本分镜与九宫格镜头描述共用此模型。当前 API：', 'Synced with Model Configuration → CHAT → Active model. Storyboards and shot grids share this model. Current API:')}
            <span className="font-mono text-[var(--text-secondary)] ml-1">{getChatModelApiName(model) || '未配置'}</span>
            {text('。可在', '. Open')}
            <button
              type="button"
              onClick={onShowModelConfig}
              className="mx-1 text-[var(--accent-text)] hover:text-[var(--accent-text-hover)] underline underline-offset-2 transition-colors"
            >
              {text('模型配置', 'Model Configuration')}
            </button>
            {text('中切换或添加模型。', ' to switch or add models.')}
          </p>
        </div>

        <OptionSelector
          label={text('视觉风格', 'Visual Style')}
          icon={<Wand2 className="w-3 h-3" />}
          options={visualStyleOptions}
          value={visualStyle}
          onChange={onVisualStyleChange}
          onPreviewChange={onVisualStylePreview}
          previewOnly
          gridCols={2}
          labelAction={onSaveVisualStyleProfile ? (
            <button type="button" onClick={() => onAddVisualStyle?.()} className="rounded border border-[var(--border-secondary)] px-2 py-1 text-[10px] text-[var(--text-secondary)] hover:border-[var(--accent-border)] hover:text-[var(--text-primary)]">＋ {text('新增', 'Add')}</button>
          ) : undefined}
          onRegeneratePreview={onRegenerateStylePreview}
          onApplyPreview={onApplyVisualStylePreview}
          generatingPreviewValues={generatingStylePreviewKeys}
          managementSlot={onSaveVisualStyleProfile && onGenerateStylePreview ? (previewStyleKey) => (
            <VisualStyleProfileEditor
              styleKey={previewStyleKey}
              customPrompt=""
              profiles={visualStyleProfiles}
              isGenerating={generatingStylePreviewKeys.includes(previewStyleKey)}
              onSave={onSaveVisualStyleProfile}
              onGeneratePreview={onGenerateStylePreview}
              onDelete={onDeleteVisualStyle}
              onInferFromImage={onInferVisualStyleProfile}
              createRequest={styleCreateRequest}
              compact
            />
          ) : undefined}
        />

        <div className="space-y-2">
          <label className={STYLES.label}>{text('质量控制', 'Quality Control')}</label>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]/40 px-3 py-2">
            <input
              type="checkbox"
              checked={enableQualityCheck}
              onChange={(e) => onToggleQualityCheck(e.target.checked)}
              disabled={isProcessing}
              className="mt-0.5 h-4 w-4 rounded border-[var(--border-primary)] bg-[var(--bg-primary)] text-[var(--accent-text)]"
            />
            <span className="text-xs text-[var(--text-secondary)]">
              {text('启用分镜质量校验与自动修复（推荐）', 'Enable storyboard quality checks and auto-repair (recommended)')}
            </span>
          </label>
          <p className="text-[10px] text-[var(--text-muted)]">
            {text('开启后按目标态执行：故事层门禁 → 结构审片（可自动删/并叠戏）→ 字段审片（改文案，不增删镜）。', 'Runs target-state checks: story gate → structure review (may remove/merge beats) → field review (rewrites copy without adding or removing shots).')}
          </p>
        </div>
      </div>

      <div className="p-6 border-t border-[var(--border-primary)] bg-[var(--bg-primary)]">
        <div className="mb-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onGenerateFramework}
            disabled={isProcessing}
            className={`rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors ${isProcessing ? STYLES.button.disabled : STYLES.button.secondary}`}
            title={text('只生成镜头、动作、角色和道具关系；提示词和资产图稍后处理。', 'Generate the shot structure first; create prompts and asset images later.')}
          >
            {text('生成分镜框架', 'Generate Framework')}
          </button>
          <button
            type="button"
            onClick={onGenerateVisuals}
            disabled={isProcessing || !canGenerateVisuals}
            className={`rounded-lg border px-2 py-2 text-[11px] font-semibold transition-colors ${isProcessing || !canGenerateVisuals ? STYLES.button.disabled : STYLES.button.secondary}`}
            title={text('只补全缺失的角色、场景和道具提示词，不覆盖手动修改。', 'Fill only missing asset prompts without overwriting manual edits.')}
          >
            {text('补全资产提示词', 'Fill Asset Prompts')}
          </button>
        </div>
        <button
          onClick={onAnalyze}
          disabled={isProcessing}
          className={`w-full py-3.5 font-bold text-xs tracking-widest uppercase rounded-lg flex items-center justify-center gap-2 transition-all shadow-lg ${
            isProcessing
              ? STYLES.button.disabled
              : STYLES.button.primary
          }`}
        >
          {isProcessing ? (
            <>
              <BrainCircuit className="w-4 h-4 animate-spin" />
              {text('智能分析中...', 'Analyzing…')}
            </>
          ) : (
            <>
              <Wand2 className="w-4 h-4" />
              {analyzeButtonLabel || text('生成分镜脚本', 'Generate Storyboard')}
            </>
          )}
        </button>

        {isProcessing && canCancelAnalyze && onCancelAnalyze && (
          <button
            type="button"
            onClick={onCancelAnalyze}
            className={`mt-2 w-full rounded-lg border px-3 py-2 text-xs font-semibold tracking-wide transition-colors ${STYLES.button.secondary}`}
          >
            {text('取消生成', 'Cancel Generation')}
          </button>
        )}

        {error && (
          <div className="mt-4 p-3 bg-[var(--error-bg)] border border-[var(--error-border)] text-[var(--error)] text-xs rounded flex items-center gap-2">
            <AlertCircle className="w-3 h-3 flex-shrink-0" />
            {error}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConfigPanel;
