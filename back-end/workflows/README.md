Place ComfyUI API workflow JSON files in this directory.

For example, an image model configured with workflow name `image_qwen_image_2512_with_2steps_lora` will load:

`workflows/image_qwen_image_2512_with_2steps_lora.json`

A video model configured with workflow name `video_minimax_h3_flft2v` will load:

`workflows/video_minimax_h3_flft2v.json`

A video model configured with workflow name `video_ltx2_5_flf2v` will load:

`workflows/video_ltx2_5_flf2v.json`

A video model configured with workflow name `video_ltx2_3_i2v` will load:

`workflows/video_ltx2_3_i2v.json`

Export the workflow from ComfyUI using API Format JSON.
Front-end model cards edit the `workflowName` field (without `.json`).

### MiniMax H3 (`video_minimax_h3_flft2v`)

- Official canvas is **1344×768** (16:9) or **768×1344** (9:16), always a multiple of 32 (VAE is 16×, patch is 2).
- Width / Height are PrimitiveInt nodes (`title`: Width / Height), not ResolutionSelector.
- `last_frame` is optional: only connected when a distinct end frame is provided. Wiring the same image as first+last often yields a white picture with working audio.
- CreateVideo `bit_depth` must be `8` (not `auto`).
