#!/usr/bin/env python3
"""Test 16:9 aspect-normalize workflow (Qwen Edit + EmptyLatent 1344x768).

Usage:
  cd back-end
  uv run python scripts/test_aspect_normalize.py /path/to/keyframe.png

Optional:
  --base http://100.64.0.35:8188
  --out /tmp/aspect-norm.png
  --steps 4
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.ai.comfyui import (  # noqa: E402
    _resize_image_bytes,
    load_workflow_template,
    patch_image_workflow,
    run_comfy_image,
)

WORKFLOW = "image_qwen_aspect_normalize_16x9"
DEFAULT_PROMPT = (
    "Recompose Image 1 into a true 16:9 widescreen cinematic frame. "
    "Keep the same subject identity, pose, wardrobe, camera angle, lighting, and scene content. "
    "Extend only the background or environment into any missing side margins so the final image "
    "fills the full frame edge-to-edge. Do not stretch or squash the subject. "
    "No letterbox bars, borders, text, logos, or watermarks."
)


def build_registry(base_url: str) -> dict:
    return {
        "models": [
            {
                "id": "comfyui-aspect-normalize",
                "type": "image",
                "providerId": "comfyui-local",
                "apiModel": WORKFLOW,
                "params": {
                    "apiFormat": "comfyui",
                    "workflowName": WORKFLOW,
                    # 测试默认走 Lightning 4-step；质量对比再用 --steps 40
                    "steps": 4,
                    "defaultAspectRatio": "16:9",
                    "supportedAspectRatios": ["16:9", "9:16", "1:1"],
                },
            }
        ],
        "activeModels": {"image": "comfyui-aspect-normalize"},
        "providers": [{"id": "comfyui-local", "baseUrl": base_url}],
    }


def inspect_patch(image_path: Path) -> None:
    raw = image_path.read_bytes()
    letterboxed = _resize_image_bytes(raw, 1344, 768, fit="contain")
    wf = load_workflow_template(WORKFLOW)
    nodes = patch_image_workflow(
        wf,
        prompt=DEFAULT_PROMPT,
        negative_prompt="",
        width=1344,
        height=768,
        seed=42,
        steps=4,
        reference_image_name="ref-demo.png",
        reference_image_names=["ref-demo.png"],
        denoise=1.0,
    )
    sampler = nodes["170:169"]["inputs"]
    latent = nodes["norm:latent"]["inputs"]
    lightning = nodes["170:168"]["inputs"]["value"]
    print("=== patch inspect ===")
    print("source bytes", len(raw), "-> letterbox preview bytes", len(letterboxed))
    print("sampler latent_image", sampler.get("latent_image"))
    print("sampler denoise", sampler.get("denoise"))
    print("lightning 4step", lightning)
    print("empty latent size", latent.get("width"), latent.get("height"))
    print("width node", nodes["norm:width"]["inputs"]["value"])
    print("height node", nodes["norm:height"]["inputs"]["value"])
    print("prompt head", (nodes["170:151"]["inputs"].get("prompt") or "")[:120], "...")


async def run(image_path: Path, *, base_url: str, out: Path, steps: int) -> None:
    raw = image_path.read_bytes()
    # 先 contain 到 16:9，保留完整主体；工作流再用 EmptyLatent 重绘满幅。
    letterboxed = _resize_image_bytes(raw, 1344, 768, fit="contain")
    data_url = "data:image/png;base64," + base64.b64encode(letterboxed).decode("ascii")
    registry = build_registry(base_url)
    print(f">>> run {WORKFLOW} base={base_url} steps={steps}")
    result = await run_comfy_image(
        registry,
        {
            "prompt": DEFAULT_PROMPT,
            "modelId": "comfyui-aspect-normalize",
            "workflowName": WORKFLOW,
            "aspectRatio": "16:9",
            "steps": steps,
            "referenceImages": [data_url],
        },
    )
    b64 = result.get("image_base64") or ""
    if not b64:
        raise SystemExit(f"no image returned: {result.keys()}")
    out.write_bytes(base64.b64decode(b64))
    print(f"OK -> {out} ({out.stat().st_size} bytes) url={result.get('image_url')}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("image", type=Path, help="Source keyframe / still image")
    parser.add_argument("--base", default="http://127.0.0.1:8188", help="ComfyUI base URL")
    parser.add_argument("--out", type=Path, default=Path("/tmp/aspect-norm-16x9.png"))
    parser.add_argument(
        "--steps",
        type=int,
        default=4,
        help="4 = Lightning preview (default); 40 = full quality",
    )
    parser.add_argument("--inspect-only", action="store_true", help="Only validate workflow patching")
    args = parser.parse_args()
    if not args.image.is_file():
        raise SystemExit(f"image not found: {args.image}")

    inspect_patch(args.image)
    if args.inspect_only:
        return
    asyncio.run(run(args.image, base_url=args.base, out=args.out, steps=args.steps))


if __name__ == "__main__":
    main()
