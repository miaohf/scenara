#!/usr/bin/env python3
"""Test ComfyUI 3x3 turnaround sheet generation (text2img, no img2img)."""

from __future__ import annotations

import asyncio
import base64
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.ai.comfyui import run_comfy_image

REGISTRY = {
    "models": [{
        "id": "comfyui-flux-dev-fp8",
        "type": "image",
        "providerId": "comfyui-local",
        "apiModel": "flux-dev-fp8",
        "params": {"workflowName": "flux-dev-fp8", "steps": 20},
    }],
    "activeModels": {"image": "comfyui-flux-dev-fp8"},
    "providers": [{"id": "comfyui-local", "baseUrl": "http://127.0.0.1:8188"}],
}

TURNAROUND_PROMPT = """Create ONE character turnaround/reference sheet in a 3x3 grid (9 equal panels with thin white separators).
All panels must show the SAME character; only view angle and camera distance change.

Visual Style: 3d-animation (high-quality 3D CGI animation, Pixar/DreamWorks style)
Character: 老王 - portrait of a 62-year-old Chinese man, overweight, square face, short gray hair, blue Mao suit, serious expression

Panels (left to right, top to bottom):
Panel 1 (Top-Left): [正面 / 全身] - Full body front view of elderly Chinese man standing straight, arms at sides
Panel 2 (Top-Center): [正面 / 半身特写] - Medium shot front view showing torso and head
Panel 3 (Top-Right): [正面 / 面部特写] - Close-up front face with gray hair and wrinkles
Panel 4 (Middle-Left): [左侧面 / 全身] - Full body left profile view
Panel 5 (Center): [右侧面 / 全身] - Full body right profile view
Panel 6 (Middle-Right): [3/4侧面 / 半身] - Three-quarter view medium shot
Panel 7 (Bottom-Left): [背面 / 全身] - Full body back view
Panel 8 (Bottom-Center): [仰视 / 半身] - Low angle medium shot looking up
Panel 9 (Bottom-Right): [俯视 / 半身] - High angle medium shot looking down

Constraints:
- Output one single 3x3 grid image only
- Keep face, hair, body, clothing consistent across all panels
- Clean neutral background
Top priority: same person in all 9 panels."""


async def main() -> None:
    out = BACKEND / "data" / "comfy_test" / "turnaround_old_man.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    print("Running turnaround text2img (1:1, NO img2img reference)...")
    result = await run_comfy_image(
        REGISTRY,
        {
            "prompt": TURNAROUND_PROMPT,
            "modelId": "comfyui-flux-dev-fp8",
            "aspectRatio": "1:1",
            "steps": 20,
            "seed": 999,
        },
    )
    b64 = result.get("image_base64", "")
    out.write_bytes(base64.b64decode(b64))
    print(f"Saved: {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    asyncio.run(main())
