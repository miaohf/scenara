# Scenara 数据字段设计说明

更新时间：2026-09-10  
适用范围：`front-end/src/types.ts`、前端存储适配层、`back-end/app/models` 与项目/媒体 API。

## 1. 设计概览

Scenara 当前采用三层设计：

1. **前端领域模型**：在 `front-end/src/types.ts` 中用 TypeScript 定义项目、剧集、角色、场景、道具、分镜和生成任务等字段。
2. **后端持久化模型**：项目库字段和剧集基础字段由 SQLAlchemy 管理；剧集的大部分业务数据放在一个 JSON `payload` 字段中。
3. **媒体对象存储**：图片、视频等大文件优先落到后端本地媒体目录或 S3/MinIO，业务 JSON 保存媒体引用 URL；旧的本地数据仍可能保留 base64 或 OPFS 引用。

因此，字段“定义”主要在前端，但 API 模式下真正的持久化由后端数据库完成。后端目前并没有为 `Character`、`Prop`、`Shot` 等嵌套对象建立独立关系表。

## 2. 实体关系

```text
SeriesProject（项目）
├── characterLibrary[]       项目级角色资产库
├── sceneLibrary[]           项目级场景资产库
├── propLibrary[]            项目级道具资产库
└── Series[]（系列）
    └── Episode[]（剧集/制作单元）
        ├── rawScript                         原始剧本
        ├── scriptData                        AI 解析后的结构化剧本
        │   ├── characters[]                  剧集角色
        │   ├── scenes[]                      剧集场景
        │   ├── props[]                       剧集道具
        │   └── storyParagraphs[]              故事段落与场景引用
        ├── shots[]                            分镜列表
        │   ├── characters[]                   角色 ID 引用
        │   ├── props[]                        道具 ID 引用
        │   ├── propUsages{}                   镜头级道具关系约束
        │   ├── keyframes[]                    起始帧/尾帧
        │   ├── interval                       视频区间
        │   └── nineGrid / dubbing              可选高级数据
        ├── renderLogs[]                       生成记录
        └── promptTemplateOverrides            当前项目的提示词模板改动
```

字段之间的核心原则是：**资产保存视觉事实，镜头保存使用关系，生成任务保存结果和状态**。镜头不应把完整角色或道具对象复制一份，而应通过 ID 解析资产，再叠加镜头特有的动作、位置和携带方式。

## 3. 项目、系列与剧集

### 3.1 `SeriesProject`

文件位置：`front-end/src/types.ts` 的 `SeriesProject`。

- `id`：项目 ID。IndexedDB 模式通常是 `sproj_...`；API 模式由后端生成 UUID。
- `title`：项目名称。
- `description`：项目简介，可选。
- `coverImage`：项目封面引用，可选。
- `createdAt`、`lastModified`：前端使用的毫秒时间戳。
- `visualStyle`：项目默认视觉风格，例如 `3d-animation`、`anime`、`live-action`。
- `language`：项目默认输出语言。
- `artDirection`：全局美术指导，约束色彩、比例、线条、光影、材质和风格锚点。
- `characterLibrary[]`、`sceneLibrary[]`、`propLibrary[]`：项目级可复用资产库。

项目级资产库是跨剧集复用的“母版”。剧集内的 `scriptData.characters/scenes/props` 是本剧集的工作副本，并通过 `characterRefs`、`sceneRefs`、`propRefs` 记录与资产库版本的同步关系。

### 3.2 `Series`

- `id`：系列 ID。
- `projectId`：所属项目 ID。
- `title`：系列名称。
- `sortOrder`：系列排序。
- `createdAt`、`lastModified`：时间戳。

系列目前主要承担项目与剧集之间的组织层级，业务内容主要保存在剧集。

### 3.3 `Episode`

`Episode` 是当前产品的主要制作单元，也是“脚本 → 资产 → 分镜 → 首尾帧 → 视频”的状态容器。

- `id`：剧集 ID。
- `projectId`、`seriesId`：所属项目和系列。
- `episodeNumber`：集数。
- `title`：剧集标题。
- `createdAt`、`lastModified`：创建和更新时间。
- `stage`：当前阶段，取值为 `script`、`assets`、`director`、`export`、`prompts`。
- `rawScript`：用户粘贴或导入的原始剧本。
- `targetDuration`：目标成片时长。
- `language`：该剧集的输出语言，可覆盖项目默认语言。
- `visualStyle`：该剧集的视觉风格，可覆盖项目默认风格。
- `shotGenerationModel`：分镜生成所使用的模型标识。
- `scriptData`：结构化剧本，尚未生成时为 `null`。
- `shots[]`：分镜数组。
- `isParsingScript`：是否正在执行脚本解析/生成流程。
- `renderLogs[]`：生成和失败记录。
- `characterRefs[]`、`sceneRefs[]`、`propRefs[]`：剧集资产与项目资产库的同步信息。
- `promptTemplateOverrides`：只保存用户改过的提示词模板字段。
- `scriptGenerationCheckpoint`：脚本分阶段生成的断点，支持 `structure`、`visuals`、`shots` 三步恢复。

`ProjectState` 当前是 `Episode` 的别名，说明旧版页面仍把剧集当作页面主状态使用；新项目结构则通过 `SeriesProject → Series → Episode` 管理。

## 4. 结构化剧本 `ScriptData`

### 4.1 顶层字段

- `title`：剧本标题。
- `genre`：题材。
- `logline`：一句话梗概。
- `targetDuration`：剧本目标时长，可选。
- `language`：结构化输出语言，可选。
- `visualStyle`：视觉风格，可选。
- `shotGenerationModel`：分镜生成模型，可选。
- `planningShotDuration`：用于规划镜头数量的基准时长。
- `artDirection`：全局画风文档。
- `productionBible`：项目制作圣经，锁定世界规则、服装事实、场景锚点、摄影语言和不可随意改写的决策。
- `characters[]`：角色资产。
- `scenes[]`：场景资产。
- `props[]`：道具资产。
- `storyParagraphs[]`：故事段落，包含 `id`、`text` 和 `sceneRefId`。
- `generationMeta`：结构提取、视觉补全和分镜生成的输入指纹，用于判断缓存是否仍然有效。

### 4.2 `ArtDirection`

`ArtDirection` 负责“画面怎么长”，不负责具体剧情事实：

- `colorPalette`：`primary`、`secondary`、`accent`、`skinTones`、`saturation`、`temperature`。
- `characterDesignRules`：`proportions`、`eyeStyle`、`lineWeight`、`detailLevel`。
- `lightingStyle`：统一光影。
- `textureStyle`：材质和纹理。
- `moodKeywords[]`：核心风格关键词。
- `consistencyAnchors`：注入后续提示词的统一风格锚点。
- `visualStyle`：生成该文档时使用的风格 ID。

### 4.3 `ProductionBible`

`ProductionBible` 负责“故事事实和制作禁区”：

- `version`：制作圣经版本。
- `worldRules`：世界观规则。
- `costumeRules`：服装和造型规则。
- `sceneAnchors`：场景锚点。
- `characterVoiceRules`：角色行为/口吻规则。
- `cameraLanguage`：摄影语言。
- `platformGuardrails`：平台或工作流约束。
- `pinnedDecisions[]`：需要在后续阶段保持不变的决策。
- `updatedAt`：更新时间。

把 `ArtDirection` 与 `ProductionBible` 分开，可以避免“为了画面更好看”而改掉服装颜色、道具类型或故事事实。

## 5. 资产字段

### 5.1 `Character`

- `id`、`name`：角色 ID 和名称。
- `gender`、`age`、`personality`、`species`：基础角色事实。
- `wardrobe`：剧本明确的基础服饰，是角色服装的主要文字来源。
- `visualPrompt`：角色视觉提示词。
- `promptVersions[]`：提示词版本历史，记录来源为 AI、人工、回滚、导入或系统。
- `negativePrompt`：角色生成的负面提示词。
- `coreFeatures`：角色核心特征。
- `shapeReferenceImage`：仅用于轮廓/体型参考的图片。
- `referenceImage`：当前角色主参考图。
- `turnaround`：九宫格角色视图及其面板描述。
- `threeView`：三视图数据。
- `activeImageView`：当前使用的视图类型：`casting`、`turnaround`、`threeView`。
- `imageHistory[]`：历史生成/上传图片，可选择历史版本应用。
- `variations[]`：角色服装或状态变体。
- `status`：`pending`、`generating`、`completed`、`failed`。
- `libraryId`、`libraryVersion`、`version`：资产库来源和版本信息。

`CharacterVariation` 额外包含 `wardrobe`、`sceneIds[]`、`visualPrompt`、`negativePrompt`、`referenceImage` 和 `status`，用于表达“同一角色在不同场景下的服装变体”，但不应覆盖角色的基础身份事实。

### 5.2 `Scene`

- `id`、`location`：场景 ID 和地点。
- `time`：时间、天气或时段。
- `atmosphere`：氛围描述。
- `visualPrompt`：场景视觉提示词。
- `promptVersions[]`：场景提示词历史。
- `negativePrompt`：场景负面提示词。
- `shapeReferenceImage`：构图/轮廓参考。
- `referenceImage`：场景参考图。
- `status`：生成状态。
- `libraryId`、`libraryVersion`、`version`：资产库同步信息。

### 5.3 `Prop`

- `id`、`name`、`category`、`description`：道具基本事实。
- `isWearable`：是否是穿戴在角色身上的服装组件。
- `wardrobeOwnerCharacterId`：兼容旧数据时记录服装归属角色。
- `presentationMode`：默认呈现方式。
- `presentationNote`：只有需要补充关系时才填写，例如“两个短提手，不使用肩带”。
- `forbiddenPresentationModes[]`：禁止的呈现方式，例如 `backpack`、`shoulder-worn`。
- `visualPrompt`、`negativePrompt`、`promptVersions[]`：道具生成提示词及历史。
- `shapeReferenceImage`、`referenceImage`：形状参考和当前道具参考图。
- `status`：生成状态。
- `libraryId`、`libraryVersion`、`version`：资产库同步信息。

`presentationMode` 当前支持：

- `handheld`：手持/手提。
- `worn`：穿戴或背负。
- `placed`：放置在场景中。
- `mounted`：固定、安装在载体上。
- `background`：背景中的物件。
- `used`：正在被操作或使用。
- `unknown`：未知，不强行添加关系约束。

这组字段表达的是**结构化事实**，不是要求每次把整段说明展开进提示词。生成镜头时的约束优先级为：

1. `shot.propUsages[propId]` 镜头级覆盖；
2. `Prop.presentationMode` 和其他道具事实；
3. 旧数据的保守推断；
4. 无法判断时保持 `unknown`，不添加强约束。

## 6. 分镜与生成结果

### 6.1 `Shot`

- `id`：镜头 ID。
- `sceneId`：引用的场景 ID。
- `actionSummary`：镜头动作摘要。
- `dialogue`：对白或旁白，可选。
- `cameraMovement`：镜头运动。
- `shotSize`：景别。
- `characters[]`：角色 ID 数组。
- `characterVariations{}`：角色 ID 到变体 ID 的映射。
- `props[]`：道具 ID 数组，引用 `scriptData.props`。
- `propUsages{}`：镜头级道具关系约束。
- `keyframes[]`：起始帧和尾帧。
- `interval`：视频区间。
- `qualityAssessment`：AI 质量评估结果。
- `videoModel`：视频模型 ID。
- `videoInputMode`：`keyframes` 或 `storyboard-grid`，二者互斥。
- `nineGrid`：可选的网格分镜预览。
- `dubbing`：可选的镜头配音。

### 6.2 `ShotPropUsage`

这是解决“同一道具在不同镜头中关系不同”的关键字段：

- `mode`：本镜头的呈现方式。
- `actorId`：由哪个角色携带或使用。
- `hand`：左手、右手、双手或任意手。
- `position`：画面中的位置。
- `action`：拿起、放下、打开、操作等动作。
- `forbiddenModes[]`：本镜头禁止的错误呈现方式。

例如，工具包默认是 `handheld`，在某个镜头中可以进一步写成：

```json
{
  "mode": "handheld",
  "actorId": "mara",
  "hand": "right",
  "position": "beside her right thigh",
  "action": "carried by the short top handles",
  "forbiddenModes": ["backpack", "shoulder-worn"]
}
```

它不会改变道具本身的图片，只会在生成该镜头时补充简短关系约束和对应负面提示词。

### 6.3 `Keyframe` 与 `VideoInterval`

`Keyframe`：

- `id`：帧 ID。
- `type`：`start` 或 `end`。
- `visualPrompt`：该帧的视觉提示词。
- `promptVersions[]`：提示词历史。
- `imageUrl`：生成或上传的图片引用。
- `status`：生成状态。

`VideoInterval`：

- `id`：视频区间 ID。
- `startKeyframeId`、`endKeyframeId`：首尾帧引用。
- `duration`：视频时长。
- `motionStrength`：运动强度。
- `videoUrl`：视频引用。
- `videoPrompt`：视频提示词。
- `promptVersions[]`：视频提示词历史。
- `status`：视频状态。

### 6.4 网格、配音和质量评估

- `NineGridData` 保存 `panels[]`、网格布局、网格图、生成提示词和状态。
- `NineGridPanel` 保存面板索引、景别、机位和描述，可附带 `descriptionZh`。
- `ShotDubbing` 保存配音模式、文本、模型、音色、格式、音频引用、转录文本和状态。
- `ShotQualityAssessment` 保存总分、等级、生成时间、逐项检查和摘要。

## 7. 提示词字段与生成流程

### 7.1 提示词历史

`PromptVersion` 是通用历史结构：

- `id`：版本 ID。
- `prompt`：当时的完整提示词。
- `createdAt`：创建时间。
- `source`：`ai-generated`、`manual-edit`、`rollback`、`imported` 或 `system`。
- `note`：可选备注。

角色、角色变体、场景、道具、关键帧和视频区间都可以保存提示词历史，便于回滚和比较。

### 7.2 模板覆盖

`PromptTemplateConfig` 分为四组：

- `storyboard`：分镜生成、修复、动作建议和镜头拆分。
- `keyframe`：首帧、尾帧、角色一致性、道具参考、九宫格来源和 AI 优化。
- `nineGrid`：网格拆分、图片前后缀、面板描述和翻译/改写。
- `video`：不同视频模型、首尾帧模式、网格模式和约束说明。

`PromptTemplateOverrides` 只保存改动过的子字段，不把默认模板整份复制到每个项目中。

当前镜头提示词的道具约束流程是：

```text
资产事实
  → 解析镜头引用
  → 生成简短 relation/presentation lock
  → 可选 AI 优化
  → 再次追加不可被 AI 改写的锁定约束
  → 发送 prompt + negativePrompt 到图片/视频工作流
```

这样做的目的，是让 AI 可以优化构图和语言，同时避免把“手提工具包”改写成“背包”、把锁定的服装颜色改掉。

## 8. 持久化方式

### 8.1 IndexedDB 本地模式

未启用 API 存储时，前端使用浏览器 IndexedDB：

- 数据库名：`BigBananaDB`。
- 当前版本：`DB_VERSION = 3`。
- `seriesProjects`：项目。
- `series`：系列。
- `episodes`：剧集完整对象。
- `assetLibrary`：旧版/通用资产库。
- `projects`：兼容旧数据的项目存储。

剧集以 `Episode` 整体写入 `episodes` store，保存前会执行旧数据规范化、服装道具兼容处理以及部分视频存储迁移。视频在支持 OPFS 的浏览器中可以使用 `opfs://video/...` 引用；导出时再物化为可移植数据。

### 8.2 API 模式

当 `NEXT_PUBLIC_USE_API_STORAGE=true` 时，前端通过 API 适配层保存：

- `GET /v1/projects`、`GET /v1/projects/{id}`：项目。
- `PATCH /v1/projects/{id}`：更新项目库和设置。
- `GET /v1/projects/{id}/series`：系列列表。
- `GET /v1/projects/{id}/episodes`：剧集摘要，不返回完整 payload。
- `GET /v1/episodes/{id}`：加载完整剧集。
- `POST /v1/projects/{id}/episodes`：创建剧集。
- `PATCH /v1/episodes/{id}`：更新剧集基础字段并合并完整 payload。
- `PATCH /v1/episodes/{id}/payload`：只合并变化的 payload 顶层键。

前端会把 `Episode` 中除 `id`、`projectId`、`seriesId`、`episodeNumber`、`title`、`stage`、`createdAt`、`lastModified` 之外的字段放入 `payload`。因此以下数据目前都在同一个 JSON 对象中：

```text
payload
├── rawScript
├── targetDuration / language / visualStyle
├── scriptData
├── shots
├── isParsingScript
├── renderLogs
├── characterRefs / sceneRefs / propRefs
├── promptTemplateOverrides
└── scriptGenerationCheckpoint
```

后端 `Episode.payload` 是数据库 JSON 列；`EpisodeUpdate.payload` 和 `EpisodePayloadPatch.payload` 接受任意 JSON 对象。后端会按 payload 顶层键合并，并对 `shots`、`scriptData.characters/scenes/props` 做按 ID/名称的保护性合并，避免生成任务完成后的媒体结果被较旧的 generating 快照覆盖。

### 8.3 项目库与剧集工作副本的区别

API 模式下，`SeriesProject` 的 `character_library`、`scene_library`、`prop_library` 和 `settings` 是独立数据库 JSON 列；剧集的角色、场景和道具则位于 `Episode.payload.scriptData`。

推荐把它们理解为：

- **项目库**：跨剧集复用的稳定资产母版。
- **剧集资产**：本剧集的解析结果和可编辑副本。
- **镜头引用**：只保存 ID 与镜头关系，不重复保存完整资产。

### 8.4 媒体文件

后端媒体存储支持：

- `local`：默认写入 `MEDIA_LOCAL_DIR`，默认值是 `./data/media`。
- `s3`：写入 S3/MinIO。

生成任务完成后，后端通常把图片/视频保存为媒体对象，并在 payload 中写入带签名的 URL；签名 URL 默认有效期较长。这样可以避免把大型 base64 图片和视频反复写入数据库。需要注意：类型注释和旧的 IndexedDB 数据仍兼容 `data:image/...`、`data:video/...` 等内嵌格式，所以迁移和导出逻辑不能假设所有媒体都是 URL。

## 9. 状态与生命周期

资产、关键帧、视频和配音都采用类似的状态机：

```text
pending → generating → completed
                    ↘ failed
```

`renderLogs[]` 是不可替代的审计/排错信息，记录：

- `id`、`timestamp`。
- `type`：角色、角色变体、场景、道具、关键帧、视频或脚本解析。
- `resourceId`、`resourceName`：具体资源。
- `status`：成功或失败。
- `model`：使用的模型。
- `prompt`：实际提示词，可选。
- `error`：错误信息，可选。
- `inputTokens`、`outputTokens`、`totalTokens`：token 统计，可选。
- `duration`：耗时，可选。

生成任务自身的队列状态由后端任务系统维护；任务完成后通过目标信息把结果写回剧集 payload，更新对应资产、关键帧或视频区间。

## 10. 兼容性与当前边界

当前设计对旧数据较友好：

- 新增字段大多是可选字段，旧 JSON 可以继续加载。
- `normalizeEpisode` 会补齐部分旧版服装和道具信息。
- `presentationMode = unknown` 不会为旧数据强行增加关系约束。
- API 后端使用通用 JSON payload，因此新增字段通常不需要数据库迁移。
- `merge_episode_payload` 能保护已经完成的媒体结果，降低并发自动保存覆盖风险。

但它也有明确边界：

1. 后端不会像关系表那样校验嵌套字段的完整性；错误字段可能被原样保存。
2. payload 内部字段不可方便地按 `shots[].props[]`、`scriptData.props[].presentationMode` 建立数据库索引或统计查询。
3. 前端 TypeScript 类型和后端 JSON schema 目前存在两份定义，长期可能产生漂移。
4. 旧的 base64 数据会显著增大 IndexedDB 导出文件和 API 请求体。
5. 只保存媒体 URL 时，媒体存储清理和 URL 失效处理必须与剧集删除/备份策略配套。

## 11. 后续建议

如果继续演进，建议按以下优先级处理：

1. 为 `Episode.payload` 增加 `schemaVersion`，并集中维护迁移函数。
2. 为 `ScriptData`、`Shot`、`Prop` 建立后端 Pydantic 校验模型；不必立即拆成关系表，但至少校验 ID、状态枚举和引用关系。
3. 为角色、场景、道具统一使用 `assetId + version`，减少名称匹配带来的歧义。
4. 把媒体字段统一命名为引用类型，并明确区分 `media URL`、`data URL` 和 `opfs://`。
5. 将生成任务请求与业务结果分开保存：请求参数进入任务记录，最终媒体和状态回写 Episode；这样更容易重试、审计和比较不同模型效果。
6. 对 `Prop.presentationMode` 等“事实字段”设置锁定来源，提示词生成器只能引用，不得擅自改写；镜头级 `propUsages` 只负责局部关系。

## 12. 一个道具在镜头中的完整示例

资产定义：

```json
{
  "id": "prop_canvas_tool_bag",
  "name": "Canvas tool bag",
  "category": "tool",
  "description": "A compact canvas tool bag with two short top handles.",
  "presentationMode": "handheld",
  "presentationNote": "Carry by the short top handles; do not use a shoulder strap.",
  "forbiddenPresentationModes": ["backpack", "shoulder-worn"],
  "referenceImage": "/api/v1/media/raw/users/1/tool-bag.png"
}
```

镜头引用：

```json
{
  "id": "shot_002",
  "characters": ["character_mara"],
  "props": ["prop_canvas_tool_bag"],
  "propUsages": {
    "prop_canvas_tool_bag": {
      "mode": "handheld",
      "actorId": "character_mara",
      "hand": "right",
      "action": "holds it by the two short handles",
      "forbiddenModes": ["backpack", "shoulder-worn"]
    }
  }
}
```

资产事实和镜头关系分开保存后，同一个工具包可以在另一个镜头中变为 `placed` 或 `used`，而不会污染它的基础外观，也不会把所有镜头都强制成同一种构图。
