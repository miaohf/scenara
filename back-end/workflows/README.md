Place ComfyUI API workflow JSON files in this directory.

For example, an image model configured with workflow name `image_qwen_image_2512_with_2steps_lora` will load:

`workflows/image_qwen_image_2512_with_2steps_lora.json`

A video model configured with workflow name `video_minimax_h3_fl2v` will load:

`workflows/video_minimax_h3_fl2v.json`

A video model configured with workflow name `video_ltx2_5_flf2v` will load:

`workflows/video_ltx2_5_flf2v.json`

A video model configured with workflow name `video_ltx2_3_i2v` will load:

`workflows/video_ltx2_3_i2v.json`

Export the workflow from ComfyUI using API Format JSON.
Front-end model cards edit the `workflowName` field (without `.json`).

### MiniMax H3 白屏排查（TAE 预览正常、成片白）

截图里 **Model Preview Override / taeh3 有画面**，但 **Video Combine 一片灰白**，说明：

- 采样 latent 是好的
- 问题在 **完整 Video VAE 解码** 或 **VHS 封装**，不是首尾帧节点本身

请按顺序查：

1. `Load VAE` 必须是 `minimax_h3_video_vae_fp16.safetensors`（不要用 int8 VAE，已知会解出黑/白屏）
2. 在 `VAEDecode` 后接 `PreviewImage`：若这里已是白屏 → VAE/解码问题；若有画面 → 换掉 VHS，改用 `CreateVideo` + `SaveVideo`
3. ComfyUI 终端是否有 `invalid value encountered in cast` / NaN（解码失败信号）
4. Combined 工作流已改为：`VAEDecode` → `CreateVideo`(bit_depth=8) → `SaveVideo`，并增加 `Preview After VAEDecode` 便于对照
5. 项目默认首尾帧工作流为 `video_minimax_h3_fl2v.json`（Lightning 8-step / 完整 20-step 可切换）

### MiniMax H3 (`video_minimax_h3_fl2v`)

FL2VA 首尾帧图生视频（当前内置 FLF2V 模型默认）。

- `MiniMaxH3ImageToVideo`：`first_frame` / `last_frame`（无尾帧时去掉 `last_frame`）
- `ResolutionSelector` 按比例选分辨率；时长走 `Float (duration)` → Math Expression
- Lightning LoRA：`Boolean (Enable Lightning LoRA)` + `Int (steps full/turbo)`（高质量 20 / 快速预览 8）
- 画布由 ResolutionSelector 输出；`last_frame` 仅在有独立尾帧时注入

**多卡前提（ComfyUI 机器，不是本仓库）：**

1. 安装 [ComfyUI-MiniMaxH3-Parallel](https://github.com/AesSedai/ComfyUI-MiniMaxH3-Parallel) 到 `custom_nodes`
2. 启动时把要用的卡都暴露给同一个进程，并打开 Comfy Kitchen attention：

```bash
CUDA_VISIBLE_DEVICES=0,1,2,3 python main.py --use-ck-attention
```

3. 需要 ComfyUI ≥ 0.33 且 `comfy-kitchen` ≥ 0.2.31；GPU 之间要能双向 peer access
4. 单卡时 `auto` 会退回 1 卡；强制单卡可把节点 `devices` 改成 `disabled`
5. CLIP / VAE / 条件编码仍在主卡。实测 4 卡 denoising 约 2.0×，端到端约 1.4×；不要用 `Torch Compile Model`，也不要把 UNET/CLIP 换成 ComfyUI-MultiGPU loader（会把权重拆到别的卡，和本节点冲突）

未装该节点时 ComfyUI 会报 `MiniMaxH3AttentionParallel` 未知。临时回退：删掉节点 `188`，把 `BasicScheduler` / `BasicGuider` 的 `model` 改回 `["187", 0]`。

### Qwen Image 2.1 T2I (`image_qwen_image_2_1_t2i`)

Qwen Image 2.1 文生图（API Format）。

- 模型：`qwen_image_2.1_int8_convrot` + `qwen3vl_8b_int8_convrot` CLIP + `qwen_image_2.1_vae_bf16`
- 编码节点：`TextEncodeQwenImage21`（`prompt` / `negative_prompt`）
- 画布：`ResolutionSelector` → `EmptyLatentImage`（默认 16:9，运行时按请求覆盖）
- 默认 25 steps / CFG 1 / Euler
- 项目模型：`comfyui-qwen-image-2-1` 的 `workflowName`

### Qwen Image 2.1 Image Edit (`image_qwen_image_2_1_image_edit`)

Qwen Image 2.1 参考图编辑（官方最多 **10** 张：`image_1`…`image_10`）。

- 槽位：`Reference Image 1`–`10` → `TextEncodeQwenImage21` 的 `images.image_1`…`images.image_10`
- 未使用的槽位会在提交前裁掉，避免空 `example.png` 报错
- 可选 `QwenImage21Cache`；`ComfySwitchNode` 控制是否走空 latent
- 提示词可用 `<image1>`…`<image10>` 指代参考图
- 项目模型：`comfyui-qwen-image-2-1` 的 `referenceWorkflowName` / `keyframeWorkflowName`

### FLUX.2 Klein 9B Image Edit (`image_flux2_klein_image_edit_9b_base`)


官方 9B Base Edit，扩为 **4 个参考图槽位**（Klein 官方上限）。

- 槽位：`Reference Image 1`–`4` → Scale → VAE Encode → 链式 `ReferenceLatent`（正/负）
- 未使用的槽位会在提交前裁掉，避免空 `example.png` 报错
- 画布尺寸取自参考图 1（上传前会按宽高比缩放）
- 项目配置：图片模型参数 `keyframeWorkflowName`（默认本文件，`keyframeSteps` 默认 20）

### FLUX.2 Klein 9B T2I (`image_flux2_text_to_image_9b`)

官方模板导出的定妆文生图（API Format）。

- 模型：`flux-2-klein-base-9b-fp8.safetensors` + `qwen_3_8b_fp8mixed` CLIP + Flux2 VAE
- 默认画布 **1344×768（16:9）**，与 MiniMax H3 的原生横屏画布一致；运行时仍可按请求覆盖为 9:16（768×1344）/ 1:1（768×768）
- 默认 20 steps / CFG 5 / Euler（Base；非 Distilled 4-step）
- 画布经 `PrimitiveInt` Width/Height → `EmptyFlux2LatentImage`
- 项目配置：图片模型参数 `workflowName`（定妆）；关键帧 / 九宫格仍可独立配置

### Qwen Image Edit FLF (`image_qwen_image_edit_2511_flf`)

人物/道具一致性首尾帧：可变多参考图。

- 编码节点：内置 `TextEncodeQwenImageEditPlus`（最多 **3** 张可选图；当前环境未装 QwenEditUtils 时不要用 `_lrzjason`）
- 槽位：`Reference Image 1`–`5` 预留；模板默认只接 `image1`，需要时把 2/3 接到 Positive/Negative 的 `image2`/`image3`（4/5 需安装 [Comfyui-QwenEditUtils](https://github.com/lrzjason/Comfyui-QwenEditUtils) 后才能接到编码节点）
- 画布用 `EmptyLatentImage`（不锁死单张底图构图）
- Picture 语义建议：1=场景或连贯底图，其余=角色/道具定妆
- 项目配置：可选 `keyframeWorkflowName`（备用；默认已切到 FLUX.2 Klein Edit）

### Qwen 16:9 比例规范化（测试）(`image_qwen_aspect_normalize_16x9`)

把 GPT Image 等非真 16:9 关键帧重绘成 **1344×768**，供 MiniMax H3 FLF2V 使用。

- 基于 `image_qwen_image_edit_2511_20260908`，画布改为 `EmptyLatentImage`（Width/Height=1344×768）
- `Reference Image 1` = 源关键帧（建议先 contain 垫边，保留完整主体）
- 默认 prompt：保持身份/姿势，只外扩背景填满 16:9；禁止拉伸
- 默认 **Lightning 4 steps**（测试够用）；质量对比加 `--steps 40`
- `denoise=1`（空 latent 全量采样）
- 本地试跑：

```bash
cd back-end
uv run python scripts/test_aspect_normalize.py /path/to/keyframe.png \
  --base http://100.64.0.35:8188 \
  --out /tmp/aspect-norm-16x9.png
```

完整质量：

```bash
uv run python scripts/test_aspect_normalize.py /path/to/keyframe.png \
  --base http://100.64.0.35:8188 \
  --steps 40 \
  --out /tmp/aspect-norm-16x9-hq.png
```

仅检查工作流能否被 patch：

```bash
uv run python scripts/test_aspect_normalize.py /path/to/keyframe.png --inspect-only
```
