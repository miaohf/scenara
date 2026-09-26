/**
 * 分镜与九宫格提示词模板（共享）
 * 供 UI 侧常量与 AI 服务侧共同复用，避免模板漂移
 */

import type { StoryboardGridPanelCount } from '../../types';

export interface StoryboardGridLayoutPreset {
  panelCount: StoryboardGridPanelCount;
  rows: number;
  cols: number;
  label: string;
  positionLabels: string[];
}

export const STORYBOARD_GRID_LAYOUTS: Record<StoryboardGridPanelCount, StoryboardGridLayoutPreset> = {
  4: {
    panelCount: 4,
    rows: 2,
    cols: 2,
    label: '四宫格',
    positionLabels: ['Top-Left', 'Top-Right', 'Bottom-Left', 'Bottom-Right'],
  },
  6: {
    panelCount: 6,
    rows: 2,
    cols: 3,
    label: '六宫格',
    positionLabels: ['Top-Left', 'Top-Center', 'Top-Right', 'Bottom-Left', 'Bottom-Center', 'Bottom-Right'],
  },
  9: {
    panelCount: 9,
    rows: 3,
    cols: 3,
    label: '九宫格',
    positionLabels: [
      'Top-Left',
      'Top-Center',
      'Top-Right',
      'Middle-Left',
      'Center',
      'Middle-Right',
      'Bottom-Left',
      'Bottom-Center',
      'Bottom-Right',
    ],
  },
};

export const DEFAULT_STORYBOARD_PANEL_COUNT: StoryboardGridPanelCount = 9;

export const resolveStoryboardGridLayout = (panelCount?: number): StoryboardGridLayoutPreset => {
  if (panelCount === 4 || panelCount === 6 || panelCount === 9) {
    return STORYBOARD_GRID_LAYOUTS[panelCount];
  }
  return STORYBOARD_GRID_LAYOUTS[DEFAULT_STORYBOARD_PANEL_COUNT];
};

export const NINE_GRID_SPLIT_PROMPT = {
  system: `你是专业分镜师。请把同一镜头的场景变化过程拆成{panelCount}个不重复的连续画面，用于{gridLayout}网格分镜。网格布局必须严格为 {layoutInstruction}。这不是人物定妆、角色转面或人物排列图；每格都必须是同一场景中的电影分镜，保持场景、动作与角色连续性。`,

  user: `请将以下镜头动作拆解为{panelCount}个“同一场景中动作逐步发生”的连续摄影视角，用于生成一张{gridLayout}网格分镜图。每格必须表现环境、主体位置和动作推进；禁止把角色单独抠出做成肖像/定妆/转面参考图。
网格硬约束：必须严格为 {layoutInstruction}，顺序为从左到右、从上到下。{layoutSpecificConstraint}
行列顺序示意：{layoutExample}
【镜头动作】{actionSummary}
【原始镜头运动】{cameraMovement}
【场景信息】地点: {location}, 时间: {time}, 氛围: {atmosphere}
【角色】{characters}
【视觉风格】{visualStyle}

输出规则（只输出JSON）：
1) 顶层为 {"panels":[...]}
2) panels 必须恰好{panelCount}项；每项必须显式包含 index 字段，index=0-{lastIndex}，不可重复，整体顺序为左到右、上到下
3) 每项含 shotSize、cameraAngle、description，均不能为空
4) shotSize/cameraAngle 用简短中文；description 用英文单句（10-30词），聚焦主体、动作、构图
5) 视角多样性：shotSize + cameraAngle 组合不得重复；当{panelCount}>=6时，至少使用3种不同 shotSize（否则至少2种）
6) 叙事节奏：index=0 建立场景与主体，最后一格呈现动作结果/情绪落点，中间格逐步推进动作
7) 连续性：保持角色外观、服装、道具、主运动方向一致；若需要反打/轴线跨越，必须在 description 明确说明动机`
};

export const NINE_GRID_IMAGE_PROMPT_TEMPLATE = {
  prefix: `Create ONE cinematic storyboard contact sheet for a SINGLE SHOT and its action progression.
Fixed layout: exactly {layoutInstruction} ({panelCount} equal panels, thin dark charcoal separators; never white separators).
Panel order: {layoutExample}
{layoutSpecificConstraint}
The grid geometry is non-negotiable. Every panel must have identical size; no panel may span multiple cells.
All panels depict the SAME location and the SAME shot evolving over time. This is a storyboard of scene change, not a character design sheet, character turnaround, lineup, cast sheet, or portrait collage.
Every panel must show a cinematic scene composition with the environment visible. Vary the camera angle, shot size, pose, and action beat only as specified by the panel descriptions; do not replace the scene with isolated full-body character portraits.
Style: {visualStyle}
Panels (left-to-right, top-to-bottom):`,

  panelTemplate: `Panel {index} ({position}): [{shotSize} / {cameraAngle}] - {description}`,

  suffix: `Constraints:
- Output one single storyboard grid image only
- Exact layout = {layoutInstruction} and exactly {panelCount} panels total
- This is a STORYBOARD SEQUENCE showing one scene changing from panel to panel, never a character turnaround/reference sheet
- Keep the location, spatial layout, lighting, action continuity, and character identity consistent across all panels
- If reference images are provided: use the scene reference as the environmental canvas; use character references only to preserve identity, face, hair, wardrobe, and proportions. Never copy a character reference-sheet layout into the grid
- Keep lighting/color/mood consistent across all panels
- Each panel is a complete cinematic keyframe
- All panel sizes must be identical; no merged cells, no oversized panels, no inset panels
- Do NOT add extra rows, extra columns, blank panels, missing panels, or alternative layouts
- {layoutSpecificConstraint}
- ABSOLUTE NO-TEXT RULE: include zero readable text in every panel
- Forbidden text elements: letters, words, numbers, subtitles, captions, logos, watermarks, signage, UI labels, speech bubbles
- If signs/screens/documents appear, render text areas as blank or illegible marks with no recognizable characters`
};
