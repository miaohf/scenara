import { VISUAL_STYLE_PROMPTS as AI_VISUAL_STYLE_PROMPTS } from '../../services/ai/promptConstants';
import type { StoryboardGridLayoutMeta, StoryboardGridPanelCount } from '../../types';
import {
  NINE_GRID_SPLIT_PROMPT as SHARED_NINE_GRID_SPLIT_PROMPT,
  NINE_GRID_IMAGE_PROMPT_TEMPLATE as SHARED_NINE_GRID_IMAGE_PROMPT_TEMPLATE,
} from '../../services/ai/storyboardPromptTemplates';

// UI样式常量
export const STYLES = {
  // 容器样式
  mainContainer: "flex flex-col h-full bg-[var(--bg-secondary)] relative overflow-hidden",
  toolbar: "h-16 border-b border-[var(--border-primary)] bg-[var(--bg-elevated)] px-6 flex items-center justify-between shrink-0",
  workbench: "w-[480px] bg-[var(--bg-deep)] flex flex-col h-full shadow-2xl animate-in slide-in-from-right-10 duration-300 relative z-20",
  workbenchHeader: "h-16 px-6 border-b border-[var(--border-primary)] flex items-center justify-between bg-[var(--bg-surface)] shrink-0",
  workbenchContent: "flex-1 overflow-y-auto p-6 space-y-8",
  
  // 卡片样式
  card: "group relative flex flex-col bg-[var(--bg-elevated)] border rounded-xl overflow-hidden cursor-pointer transition-all duration-200",
  cardActive: "border-[var(--accent)] ring-1 ring-[var(--accent-border)] shadow-xl scale-[0.98]",
  cardInactive: "border-[var(--border-primary)] hover:border-[var(--border-secondary)] hover:shadow-lg",
  
  // 按钮样式
  primaryButton: "px-4 py-2 bg-[var(--btn-primary-bg)] text-[var(--btn-primary-text)] hover:bg-[var(--btn-primary-hover)] rounded-lg text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-2 shadow-lg shadow-[var(--btn-primary-shadow)]",
  secondaryButton: "px-4 py-2 bg-[var(--bg-surface)] text-[var(--text-tertiary)] border border-[var(--border-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--border-primary)] rounded-lg text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-2",
  iconButton: "p-2 hover:bg-[var(--bg-hover)] rounded text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors",
  
  // 模态框样式
  modalOverlay: "fixed inset-0 z-50 bg-[var(--overlay-heavy)] backdrop-blur-sm flex items-center justify-center p-4",
  modalContainer: "bg-[var(--bg-elevated)] border border-[var(--border-secondary)] rounded-xl p-6 max-w-2xl w-full space-y-4 shadow-2xl",
  modalTextarea: "w-full h-64 bg-[var(--bg-base)] text-[var(--text-primary)] border border-[var(--border-secondary)] rounded-lg p-4 text-sm outline-none focus:border-[var(--accent)] transition-colors resize-none",
  
  // 内容区域
  sectionHeader: "flex items-center gap-2 border-b border-[var(--border-primary)] pb-2",
  contentBox: "bg-[var(--bg-surface)] p-5 rounded-xl border border-[var(--border-primary)]",
};

// 视觉风格配置
export const VISUAL_STYLE_PROMPTS: Record<string, string> = AI_VISUAL_STYLE_PROMPTS;

// 视频提示词模板
export const VIDEO_PROMPT_TEMPLATES = {
  sora2: {
    chinese: `基于提供的参考图片生成视频。

动作描述：{actionSummary}
视觉风格锚点：{visualStyle}

技术要求：
- 关键：视频必须从参考图片的精确构图和画面内容开始，自然展开后续动作
- 镜头运动：{cameraMovement}
- 运动：确保动作流畅自然，避免突兀的跳跃或不连续
- 视觉风格：电影质感，全程保持一致的光照和色调
- 细节：保持角色外观和场景环境的全程一致性
- 音频：可使用中文配音/旁白
- 文字限制：禁止字幕和任何画面文字（包括片头片尾字卡、屏幕UI文字）`,
    
    english: `Generate a video based on the provided reference image.

Action Description: {actionSummary}
Visual Style Anchor: {visualStyle}

Technical Requirements:
- CRITICAL: The video MUST begin with the exact composition and content of the reference image, then naturally develop the subsequent action
- Camera Movement: {cameraMovement}
- Motion: Ensure smooth and natural movement, avoid abrupt jumps or discontinuities
- Visual Style: Cinematic quality with consistent lighting and color tone throughout
- Details: Maintain character appearance and scene environment consistency throughout
- Audio: Voiceover/narration in {language} is allowed
- Text constraints: No subtitles and no on-screen text (including title cards and UI text overlays)`
  },
  
  // 网格分镜模式的视频提示词（异步模型专用，精简版，避免超过8192字符限制）
  // 保留面板顺序与镜头意图，但 description 会按预算压缩
  sora2NineGrid: {
    chinese: `⚠️ 最高优先级指令：参考图是{gridLayout}网格分镜板（共{panelCount}格），仅用于镜头顺序参考，严禁作为视频可见内容。
⚠️ 视频第一帧必须是面板1的全屏场景画面（单画面占满100%屏幕）。
⛔ 绝对禁止：网格原图、网格线、缩略图拼贴、多画面分屏、画中画、多窗口并行动画。

动作描述：{actionSummary}
视觉风格锚点：{visualStyle}

网格镜头顺序（参考图从左到右、从上到下）：
{panelDescriptions}

镜头切换必须按1→{panelCount}顺序逐个出现；任意时刻只允许一个全屏镜头，禁止多个面板同时运动。
每个视角约{secondsPerPanel}秒，可用硬切或自然转场，镜头运动：{cameraMovement}
保持角色外观一致，电影质感。可中文配音/旁白，但禁止字幕与任何画面文字。`,

    english: `⚠️ HIGHEST PRIORITY: The reference image is a {gridLayout} storyboard grid ({panelCount} panels), used ONLY as shot-order guidance and NEVER as visible video content.
⚠️ The first frame MUST be the full-screen scene from Panel 1 (a single shot occupying 100% of the frame).
⛔ FORBIDDEN: grid image, grid lines, thumbnail collage, split-screen, picture-in-picture, multi-window, or parallel panel animation.

Action: {actionSummary}
Visual Style Anchor: {visualStyle}

Storyboard shot sequence (reference grid, left-to-right, top-to-bottom):
{panelDescriptions}

Transition strictly in order 1→{panelCount}, one shot at a time; never animate multiple panels simultaneously.
~{secondsPerPanel}s per angle using hard cuts or motivated transitions. Camera: {cameraMovement}
Maintain character consistency, cinematic quality.
Voiceover in {language} is allowed, but no subtitles or any on-screen text.`
  },

  veo: {
    simple: `{actionSummary}
视觉风格锚点：{visualStyle}

镜头运动：{cameraMovement}
音频：可使用{language}配音/旁白
文字限制：禁止字幕和任何画面文字`
  }
};

// 默认配置
export const DEFAULTS = {
  videoModel: 'sora-2' as const,
  batchGenerateDelay: 3000, // 批量生成延迟（毫秒）
};

// ============================================
// 九宫格分镜预览相关常量（高级功能）
// ============================================

export const STORYBOARD_GRID_LAYOUTS: Record<
  StoryboardGridPanelCount,
  StoryboardGridLayoutMeta & { label: string; shortLabel: string; positionLabels: string[] }
> = {
  4: {
    panelCount: 4,
    rows: 2,
    cols: 2,
    label: '四宫格',
    shortLabel: '4格',
    positionLabels: [
      '左上 (Top-Left)',
      '右上 (Top-Right)',
      '左下 (Bottom-Left)',
      '右下 (Bottom-Right)',
    ],
  },
  6: {
    panelCount: 6,
    rows: 2,
    cols: 3,
    label: '六宫格',
    shortLabel: '6格',
    positionLabels: [
      '左上 (Top-Left)',
      '中上 (Top-Center)',
      '右上 (Top-Right)',
      '左下 (Bottom-Left)',
      '中下 (Bottom-Center)',
      '右下 (Bottom-Right)',
    ],
  },
  9: {
    panelCount: 9,
    rows: 3,
    cols: 3,
    label: '九宫格',
    shortLabel: '9格',
    positionLabels: [
      '左上 (Top-Left)',
      '中上 (Top-Center)',
      '右上 (Top-Right)',
      '左中 (Middle-Left)',
      '正中 (Center)',
      '右中 (Middle-Right)',
      '左下 (Bottom-Left)',
      '中下 (Bottom-Center)',
      '右下 (Bottom-Right)',
    ],
  },
};

export const DEFAULT_STORYBOARD_PANEL_COUNT: StoryboardGridPanelCount = 9;

export const resolveStoryboardGridLayout = (
  panelCount?: number,
  fallbackPanelLength?: number
) => {
  const candidate = panelCount ?? fallbackPanelLength;
  if (candidate === 4 || candidate === 6 || candidate === 9) {
    return STORYBOARD_GRID_LAYOUTS[candidate];
  }
  return STORYBOARD_GRID_LAYOUTS[DEFAULT_STORYBOARD_PANEL_COUNT];
};

export const getStoryboardPositionLabel = (
  panelIndex: number,
  panelCount?: number,
  fallbackPanelLength?: number
): string => {
  const layout = resolveStoryboardGridLayout(panelCount, fallbackPanelLength);
  return layout.positionLabels[panelIndex] || `面板 ${panelIndex + 1}`;
};

export const NINE_GRID = {
  // 典型景别列表
  defaultShotSizes: ['远景', '全景', '中全景', '中景', '中近景', '近景', '特写', '大特写', '极端特写'],
  // 典型机位角度列表
  defaultCameraAngles: ['俯拍', '平视', '仰拍', '侧面', '正面', '背面', '斜拍', '鸟瞰', '低角度'],
};

// 九宫格 AI 拆分提示词模板（共享，Chat 模型使用）
export const NINE_GRID_SPLIT_PROMPT = SHARED_NINE_GRID_SPLIT_PROMPT;

// 九宫格图片生成提示词模板（共享，Gemini Image 使用）
export const NINE_GRID_IMAGE_PROMPT_TEMPLATE = SHARED_NINE_GRID_IMAGE_PROMPT_TEMPLATE;
