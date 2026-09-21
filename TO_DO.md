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

## MiniMax H3 提示词 Agent 与官方格式（已落地主链路）

**状态**：Ref2VA / FLF2V 编译、单镜头执行计划 Agent、工作流路由和编辑器链路均已落地；最终提示词质量门禁另见下一节。
**参考**：官方 [h3-prompt-writing](https://github.com/MiniMax-AI/MiniMax-H3/tree/main/skills/h3-prompt-writing)（`base-en.txt` / `ref-en.txt`）。

### 已完成

1. `buildMiniMaxH3Ref2VAPrompt` → 六段式：`subject_definitions` / `summary` / `retention_analysis` / `detailed_description` / `overall_soundscape` / `non_diegetic_music`，使用 `<Subject N>` / `<Picture N>`。
2. 九宫格改为 `<Picture N> is a storyboard reference...` + `weak_reference` retention。
3. 对白走 `<d>[Language] …</d>` + `(S1)`；运镜改为 type/amplitude/speed 英文句。
4. 缩短生产圣经注入；wardrobe 去掉与镜头道具重名的脏片段（如重复「短刀」）。
5. FLF2V 模板 `minimaxH3StartOnly/StartEnd` 对齐 `base-en.txt`。
6. `finalizeMiniMaxH3VideoPrompt`：官方格式不再追加 `[NATIVE_AUDIO_DIRECTIVE_V1]`，改为维护 soundscape/music 字段。
7. `Rebuild from shot` 已改为单镜头 Agent 重规划：先按实际时长生成 `executionPlan`，再交给 H3 编译器；5 秒镜头最多 2 个动作阶段，长镜头按时长放宽。
8. 视频编辑入口会把当前模型和当前选择时长显式传入，避免 UI 已切 FL2V、提示词仍按 Ref2VA 编译，也不再把所有镜头固定为 5 秒。
9. `Rebuild from shot` 完成后自动保存提示词、Agent 执行计划、时长和版本记录；只有随后手动编辑文本才需要点 Save。
10. Ref2VA 不再要求或审核首尾帧；FL2V 继续使用首尾帧约束。
11. H3 时间段已按块输出 `Action / Camera / SFX`；`subject_definitions` 重复注释、音效重复和内部包装词已收敛。
12. 视频提示词编辑器按当前工作流显示正确标签和参考输入；移除二次切换的 ComfyUI Paste 流程，保留一键复制。

### 已完成的人工验证

- 现有 Ref2VA 镜头可输出完整六段式，并能按时间段展示动作、摄影和音效。
- FL2V 切换后可生成首尾帧三字段格式，不再残留 Ref2VA 标签。
- shot001 的单镜头 Agent 能将旧 3 阶段动作压缩为 2 阶段，证明重规划链路已生效。

### 仍需回归验证

- 有对白、画外音、九宫格 Ref2VA、纯环境声各跑一条视频。
- 手动编辑版本在模型未切换时不被自动覆盖；模型切换时必须转换工作流格式。
- Agent 调用失败时确定性回退提示词仍能自动保存，并向用户显示降级提示。

### 相关文件

- `front-end/src/services/ai/h3PromptCompiler.ts`
- `front-end/src/components/StageDirector/utils.ts`（`finalizeMiniMaxH3VideoPrompt`）
- `front-end/src/services/promptTemplateService.ts`
- `front-end/src/components/StageDirector/index.tsx`

---

## H3 最终提示词一致性门禁（P0 主链路已完成）

**状态**：结构化 H3 校验/自动修复已经接入 `Rebuild from shot` 自动保存和生成视频预检；P1 对白及首镜语义规则仍待补充。
**来源评估**：借鉴 [manju-laoli-skill](https://github.com/lixiaoxiao9888-create/manju-laoli-skill) 的 H1~H12 校验器架构，不整包导入；补充 Scenara 实际暴露出的冲突规则。该仓库包检查与 validator self-test 已本地通过。

### P0：先解决已复现问题

1. [x] 新建结构化 `validateAndRepairH3Prompt`，输出 `{code, severity, field, message, autoFix}`，覆盖字段齐全/顺序、标签定义引用、时长、retention 合法值和工作流串线。
2. [x] 增加跨字段音乐门：任一 `audioIntent / soundPlan / timeline.sound` 出现「无音乐 / no music」，则自动把 `non_diegetic_music` 归一为 `N/A`。
3. [x] 动作密度门：按实际时长限制 phase 数量，检查单阶段连续状态变化；5 秒最多 2 阶段，超额或过密直接阻断。
4. [x] 摄影门：检测同一阶段 Dolly / Tracking / Pan / Orbit 等多种运动冲突并提示收敛为一个主导运动。
5. [x] 结束状态可见性门：检查“主体已进入浓雾/出画”与“微小线索仍清晰可见”等矛盾。
6. [x] 门禁执行顺序已固定为：`executionPlan Agent → H3 compiler → audio finalizer → H3 validator/autofix → 自动保存 → video preflight`。
7. [x] `Rebuild from shot` 仅在无 error 时替换已保存提示词；自动修复项写入版本说明，无法修复时保留旧版本并在编辑器展示问题。
8. [x] 单镜头 Agent 第一次输出未通过时，会携带确定性校验结果自动重试一次，不再直接接受不合格计划。

### P1：完整 H3 规则

9. [x] 标签门：未定义标签报错；定义但未在 `detailed_description` 使用的 Subject 警告，避免白占参考槽位。
10. [ ] 对白门：`<d>[Language]`、说话人首现顺序、画外音闭口证据、soundscape/music 不得包含对白。
11. [ ] 首镜锚定门：`[Shot 1]` 必须有明确主体，减少并列主体、悬空指代和模型自行补主体。
12. [x] 建立可独立运行的回归脚本，覆盖无音乐自动修复、5 秒阶段/动作超额、多运镜、结束可见性和 FL2V/Ref2VA 字段串线；后续继续补对白夹具。

### 相关文件（实施时）

- `front-end/src/services/ai/h3PromptCompiler.ts`
- `front-end/src/services/ai/h3PromptValidator.ts`
- `front-end/src/services/promptLintService.ts`
- `front-end/src/components/StageDirector/utils.ts`
- `front-end/src/components/StageDirector/index.tsx`
- `front-end/scripts/check-h3-prompt-validator.mjs`

---

## Ref2VA 参考素材语义预算（P1，待做）

**状态**：已有 `referenceImagePack` 数量上限、去重和 continuity 预留，但仍偏“按现有条目装满”，缺少镜头级语义优先级。shot001 同时投入 7 个 Subject，角色、环境、舟、网、篙、鱼篓和桃花瓣会竞争注意力。
**来源评估**：借鉴 `manju-laoli-skill` 的 9 张取材策略；按 Scenara 数据结构实现，不复制其文本模板。

### 目标

1. 在 `ShotExecutionPlan` 增加 `referencePolicy`：`required / supportive / textOnly / omitted`，以及每项本镜用途和可见时段。
2. 评分顺序：具体帧锚 > 主角身份 > 核心环境 > 核心动作道具 > 次要人物 > 背景道具；不是所有已绑定资产都必须上传参考图。
3. 多个小道具允许拼成一张道具板；不重要资产降级成提示词文字，不占图片槽位。
4. 检查 Subject 的全局 `Intended use` 与本镜用途冲突，例如桃花瓣全局为 background、本镜却是前景唯一线索时，应生成镜头级覆盖说明。
5. 编辑器显示“为何选入/为何降级”，并允许用户锁定某项参考图。
6. 视频生成前验证图片 ≤9、视频 ≤3、音频 ≤3、总输入 ≤12，并检查定义项是否实际参与镜头。

### 相关文件（实施时）

- `front-end/src/types.ts`
- `front-end/src/services/referenceImagePack.ts`
- `front-end/src/services/ai/storyboardAgent.ts`
- `front-end/src/services/ai/h3PromptCompiler.ts`
- `front-end/src/components/StageDirector/ShotWorkbench.tsx`

---

## 项目连续性台账（P1，待做）

**状态**：已有 Production Bible、场景 `continuityIn/Out`、镜头 Agent continuity 和媒体 generationId；缺少可由代码读写、跨镜/跨集更新的结构化状态账。
**来源评估**：借鉴 [short-drama-factory](https://github.com/lixiaoxiao9888-create/short-drama-factory) 的人物账/道具账/伏笔账/世界观规则账思想。其单集 validator 示例已通过；系列 validator 能阻断缺账输入。

### 目标

1. 增加结构化状态：角色位置、服装版本、持有物、身体/情绪状态、已知信息；道具位置、持有者、开合/损坏状态；场景时间、天气、光向和空间轴线。
2. 每个镜头明确 `stateIn / stateDelta / stateOut`，下一镜默认继承上一镜 `stateOut`；人工修改可锁定事实。
3. Production Bible 继续作为全局事实层，连续性台账作为运行状态层；冲突时事实层优先，状态变化必须有镜头事件依据。
4. 分镜 Agent、关键帧提示词、H3 编译器和审片 Agent 消费同一份状态，不再各自从自然语言猜测鱼篓、竹篙、服装和人物站位。
5. 增加确定性检查：道具瞬移、服装无依据变化、人物退场后继续出现、屏幕方向无故反转、伏笔已回收却重复建立。
6. 先做单集镜头级台账，跨集人物知识和伏笔账后置。

### 相关文件（实施时）

- `front-end/src/types.ts`
- `front-end/src/services/productionBibleService.ts`
- `front-end/src/services/ai/storyboardAgent.ts`
- `front-end/src/services/ai/scriptService.ts`
- `front-end/src/services/qualityAssessmentV2Service.ts`

---

## 编剧能力模块化路由（P2，待做）

**状态**：当前已有 script rewrite / director plan / story outline / structure review Agent，但规则主要随流程整体注入，缺少按任务加载的专业模块。
**来源评估**：[screenwriting-skills](https://github.com/jtydhr88/screenwriting-skills) 提供 26 个拆分 Skill，严格检查为 0 error / 0 warning；MIT 仅覆盖原创 Skill，NOTICE 中的书籍和剧本引文不可直接并入产品。[XiaoLuo-AI-Drama-Skill](https://github.com/zhurui0523/XiaoLuo-AI-Drama-Skill) 无 LICENSE，只借鉴流程概念，不复制文本。

### 目标

1. 建立轻量路由：剧本改写按需求只加载 premise/theme、character/conflict、scene craft、dialogue、series structure 等相关规则。
2. 每个模块只输出可被现有 Agent 使用的检查项和结构化建议，避免把长篇理论全文注入上下文。
3. 分清“诊断”和“改写”：默认给证据、影响和修改方向，只有用户明确要求时才改写原文。
4. 为短片/短剧/连续剧选择不同结构门禁，不机械套用三幕或固定节拍表。
5. 视觉侧仅补 Scenara 尚缺的场景拓扑/俯视布局与轴线数据；现有角色三视图、turnaround、道具/场景资产生成不重复建设。

---

## 可穿戴道具：视觉设计页不可见 / 不可改（待做）

**状态**：问题已确认，暂不改代码。  
**背景**：《桃花源记》里「短刀」被标 `isWearable: true`，分镜可绑定，但视觉设计页道具列表看不到，也无法生成参考图。

### 现状

- `StageAssets` 用 `visibleProps = props.filter(!isWearableProp)` 隐藏可穿戴道具；批量生成同样跳过。
- `PropCard` 没有 `isWearable` 开关，误标后前端无法纠偏。
- 分镜工作台仍可能显示/添加该类道具；出视频时又常按服装过滤，不进道具参考图。

### 已完成

- 结构解析提示词已收紧：普通服装不再作为镜头道具，`isWearable=true` 仅用于需要单独追踪的穿戴物。
- Production Conflict 已能识别旧项目中的可穿戴道具冲突。

### 目标

保留「服装走角色定妆」的意图，同时给误标 / 手持可佩戴物（刀、佩饰等）提供查看与纠偏入口。

### 建议改造

1. 视觉设计页增加「可穿戴 / 归入定妆」折叠区或筛选，默认可展开查看。
2. `PropCard`（或编辑面板）支持切换 `isWearable`，改回普通道具后可生成参考图。
3. 手持武器/工具即使可佩戴，也应按本镜 `presentationMode` 决定是否作为独立道具参考，而不是只看 `isWearable`。
4. 出视频时：已绑镜头且非服装语境的可穿戴道具，仍允许作为道具参考注入。

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
