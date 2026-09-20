# TO_DO

## 结构审片 Agent：允许删/并镜与 beat 重排（已落地核心）

**状态**：核心已接线；UI「单独重跑」与 regenerateBeat 局部重生成仍待增强。  
**背景**：原字段级审片禁止增删镜，叠戏类问题会全部 pass。现已增加结构审片，并调整为「结构 → 字段」顺序。

### 已完成

1. `reviewStoryboardStructure`：LLM 结构审查 + `remove` / `merge` / `reorder` / `regenerateBeat` 提案。
2. 低风险 `autoSafe` 动作在生成时自动应用（最多删约 40% 镜；场景至少保留 1 镜）；`regenerateBeat` 只标记不自动应用。
3. `generateShotList` 顺序：确定性管线 → **结构审片** → 字段审片；结构改动后重建 agent 连续性元数据并再跑确定性管线。
4. `reviewStoryOutline` 故事层软门禁（导演 plan 之后、分镜场景生成前；只记警告不阻断）。
5. StageScript Agent 轨迹展示故事门禁 / 结构审片 / 字段审片摘要；ConfigPanel 文案已更新。
6. 结果写入 `scriptData.storyboardStructureReview` / `storyOutlineReview`。

### 仍待增强

1. UI：生成后「确认结构提案」闸门；单独「重跑结构审片」按钮。
2. `regenerateBeat` 真正触发局部场景重生成。
3. 管线其余项：资产∥提示词并行、视频失败回流、出片 continuity（见 PIPELINE）。

### 相关文件

- `front-end/src/services/ai/storyboardAgent.ts`
- `front-end/src/services/ai/scriptService.ts`
- `front-end/src/components/StageScript/index.tsx` / `ConfigPanel.tsx`
- `front-end/src/types.ts`

### 流程图

目标态全流程见：[PIPELINE.md](./PIPELINE.md)。

---

## 分镜资产绑定：名称优先 + 代码解析 ID（待做）

**状态**：方案已确认，暂不改代码。  
**背景**：`gpt-5.6-sol` 资产绑定基本正常；`deepseek-v4-pro` 容易返回空数组 / 名字 / 错 ID，被 `validCharacterIds.has(id)` 静默过滤后全片只剩场景。

### 目标

弱模型用**资产名称**填写 `characters` / `props`，代码再解析为合法资产 ID；强模型仍可直接返回 ID。

### 提示词

- `storyboard.shotGeneration` / `shotRepair`：改为「优先 name，也可 id」；示例改为真实名称，去掉硬编码 `char_1`。
- 注入扁平对照表：`渔人 | id=char-1`。
- `buildShotAgentContract` 可补一句同样规则。

### 代码

- 在 ID 白名单过滤前增加 `resolveCharacterRefs` / `resolvePropRefs`：精确 ID → 精确 name → 规范化匹配；不唯一则跳过并打日志。
- 空绑定兜底：`actionSummary` 命中唯一资产名时自动补绑。
- 质量校验：动作提到角色/道具但未绑定时降分或触发本地补绑（不必再打 LLM）。
- 审片 Agent 仍不改绑定；纠偏放在确定性代码。

### 验收

同一《桃花源记》对比 deepseek vs gpt：绑定率、未解析日志、`resolvedById / resolvedByName / autoFilledFromAction`。

### 相关文件（实施时）

- `front-end/src/services/promptTemplateService.ts`
- `front-end/src/services/ai/scriptService.ts`（`generateShotList` 归一化）
- `front-end/src/services/ai/storyboardAgent.ts`（可选契约文案）

---

## MiniMax H3 提示词对齐官方 skill（进行中 / 已落地编译器）

**状态**：Ref2VA 编译器与 FLF2V 模板已改为官方 skill 结构；请用镜头「重新生成/编辑视频提示词」验证。  
**参考**：官方 [h3-prompt-writing](https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills/h3-prompt-writing)（`base-en.txt` / `ref-en.txt`）。

### 已完成

1. `buildMiniMaxH3Ref2VAPrompt` → 六段式：`subject_definitions` / `summary` / `retention_analysis` / `detailed_description` / `overall_soundscape` / `non_diegetic_music`，使用 `<Subject N>` / `<Picture N>`。
2. 九宫格改为 `<Picture N> is a storyboard reference...` + `weak_reference` retention。
3. 对白走 `<d>[Language] …</d>` + `(S1)`；运镜改为 type/amplitude/speed 英文句。
4. 缩短生产圣经注入；wardrobe 去掉与镜头道具重名的脏片段（如重复「短刀」）。
5. FLF2V 模板 `minimaxH3StartOnly/StartEnd` 对齐 `base-en.txt`。
6. `finalizeMiniMaxH3VideoPrompt`：官方格式不再追加 `[NATIVE_AUDIO_DIRECTIVE_V1]`，改为维护 soundscape/music 字段。

### 仍需人工验证

- 对已有镜头点「编辑视频提示词 / 重新生成」看输出是否六段齐全。
- 有对白 / 无对白 / 九宫格 Ref2VA 各跑一条短视频观感。
- 手动改过的 prompt（`manual-edit`）不被自动覆盖。

### 相关文件

- `front-end/src/services/ai/h3PromptCompiler.ts`
- `front-end/src/components/StageDirector/utils.ts`（`finalizeMiniMaxH3VideoPrompt`）
- `front-end/src/services/promptTemplateService.ts`
- `front-end/src/components/StageDirector/index.tsx`

---

## 可穿戴道具：视觉设计页不可见 / 不可改（待做）

**状态**：问题已确认，暂不改代码。  
**背景**：《桃花源记》里「短刀」被标 `isWearable: true`，分镜可绑定，但视觉设计页道具列表看不到，也无法生成参考图。

### 现状

- `StageAssets` 用 `visibleProps = props.filter(!isWearableProp)` 隐藏可穿戴道具；批量生成同样跳过。
- `PropCard` 没有 `isWearable` 开关，误标后前端无法纠偏。
- 分镜工作台仍可能显示/添加该类道具；出视频时又常按服装过滤，不进道具参考图。

### 目标

保留「服装走角色定妆」的意图，同时给误标 / 手持可佩戴物（刀、佩饰等）提供查看与纠偏入口。

### 建议改造

1. 视觉设计页增加「可穿戴 / 归入定妆」折叠区或筛选，默认可展开查看。
2. `PropCard`（或编辑面板）支持切换 `isWearable`，改回普通道具后可生成参考图。
3. （可选）结构解析提示词收紧：`isWearable` 仅用于服装/穿戴物，手持武器/工具默认 `false`。
4. （可选）出视频时：已绑镜头且非服装语境的可穿戴道具，仍允许作为道具参考注入。

### 相关文件（实施时）

- `front-end/src/components/StageAssets/index.tsx`
- `front-end/src/components/StageAssets/PropCard.tsx`
- `front-end/src/services/ai/promptConstants.ts`（`isWearableProp`）
- `front-end/src/services/ai/scriptService.ts`（结构解析 `isWearable` 规则）

---

## 媒体生成：卡顿 / 旧视频残留 / 失败无感知（待做）

**状态**：根因已分析（含 [stale media sync](caac5792-c459-49b1-8576-3ec01d098606) 调查），暂不改代码。  
**背景**：打开项目卡；重生成 shot 后仍播旧视频；生成失败时几乎无感知。

### 根因摘要

1. **加载卡**：`GET /v1/episodes/{id}` 一次拉整集 `payload`（shots/scriptData/媒体字段）；历史可能仍含 base64；`shots` 自动保存也是整数组提交。
2. **旧视频残留（最高嫌疑）**：`episode-workspace.tsx` 中 `onEpisodeReconcile` 用闭包旧 `currentEpisode` 做非函数式 `setCurrentEpisode(updater(currentEpisode))`，可能把刚写入的新 `videoUrl` 盖掉。
3. **合并策略**：`takeServerMedia` 对本地已 `completed` 的旧 URL 拒绝用服务端新 URL 替换；视频缺少关键帧级 `generationId` / `videoUpdatedAt`。
4. **失败无感知**：重生成不清旧 `videoUrl`；失败只标 `failed` 仍播旧片；队列对账失败无强 toast；预览区几乎不强调失败。
5. **UI**：`<video>` 无 `key={src}`，URL 变了也可能不刷新。

### P0（先于整库重构）

1. `onEpisodeReconcile` 改为函数式：`setCurrentEpisode(prev => prev ? updater(prev) : prev)`。
2. 开始重生成：清空或标记 stale 旧 `videoUrl`；预览显示「生成中，旧结果已作废」。
3. 失败：醒目错误条 + `showAlert`（含 `job.error`）；队列对账失败也要提示；保留 `lastError`。
4. `<video key={resolvedVideoSrc}>`（必要时 `video.load()`）。

### P1

5. 视频增加 `generationId` / `videoUpdatedAt`；`takeServerMedia` 与后端 `_preserve_completed_media` 按代际/时间裁决，禁止旧 completed 覆盖新媒体。
6. 任务完成路径补 `syncFromServer`（不要 completed/failed 后直接 return 跳过）。
7. 禁止把 `opfs://` 写入服务端 payload。

### P2（性能 / 数据层）

8. `shots` 按镜头增量 PATCH；媒体外置 + 懒加载；未迁移剧集跑 `migrate_payload_media.py`。
9. 完整 DB/API 拆分（元数据 vs 媒体）可后置，不挡 P0。

### 相关文件（实施时）

- `front-end/src/components/episode-workspace.tsx`
- `front-end/src/contexts/GenerationQueueContext.tsx`
- `front-end/src/services/jobReconcile.ts`
- `front-end/src/components/StageDirector/VideoGenerator.tsx`
- `front-end/src/components/StageDirector/index.tsx`
- `back-end/app/services/job_apply.py`
