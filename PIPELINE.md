# 生产全流程：剧本 → 分镜 → 视频 → 出片

目标态管线（含已落地节点与待做优化）。现状与差距见文末。

相关待办：[TO_DO.md · 结构审片 Agent](./TO_DO.md#结构审片-agent允许删并镜与-beat-重排待做)

## 流程图（目标态）

```mermaid
flowchart TD
  subgraph S1["1. 剧本 StageScript"]
    A0[用户输入 / 导入原稿] --> A1{AI 操作}
    A1 -->|续写| A2[continueScript]
    A1 -->|全文改写| A3[多阶段改写 Agent]
    A1 -->|选段改写| A4[rewriteScriptSegment]
    A1 -->|不改写| A5[沿用当前稿]
    A2 --> A6[更新剧本正文]
    A3 --> A6
    A4 --> A6
    A5 --> A6
    A6 --> A6b{{故事层一致性门禁<br/>软警告 · 已落地}}
    A6b -->|缺口/断层| A6c[标 warning 继续]
    A6c --> A7
    A6b -->|通过 / 跳过| A7[parseScriptStructure<br/>人物 / 场景 / 道具]
    A7 --> A7b[资产引用规范化<br/>name→ID · 见 TO_DO]
    A7b --> A8[风格与镜头时长配置]
    A8 --> A8b[视觉设计 enrichScriptDataVisuals<br/>生成 Art Direction + 角色/场景/道具视觉提示词]
    A8b --> A9[生成分镜脚本 generateShotList]
  end

  subgraph S2["2. 分镜 Agent 管线"]
    A9 --> B1[导演 Plan / Beats]
    B1 --> B2[按场景生成 Shot 列表]
    B2 --> B2b[确定性质量管线<br/>字段 / 关键帧 / 文案去重]
    B2b --> B3{{结构审片 Agent<br/>删/并/重排 · 已落地}}
    B3 -->|提案| B3a{自动应用 autoSafe?}
    B3a -->|否 / 仅标记| B3b[带结构 warning 的分镜稿]
    B3a -->|是| B3c[应用结构修复<br/>重建连续性 + 确定性管线]
    B3c --> B4
    B3 -->|无结构问题| B4
    B3b --> B4[字段级审片 Agent<br/>终审：局部改文案 · 禁增删镜]
    B4 --> B5[分镜稿入库]
  end

  subgraph S3["3. 视觉资产 ∥ 提示词预编译"]
    B5 --> C0{并行}
    C0 --> C1[StageAssets<br/>定妆 / 场景 / 道具参考图]
    C0 --> P1[可先编译视频提示词草稿<br/>弱参考 / 无参考预览 · 待优化]
    C1 --> C1b[可穿戴道具可见与纠偏<br/>见 TO_DO]
    C1b --> C2[批量或单张生成参考图]
    C2 --> C3[资产就绪]
    P1 --> D0
    C3 --> D0[Ref2VA 硬依赖满足]
  end

  subgraph S4["4. 导演台 StageDirector"]
    D0 --> D1[镜头工作台<br/>关键帧 / 九宫格 / 对白]
    D1 --> D2[编译 / 批量重建提示词<br/>H3 Ref2VA / FLF2V<br/>manual-edit 不覆盖]
    D2 --> D3[预检 runVideoPreflight]
    D3 -->|不通过| D3b{连续失败?}
    D3b -->|否| D2
    D3b -->|是 · 待做| D3c[标 H3 不可行<br/>回流局部重写该镜]
    D3c --> B3c
    D3 -->|通过| D4[排队生成视频]
    D4 --> D5[单镜成片<br/>对账 / 失败感知 / stale 清理 · 见 TO_DO]
    D5 -->|生成失败| D5b{可归因于分镜?}
    D5b -->|是 · 待做| D3c
    D5b -->|否| D1
    D5 --> D6{全部镜头完成?}
    D6 -->|否| D1
    D6 -->|是| D7[时间线预览 / 配音]
  end

  subgraph S5["5. 出片 StageExport"]
    D7 --> E0{{成片级 continuity pass<br/>跳切 / 音画 / 失败占位 · 待做}}
    E0 -->|不通过| D1
    E0 -->|通过| E1[拼接 / 导出成片]
    E1 --> E2[成片交付]
  end
```

## 设计原则

1. **结构审在前，字段审在后**：叠戏/缺转场先删并重排；字段级审片只做终审或对受影响镜增量审，避免白跑。
2. **故事层先于分镜**：改写/续写后的大纲缺口尽量在进 `generateShotList` 前拦住，少造废镜。
3. **视觉设计先于分镜**：点击“生成分镜脚本”后，`handleAnalyze` 会进入 `visuals` 阶段，由 `enrichScriptDataVisuals` 生成全局 `Art Direction`，并据此生成角色、场景、道具的视觉提示词；StageAssets 再使用这些提示词生成参考图。单独点击“AI 改写”只更新 `rawScript`，不会生成角色设计提示词。
4. **资产与视频提示词可并行**：分镜定稿后即可编草稿提示词；参考图齐备后再升为 Ref2VA 硬依赖。
5. **视频失败可回流**：连续预检失败或可归因的成片失败，标镜并触发局部重写，而不是只停在改 prompt。
6. **出片前再过一次成片级检查**：与分镜结构审分工——前者管叙事结构，后者管跳切/音画/失败占位。

## 审片 / 门禁分层

| 层级 | 时机 | 能力 | 现状 |
|------|------|------|------|
| 故事层一致性门禁 | 导演 plan 之后、场景分镜前 | 相对大纲查缺口（软警告） | **已落地** |
| 确定性管线 | 分镜生成后立刻 | 必填字段、关键帧、同场景 action 文案全重复 | 已有 |
| **结构审片** | 确定性管线之后、字段审之前 | 删/并/重排；autoSafe 自动应用 | **已落地** |
| 字段级审片 | 结构稳定后 | 改 action/对白/运镜/关键帧文案；不增删镜 | 已有 |
| 视频回流 | 预检/成片连续失败 | 标 H3 不可行 → 局部重写 | 待做 |
| 成片 continuity | 导出前 | 跳切、音画、失败镜占位 | 待做 |

## 路径说明

- **直接分镜出视频**：跳过改写走 `A5 → A6b…`；故事门禁可跳过（关闭质量校验时一并关闭）。
- **视觉设计生成**：主路径是“生成分镜脚本”按钮内部的 `handleAnalyze → visuals`：`enrichScriptDataVisuals` 先调用 `generateArtDirection`，再调用角色/场景/道具视觉提示词生成；其结果写入 `scriptData.artDirection` 与各资产的 `visualPrompt`。
- **AI 改写的边界**：`handleRewriteScript` 只负责改写并保存 `rawScript`；它不会自动接着执行结构解析、视觉设计或分镜生成。改写后需要再点击“生成分镜脚本”，才会进入上述完整流程。
- **视觉设计补偿路径**：如果主路径没有生成或项目切换了视觉风格，`StageAssets` 在生成资产前检查 `scriptData.artDirection`，必要时重新生成并保存，然后生成对应资产提示词。
- **`manual-edit` 提示词**：批量重建不得覆盖用户手改。
- **尚未落地**：资产∥提示词并行、视频失败回流、出片 continuity、结构提案人工确认闸、`regenerateBeat` 真重生成。

## 相对旧图的调整摘要

| 项 | 旧图 | 当前 |
|----|------|------|
| 审片顺序 | 仅字段审 | 结构审 → 字段终审 |
| 剧本后 | 直接 parse | 分镜前故事层软门禁 |
| 视觉设计 | 位置不明确 | `enrichScriptDataVisuals` 在分镜前生成 Art Direction 与资产 visualPrompt |
| 结构叠戏 | 无法自动修 | autoSafe 删/并/重排 |
| 资产 vs 提示词 | 严格串行 | 仍串行（并行待做） |
| 预检/成片失败 | 停在改 prompt | 回流待做 |
| 出片 | 一框「拼接/导出」 | continuity 待做 |
