/**
 * 模型卡片组件
 * 显示单个模型的配置
 */

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Trash2, ToggleLeft, ToggleRight, CheckCircle, Circle, Pencil, Eye, EyeOff } from 'lucide-react';
import { 
  ModelDefinition, 
  ChatModelParams,
  ImageModelParams,
  VideoModelParams,
  AudioModelParams,
  AspectRatio,
  VideoDuration,
  ImageResolution,
} from '../../types/model';
import { getProviderById } from '../../services/modelRegistry';
import { normalizeBaseUrl, resolveComfyApiBaseUrl, validateRemoteApiBaseUrl, isAbsoluteHttpUrl } from '../../services/urlUtils';

interface ModelCardProps {
  model: ModelDefinition;
  isExpanded: boolean;
  isActive: boolean;
  onToggleExpand: () => void;
  onUpdate: (updates: Partial<ModelDefinition>) => void;
  onDelete: () => void;
  onSetActive: () => void;
}

const ModelCard: React.FC<ModelCardProps> = ({
  model,
  isExpanded,
  isActive,
  onToggleExpand,
  onUpdate,
  onDelete,
  onSetActive,
}) => {
  const [editParams, setEditParams] = useState<any>(model.params);
  const [editApiKey, setEditApiKey] = useState<string>(model.apiKey || '');
  const [showApiKey, setShowApiKey] = useState(false);
  const [editName, setEditName] = useState(model.name);
  const [editDescription, setEditDescription] = useState(model.description || '');
  const [editingDescription, setEditingDescription] = useState(false);
  const provider = getProviderById(model.providerId);
  const isVolcengineModel = model.providerId === 'volcengine';
  const isApiyiModel = model.providerId === 'apiyi';
  const isComfyUiImage = model.type === 'image' && (model.params as ImageModelParams).apiFormat === 'comfyui';
  const isComfyUiVideo = model.type === 'video' && (model.params as VideoModelParams).mode === 'comfyui';
  const isComfyUiModel = isComfyUiImage || isComfyUiVideo;
  const modelHasApiKey = Boolean(model.apiKey?.trim());
  const providerHasApiKey = Boolean(provider?.apiKey?.trim());
  const isMissingVolcengineKey = isVolcengineModel && !modelHasApiKey && !providerHasApiKey;
  const isMissingApiyiKey = isApiyiModel && !modelHasApiKey && !providerHasApiKey;

  const resolveModelBaseUrlDisplay = (): string => {
    if (model.baseUrl?.trim()) {
      return isComfyUiModel
        ? resolveComfyApiBaseUrl('', model.baseUrl)
        : normalizeBaseUrl(model.baseUrl);
    }
    if (isComfyUiModel) {
      return resolveComfyApiBaseUrl(provider?.baseUrl || 'http://127.0.0.1:8188', model.endpoint);
    }
    if (model.endpoint && isAbsoluteHttpUrl(model.endpoint)) {
      return normalizeBaseUrl(model.endpoint);
    }
    return '';
  };

  const [editBaseUrl, setEditBaseUrl] = useState(resolveModelBaseUrlDisplay);
  const [baseUrlError, setBaseUrlError] = useState('');

  useEffect(() => {
    setEditParams(model.params);
    setEditApiKey(model.apiKey || '');
    setShowApiKey(false);
    setEditName(model.name);
    setEditDescription(model.description || '');
    setEditingDescription(false);
    setEditBaseUrl(resolveModelBaseUrlDisplay());
    setBaseUrlError('');
  }, [model.id, model.params, model.apiKey, model.name, model.description, model.baseUrl, model.endpoint, model.providerId, provider?.baseUrl]);

  const providerFallbackBaseUrl = normalizeBaseUrl(provider?.baseUrl || '');
  const effectiveBaseUrl = editBaseUrl.trim() || providerFallbackBaseUrl;

  const handleBaseUrlChange = (value: string) => {
    setEditBaseUrl(value);
    const trimmed = value.trim();
    if (!trimmed) {
      setBaseUrlError('');
      onUpdate({ baseUrl: undefined });
      return;
    }

    const normalized = isComfyUiModel
      ? resolveComfyApiBaseUrl('', trimmed)
      : normalizeBaseUrl(trimmed).replace(/\/v1$/i, '');

    if (!isComfyUiModel) {
      const validationError = validateRemoteApiBaseUrl(normalized);
      if (validationError) {
        setBaseUrlError(validationError);
        return;
      }
    }

    setBaseUrlError('');
    if (normalized === providerFallbackBaseUrl) {
      onUpdate({ baseUrl: undefined });
      return;
    }
    onUpdate({ baseUrl: normalized });
  };

  const renderApiBaseUrlField = () => (
    <div>
      <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">
        {isComfyUiModel ? 'ComfyUI API 地址' : 'API Base URL'}
      </label>
      <input
        type="text"
        value={editBaseUrl}
        onChange={(e) => handleBaseUrlChange(e.target.value)}
        placeholder={
          isComfyUiModel
            ? (providerFallbackBaseUrl || 'http://127.0.0.1:8188')
            : (providerFallbackBaseUrl || 'https://ark.cn-beijing.volces.com')
        }
        className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] font-mono"
      />
      <p className="text-[9px] text-[var(--text-muted)] mt-1">
        {isComfyUiModel
          ? '本地 ComfyUI 服务地址，每个 ComfyUI 模型可单独配置。'
          : '留空则使用提供商 / 全局默认 Base URL；填写后覆盖。'}
      </p>
      {!editBaseUrl.trim() && effectiveBaseUrl && (
        <p className="text-[9px] text-[var(--text-tertiary)] mt-1 font-mono break-all">
          当前生效：{effectiveBaseUrl}
        </p>
      )}
      {baseUrlError && (
        <p className="text-[9px] text-[var(--error-text)] mt-1">{baseUrlError}</p>
      )}
    </div>
  );

  const handleParamChange = (key: string, value: any) => {
    const newParams = { ...editParams, [key]: value };
    setEditParams(newParams);
    onUpdate({ params: newParams } as any);
  };

  const handleToggleEnabled = () => {
    onUpdate({ isEnabled: !model.isEnabled });
  };

  const handleApiKeyChange = (value: string) => {
    setEditApiKey(value);
    onUpdate({ apiKey: value.trim() || undefined });
  };

  const commitName = () => {
    const next = editName.trim();
    if (!next) {
      setEditName(model.name);
      return;
    }
    if (next !== model.name) {
      onUpdate({ name: next });
    }
  };

  const commitDescription = () => {
    const next = editDescription.trim();
    if (next !== (model.description || '')) {
      onUpdate({ description: next });
    }
    setEditingDescription(false);
  };

  const renderChatParams = (params: ChatModelParams) => (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">温度</label>
        <input
          type="number"
          min="0"
          max="2"
          step="0.1"
          value={editParams.temperature}
          onChange={(e) => handleParamChange('temperature', parseFloat(e.target.value))}
          className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)]"
        />
      </div>
      <div>
        <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">最大 Token</label>
        <input
          type="number"
          min="1"
          max="128000"
          value={editParams.maxTokens ?? ''}
          onChange={(e) => {
            const value = e.target.value;
            handleParamChange('maxTokens', value === '' ? undefined : parseInt(value));
          }}
          placeholder="留空不限制"
          className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)]"
        />
        <p className="text-[9px] text-[var(--text-muted)] mt-1">留空则不限制最大 Token</p>
      </div>
    </div>
  );

  const renderImageParams = (params: ImageModelParams) => {
    const resolutionOptions: ImageResolution[] =
      (editParams.supportedOutputResolutions?.length
        ? editParams.supportedOutputResolutions
        : params.supportedOutputResolutions?.length
          ? params.supportedOutputResolutions
          : ['1K']) as ImageResolution[];
    const selectedResolution = (
      editParams.outputResolution
      && resolutionOptions.includes(editParams.outputResolution as ImageResolution)
    )
      ? (editParams.outputResolution as ImageResolution)
      : (resolutionOptions[0] || '1K');

    return (
    <div className="space-y-3">
      <div className="text-[10px] text-[var(--text-muted)]">
        协议：{
          params.apiFormat === 'openai'
            ? 'OpenAI Images'
            : params.apiFormat === 'comfyui'
              ? 'ComfyUI Workflow'
              : 'Gemini GenerateContent'
        }
      </div>
      {params.apiFormat !== 'comfyui' && (
        <div>
          <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">输出分辨率</label>
          <select
            value={selectedResolution}
            onChange={(e) => handleParamChange('outputResolution', e.target.value)}
            className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)]"
          >
            {resolutionOptions.map((option) => (
              <option key={option} value={option}>
                {option === '1344x768' ? '1344x768（对齐 MiniMax H3）' : option}
              </option>
            ))}
          </select>
          <p className="text-[9px] text-[var(--text-muted)] mt-1">
            Gemini 使用 imageSize；Seedream / OpenAI 兼容接口按所选档位或精确像素请求。
          </p>
        </div>
      )}
      {params.apiFormat === 'comfyui' && (
        <div>
          <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">工作流名称（定妆/通用文生图）</label>
          <input
            type="text"
            value={editParams.workflowName || ''}
            onChange={(e) => handleParamChange('workflowName', e.target.value.trim() || undefined)}
            className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)] font-mono"
            placeholder="default_image_generate"
          />
          <p className="text-[9px] text-[var(--text-muted)] mt-1">
            读取服务端 back-end/workflows/&lt;名称&gt;.json（不含 .json 后缀）
          </p>
        </div>
      )}
      {params.apiFormat === 'comfyui' && (
        <div>
          <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">Steps（定妆/通用）</label>
          <input
            type="number"
            min="1"
            max="100"
            value={editParams.steps || 20}
            onChange={(e) => handleParamChange('steps', parseInt(e.target.value) || 20)}
            className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)]"
          />
        </div>
      )}
      {params.apiFormat === 'comfyui' && (
        <div className="rounded border border-[var(--border-secondary)] bg-[var(--bg-hover)]/30 p-3 space-y-3">
          <div>
            <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">参考图定妆工作流</label>
            <input
              type="text"
              value={editParams.referenceWorkflowName || ''}
              onChange={(e) => handleParamChange('referenceWorkflowName', e.target.value.trim() || undefined)}
              className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)] font-mono"
              placeholder="image_qwen_image_edit_2511_20260908"
            />
            <p className="text-[9px] text-[var(--text-muted)] mt-1">
              角色、形体、场景或道具带参考图时使用。需包含 Reference Image 输入槽；留空回退上方文生图工作流。
            </p>
          </div>
          <div>
            <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">Steps（参考图定妆）</label>
            <input
              type="number"
              min="1"
              max="100"
              value={editParams.referenceSteps ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                handleParamChange('referenceSteps', value === '' ? undefined : parseInt(value) || 40);
              }}
              placeholder="默认回退定妆 Steps"
              className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)]"
            />
          </div>
        </div>
      )}
      {params.apiFormat === 'comfyui' && (
        <div>
          <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">关键帧工作流（首尾帧）</label>
          <input
            type="text"
            value={editParams.keyframeWorkflowName || ''}
            onChange={(e) => handleParamChange('keyframeWorkflowName', e.target.value.trim() || undefined)}
            className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)] font-mono"
            placeholder="image_flux2_klein_image_edit_9b_base"
          />
          <p className="text-[9px] text-[var(--text-muted)] mt-1">
            导演台「关键帧制作」首尾帧专用；多参考图一致性。留空则回退到上方定妆/通用工作流。
          </p>
        </div>
      )}
      {params.apiFormat === 'comfyui' && (
        <div>
          <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">Steps（关键帧）</label>
          <input
            type="number"
            min="1"
            max="100"
            value={editParams.keyframeSteps ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              handleParamChange('keyframeSteps', value === '' ? undefined : parseInt(value) || 40);
            }}
            placeholder="默认回退定妆 Steps"
            className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)]"
          />
        </div>
      )}
      {params.apiFormat === 'comfyui' && (
        <div>
          <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">造型九宫格工作流</label>
          <input
            type="text"
            value={editParams.turnaroundWorkflowName || ''}
            onChange={(e) => handleParamChange('turnaroundWorkflowName', e.target.value.trim() || undefined)}
            className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)] font-mono"
            placeholder="qwen_image_edit_2511_fp8_character_turnaround"
          />
          <p className="text-[9px] text-[var(--text-muted)] mt-1">
            基于定妆参考图生成 3×3 造型表；需角色先有定妆图。留空则回退到上方文生图工作流。
          </p>
        </div>
      )}
      {params.apiFormat === 'comfyui' && (
        <div>
          <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">Steps（造型九宫格）</label>
          <input
            type="number"
            min="1"
            max="100"
            value={editParams.turnaroundSteps ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              handleParamChange('turnaroundSteps', value === '' ? undefined : parseInt(value) || 4);
            }}
            placeholder="默认 4"
            className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)]"
          />
        </div>
      )}
      <div>
        <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">默认比例</label>
        <div className="flex gap-2">
          {/* 从模型的 supportedAspectRatios 读取支持的比例 */}
          {(params.supportedAspectRatios || ['16:9', '9:16']).map((ratio) => (
            <button
              key={ratio}
              onClick={() => handleParamChange('defaultAspectRatio', ratio)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                editParams.defaultAspectRatio === ratio
                  ? 'bg-[var(--btn-selected-bg)] text-[var(--btn-selected-text)] border border-[var(--btn-selected-border)]'
                  : 'bg-[var(--bg-hover)] text-[var(--text-tertiary)] border border-transparent hover:bg-[var(--border-secondary)]'
              }`}
            >
              {ratio === '16:9' ? '横屏' : ratio === '9:16' ? '竖屏' : '方形'}
            </button>
          ))}
        </div>
      </div>
    </div>
    );
  };

  const renderVideoParams = (params: VideoModelParams) => (
    <div className="space-y-4">
      {editParams.mode === 'comfyui' && (
        <div>
          <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">工作流名称</label>
          <input
            type="text"
            value={editParams.workflowName || ''}
            onChange={(e) => handleParamChange('workflowName', e.target.value.trim() || undefined)}
            className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)] font-mono"
            placeholder="default_video_generate"
          />
          <p className="text-[9px] text-[var(--text-muted)] mt-1">
            读取服务端 back-end/workflows/&lt;名称&gt;.json（不含 .json 后缀）
          </p>
        </div>
      )}
      {editParams.mode === 'comfyui' && (
        <div>
          <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">Steps</label>
          <input
            type="number"
            min="1"
            max="100"
            value={editParams.steps || 20}
            onChange={(e) => handleParamChange('steps', parseInt(e.target.value) || 20)}
            className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)]"
          />
        </div>
      )}
      <div>
        <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">默认比例</label>
        <div className="flex gap-2">
          {editParams.supportedAspectRatios.map((ratio: AspectRatio) => (
            <button
              key={ratio}
              onClick={() => handleParamChange('defaultAspectRatio', ratio)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                editParams.defaultAspectRatio === ratio
                  ? 'bg-[var(--btn-selected-bg)] text-[var(--btn-selected-text)] border border-[var(--btn-selected-border)]'
                  : 'bg-[var(--bg-hover)] text-[var(--text-tertiary)] border border-transparent hover:bg-[var(--border-secondary)]'
              }`}
            >
              {ratio === '16:9' ? '横屏' : ratio === '9:16' ? '竖屏' : '方形'}
            </button>
          ))}
        </div>
      </div>
      {editParams.supportedDurations.length > 1 && (
        <div>
          <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">默认时长</label>
          <div className="flex gap-2">
            {editParams.supportedDurations.map((duration: VideoDuration) => (
              <button
                key={duration}
                onClick={() => handleParamChange('defaultDuration', duration)}
                className={`px-3 py-1.5 text-xs rounded transition-colors ${
                  editParams.defaultDuration === duration
                    ? 'bg-[var(--btn-selected-bg)] text-[var(--btn-selected-text)] border border-[var(--btn-selected-border)]'
                    : 'bg-[var(--bg-hover)] text-[var(--text-tertiary)] border border-transparent hover:bg-[var(--border-secondary)]'
                }`}
              >
                {duration}秒
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="text-[10px] text-[var(--text-muted)]">
        模式：{
          editParams.mode === 'comfyui'
            ? 'ComfyUI Workflow'
            : editParams.mode === 'sync'
            ? '同步（Chat Completion）'
            : (model.endpoint || '').includes('/contents/generations/tasks')
              ? '异步（火山任务）'
              : '异步（Sora 类）'
        }
      </div>
    </div>
  );

  const renderAudioParams = (params: AudioModelParams) => (
    <div className="grid grid-cols-2 gap-4">
      <div>
        <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">默认音色</label>
        <input
          type="text"
          value={editParams.defaultVoice || params.defaultVoice}
          onChange={(e) => handleParamChange('defaultVoice', e.target.value)}
          className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)]"
          placeholder="alloy"
        />
      </div>
      <div>
        <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">输出格式</label>
        <select
          value={editParams.outputFormat || params.outputFormat}
          onChange={(e) => handleParamChange('outputFormat', e.target.value)}
          className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)]"
        >
          <option value="wav">wav</option>
          <option value="mp3">mp3</option>
          <option value="opus">opus</option>
        </select>
      </div>
    </div>
  );

  const apiModelLabel = model.apiModel || model.id;

  return (
    <div 
      className={`group/card bg-[var(--bg-elevated)]/50 border rounded-lg overflow-hidden transition-all ${
        isActive ? 'border-[var(--accent-border)] bg-[var(--accent-bg)]' : 'border-[var(--border-primary)]'
      } ${!model.isEnabled ? 'opacity-60' : ''}`}
    >
      {/* 头部 */}
      <div className="p-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {/* 模型信息 */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-[var(--text-primary)]">{model.name}</span>
              {model.isBuiltIn && (
                <span className={`px-1.5 py-0.5 text-[9px] rounded ${
                  isVolcengineModel
                    ? 'bg-[var(--warning-bg)] text-[var(--warning-text)]'
                    : 'bg-[var(--border-secondary)] text-[var(--text-tertiary)]'
                }`}>
                  {isVolcengineModel ? '火山引擎' : '内置'}
                </span>
              )}
            </div>
            <p className="text-[10px] text-[var(--text-tertiary)] mt-0.5 truncate">
              API: {apiModelLabel}
              {model.id !== apiModelLabel && ` · ID: ${model.id}`}
            </p>
            {isExpanded ? (
              model.description ? (
                <p className="text-[10px] text-[var(--text-muted)] leading-relaxed line-clamp-2 mt-1">
                  {model.description}
                </p>
              ) : null
            ) : editingDescription ? (
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                onBlur={commitDescription}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setEditDescription(model.description || '');
                    setEditingDescription(false);
                  }
                }}
                rows={2}
                autoFocus
                placeholder="简短说明，例如：本地首尾帧图生视频"
                className="mt-1.5 w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-2 py-1.5 text-[10px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-y"
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingDescription(true)}
                className="group/desc mt-1 flex items-start gap-1 text-left max-w-full min-w-0"
                title="编辑描述"
              >
                <p className={`text-[10px] leading-relaxed line-clamp-2 min-w-0 ${
                  model.description ? 'text-[var(--text-muted)]' : 'text-[var(--text-muted)]/70 italic'
                }`}>
                  {model.description || '添加描述'}
                </p>
                <Pencil className="w-3 h-3 mt-0.5 shrink-0 text-[var(--text-muted)] opacity-60 group-hover/desc:opacity-100" />
              </button>
            )}
            {isComfyUiImage && (
              <p className="text-[10px] text-[var(--text-muted)] mt-1 font-mono">
                定妆：{(model.params as ImageModelParams).workflowName || '—'}
                {' · '}
                关键帧：{(model.params as ImageModelParams).keyframeWorkflowName || '（同定妆）'}
                {' · '}
                九宫格：{(model.params as ImageModelParams).turnaroundWorkflowName || '（同定妆）'}
              </p>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 使用此模型：仅 hover 卡片时显示，样式偏轻避免实心深色块 */}
          {model.isEnabled && !isActive && (
            <button
              onClick={onSetActive}
              className="hidden group-hover/card:inline-flex px-2.5 py-1 text-[10px] font-bold rounded border transition-colors items-center gap-1 bg-[var(--accent-bg)] text-[var(--accent-text)] border-[var(--accent-border)] hover:bg-[var(--btn-selected-bg)] hover:text-[var(--btn-selected-text)] hover:border-[var(--btn-selected-border)]"
              title="使用此模型"
            >
              <Circle className="w-3 h-3" />
              使用
            </button>
          )}
          
          {/* 当前激活标记 */}
          {isActive && (
            <span className="px-2.5 py-1 bg-[var(--accent-bg)] text-[var(--accent-text-hover)] text-[10px] font-bold rounded flex items-center gap-1">
              <CheckCircle className="w-3 h-3" />
              当前使用
            </span>
          )}

          {/* 启用/禁用开关 */}
          <button
            onClick={handleToggleEnabled}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
            title={model.isEnabled ? '禁用' : '启用'}
          >
            {model.isEnabled ? (
              <ToggleRight className="w-5 h-5 text-[var(--accent-text)]" />
            ) : (
              <ToggleLeft className="w-5 h-5" />
            )}
          </button>

          {/* 删除：仅自定义模型，且禁用后才显示 */}
          {!model.isBuiltIn && !model.isEnabled && (
            <button
              onClick={onDelete}
              className="text-[var(--text-tertiary)] hover:text-[var(--error-text)] transition-colors"
              title="删除"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}

          {/* 展开/收起 */}
          <button
            onClick={onToggleExpand}
            className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            {isExpanded ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* 展开的参数配置 */}
      {isExpanded && (
        <div className="px-4 pb-4 pt-0 border-t border-[var(--border-primary)]">
          <div className="pt-4 space-y-4">
            <div>
              <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">显示名称</label>
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur();
                  } else if (e.key === 'Escape') {
                    setEditName(model.name);
                    e.currentTarget.blur();
                  }
                }}
                className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)]"
              />
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">描述</label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                onBlur={commitDescription}
                rows={2}
                placeholder="展示在模型列表和生成页的简短说明，不影响实际调用"
                className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] resize-y"
              />
            </div>

            {/* 模型专属 API Key */}
            <div>
              <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">
                API Key{isComfyUiModel ? '（ComfyUI 本地可留空）' : '（留空使用全局 Key）'}
              </label>
              {isVolcengineModel && (
                <p className="text-[9px] text-[var(--warning-text)] mb-1">
                  火山模型不会使用全局 API Key，请填写模型 Key 或 Volcengine 提供商 Key。
                </p>
              )}
              {isComfyUiModel && (
                <p className="text-[9px] text-[var(--text-muted)] mb-1">
                  本地 ComfyUI 不需要 API Key；请在下方配置 ComfyUI API 地址并确保服务已启动。
                </p>
              )}
              <div className="relative">
                <input
                  type={showApiKey ? 'text' : 'password'}
                  value={editApiKey}
                  onChange={(e) => handleApiKeyChange(e.target.value)}
                  placeholder={
                    isVolcengineModel && providerHasApiKey && !modelHasApiKey
                      ? '留空则使用 Volcengine 提供商 Key'
                      : isApiyiModel && providerHasApiKey && !modelHasApiKey
                        ? '留空则使用 API易 提供商 Key'
                        : '留空则使用全局 API Key'
                  }
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 pr-9 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((prev) => !prev)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors"
                  title={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                  aria-label={showApiKey ? '隐藏 API Key' : '显示 API Key'}
                >
                  {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              {isMissingVolcengineKey && (
                <p className="text-[9px] text-[var(--error-text)] mt-1">
                  未配置火山引擎 Key，当前模型无法调用且不会回退到全局 Key。
                </p>
              )}
              {isMissingApiyiKey && (
                <p className="text-[9px] text-[var(--error-text)] mt-1">
                  未配置 API易 Key，请在模型或「API易」提供商中填写，或在服务端 .env 设置 APIYI_API_KEY。
                </p>
              )}
              {model.apiKey && (
                <p className="text-[9px] text-[var(--success)] mt-1">✓ 已配置专属 Key</p>
              )}
              {!model.apiKey && providerHasApiKey && (
                <p className="text-[9px] text-[var(--success)] mt-1">✓ 将使用提供商 Key</p>
              )}
            </div>

            {renderApiBaseUrlField()}

            {model.type === 'chat' && !model.isBuiltIn && (
              <div>
                <label className="text-[10px] text-[var(--text-tertiary)] block mb-1">API 模型名</label>
                <input
                  type="text"
                  value={model.apiModel || model.id}
                  onChange={(e) => {
                    const next = e.target.value.trim();
                    onUpdate({ apiModel: next || model.id });
                  }}
                  placeholder="如 gpt-4-turbo、gemma4:31b"
                  className="w-full bg-[var(--bg-hover)] border border-[var(--border-secondary)] rounded px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] font-mono"
                />
                <p className="text-[9px] text-[var(--text-muted)] mt-1">
                  每条对话模型可单独配置 API 模型名，互不影响；请求时以本字段为准。
                </p>
              </div>
            )}
            
            {model.type === 'chat' && renderChatParams(model.params)}
            {model.type === 'image' && renderImageParams(model.params)}
            {model.type === 'video' && renderVideoParams(model.params)}
            {model.type === 'audio' && renderAudioParams(model.params)}
          </div>
        </div>
      )}
    </div>
  );
};

export default ModelCard;
