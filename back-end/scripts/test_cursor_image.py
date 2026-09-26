#!/usr/bin/env python3
"""Standalone Cursor image-generation smoke test.

Examples:
  uv run python scripts/test_cursor_image.py \
    --prompt "Generate a cinematic image of the character holding the exact prop from Image 4." \
    --reference scene.png --reference character.png --reference prop.png

The default ``acp`` mode matches the production route used by the backend for
models whose apiFormat is ``cursor-sdk``. Use ``--mode sdk`` to test the
Python cursor_sdk adapter directly.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import mimetypes
import sys
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Test Cursor image generation with numbered references.")
    parser.add_argument("--prompt", required=True, help="Image-generation prompt.")
    parser.add_argument(
        "--reference",
        action="append",
        default=[],
        help="Reference image path or URL. Repeat to preserve Image 1, Image 2, ... order.",
    )
    parser.add_argument(
        "--annotation",
        action="append",
        default=[],
        help="Optional annotation matching each --reference, in the same order.",
    )
    parser.add_argument("--output", default="cursor-test-output.png", help="Output PNG path.")
    parser.add_argument("--aspect-ratio", default="16:9", help="Requested canvas ratio.")
    parser.add_argument("--model", default=None, help="Optional Cursor model override.")
    parser.add_argument(
        "--mode",
        choices=("acp", "sdk"),
        default="acp",
        help="acp matches production; sdk calls the Python cursor_sdk adapter directly.",
    )
    return parser.parse_args()


async def run(args: argparse.Namespace) -> bytes:
    if len(args.annotation) > len(args.reference):
        raise SystemExit("--annotation 数量不能多于 --reference 数量")

    annotations = list(args.annotation) + [""] * (len(args.reference) - len(args.annotation))
    references: list[str] = []
    for value in args.reference:
        local_path = Path(value).expanduser()
        if local_path.is_file():
            mime = mimetypes.guess_type(local_path.name)[0] or "image/png"
            encoded = base64.b64encode(local_path.read_bytes()).decode("ascii")
            references.append(f"data:{mime};base64,{encoded}")
        else:
            references.append(value)
    mapping = "\n".join(
        f"- Image {index + 1}: {args.reference[index]} — {annotations[index]}"
        for index in range(len(references))
    )
    prompt = (
        f"{args.prompt}\n\n"
        "Reference images are authoritative and must remain paired with their numbered roles. "
        "When a reference is a named prop, reproduce its exact shape, material, color, proportions, "
        "and defining details; do not substitute or redesign it.\n"
        f"Reference image mapping:\n{mapping or '(none)'}"
    )

    if args.mode == "acp":
        from app.services.ai.cursor_acp import generate_image_cursor_acp

        encoded = await generate_image_cursor_acp(
            prompt=f"{prompt}\nCanvas aspect ratio: {args.aspect_ratio}.",
            reference_images=references,
            reference_annotations=annotations,
        )
    else:
        from app.services.ai.cursor_image import generate_image_cursor_sdk

        encoded = await generate_image_cursor_sdk(
            prompt=prompt,
            aspect_ratio=args.aspect_ratio,
            reference_images=references,
            reference_annotations=annotations,
            model=args.model,
        )

    return base64.b64decode(encoded, validate=True)


def main() -> int:
    args = parse_args()
    root = Path(__file__).resolve().parents[1]
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))

    output = Path(args.output).expanduser().resolve()
    try:
        image_bytes = asyncio.run(run(args))
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(image_bytes)
    except Exception as exc:  # noqa: BLE001 - CLI should show the provider error verbatim.
        print(f"Cursor 生图测试失败: {exc}", file=sys.stderr)
        return 1

    print(f"Cursor 生图测试成功: mode={args.mode}, references={len(args.reference)}")
    print(f"输出文件: {output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
