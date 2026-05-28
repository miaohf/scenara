/**
 * StageScript 工具函数
 */

import { Scene } from '../../types';
import { parseDurationToSeconds } from '../../services/durationParser';
import { SCRIPT_HARD_LIMIT } from './constants';

/**
 * 获取最终选择的值（处理自定义选项）
 */
export const getFinalValue = (selected: string, customInput: string): string => {
  return selected === 'custom' ? customInput : selected;
};

/**
 * 场景去重（根据 location）
 */
export const deduplicateScenes = (scenes: Scene[] = []): Scene[] => {
  const seenLocations = new Set<string>();
  return scenes.filter(scene => {
    const normalizedLoc = scene.location.trim().toLowerCase();
    if (seenLocations.has(normalizedLoc)) {
      return false;
    }
    seenLocations.add(normalizedLoc);
    return true;
  });
};

/**
 * 计算文本统计信息
 */
export const getTextStats = (text: string) => {
  return {
    characters: text.length,
    lines: text.split('\n').length,
    words: text.trim() ? text.trim().split(/\s+/).length : 0
  };
};

/**
 * 验证配置完整性
 */
export const validateConfig = (config: {
  script: string;
  duration: string;
  model: string;
  visualStyle: string;
}): { valid: boolean; error: string | null } => {
  const scriptText = config.script || '';

  if (!scriptText.trim()) {
    return { valid: false, error: '请输入剧本内容。' };
  }
  if (scriptText.length > SCRIPT_HARD_LIMIT) {
    return {
      valid: false,
      error: `当前剧本长度 ${scriptText.length} 字符，已超过上限 ${SCRIPT_HARD_LIMIT}。请拆分为多集后再生成分镜。`
    };
  }
  if (!config.duration) {
    return { valid: false, error: '请选择目标时长。' };
  }
  if (parseDurationToSeconds(config.duration) === null) {
    return { valid: false, error: '目标时长格式无效，请使用如 90s、3m 或 2min。' };
  }
  if (!config.model) {
    return { valid: false, error: '请选择或输入模型名称。' };
  }
  if (!config.visualStyle) {
    return { valid: false, error: '请选择或输入视觉风格。' };
  }
  return { valid: true, error: null };
};
