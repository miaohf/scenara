#!/usr/bin/env python3
"""Single-shot ComfyUI image workflow test — verify prompt injection & CN vs EN."""

from __future__ import annotations

import asyncio
import base64
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))

from app.services.ai.comfyui import load_workflow_template, patch_image_workflow, run_comfy_image

OLD_MAN_CN = (
    "中国男性，62岁，身材微胖，方脸，短灰白头发，"
    "穿朴素蓝色中山装，严肃表情，3D CGI Pixar风格，单人肖像，白色背景"
)
OLD_MAN_EN = (
    "portrait of a 62-year-old Chinese man, overweight, square face, short gray hair, "
    "blue Mao suit, serious expression, solo, white background, photorealistic"
)
YOUNG_WOMAN_EN = (
    "portrait of an 18-year-old Chinese woman, slim, long black hair, white t-shirt, "
    "smiling, solo, white background, photorealistic"
)

REGISTRY = {
    "models": [
        {
            "id": "comfyui-flux-dev-fp8",
            "type": "image",
            "providerId": "comfyui-local",
            "apiModel": "flux-dev-fp8",
            "params": {"workflowName": "flux-dev-fp8", "steps": 20, "apiFormat": "comfyui"},
        }
    ],
    "activeModels": {"image": "comfyui-flux-dev-fp8"},
    "providers": [{"id": "comfyui-local", "baseUrl": "http://127.0.0.1:8188"}],
}


def inspect_patched_prompt(nodes: dict, label: str) -> None:
    print(f"\n=== {label} — patched CLIP node ===")
    for node_id, node in nodes.items():
        inputs = node.get("inputs") or {}
        title = (node.get("_meta") or {}).get("title", "")
        if "text" in inputs and isinstance(inputs["text"], str) and "clip" in str(node.get("class_type", "")).lower():
            print(f"  [{node_id}] {title}: {inputs['text'][:100]!r}...")


def test_patch_only() -> None:
    wf = load_workflow_template("flux-dev-fp8")
    for name, prompt in [("CN老王", OLD_MAN_CN), ("EN老王", OLD_MAN_EN)]:
        nodes = patch_image_workflow(
            wf, prompt=prompt, negative_prompt="", width=1024, height=576, seed=42, steps=20
        )
        inspect_patched_prompt(nodes, name)


async def test_run(prompt: str, label: str, out: Path, seed: int) -> None:
    print(f"\n>>> ComfyUI run: {label}")
    result = await run_comfy_image(
        REGISTRY,
        {
            "prompt": prompt,
            "modelId": "comfyui-flux-dev-fp8",
            "aspectRatio": "16:9",
            "steps": 20,
            "seed": seed,
        },
    )
    b64 = result.get("image_base64") or ""
    if b64:
        out.write_bytes(base64.b64decode(b64))
        print(f"    OK -> {out} ({out.stat().st_size} bytes)")
    else:
        print("    FAIL: no image")


async def main() -> None:
    print("=" * 60)
    print("ComfyUI flux-dev-fp8 workflow test")
    print("=" * 60)
    test_patch_only()

    out_dir = BACKEND / "data" / "comfy_test"
    out_dir.mkdir(parents=True, exist_ok=True)

    print("\n--- Live runs (compare CN vs EN) ---")
    print("Expected: EN prompts match subject; CN prompts often ignored by Flux T5")
    await test_run(OLD_MAN_CN, "CN 老王62岁", out_dir / "cn_old_man.png", 111)
    await test_run(OLD_MAN_EN, "EN 老王62岁", out_dir / "en_old_man.png", 222)
    await test_run(YOUNG_WOMAN_EN, "EN 少女18岁", out_dir / "en_young_woman.png", 333)
    print(f"\nResults in: {out_dir}")
    print("Frontend fix: translatePromptForComfyUi() before API call")


if __name__ == "__main__":
    asyncio.run(main())
