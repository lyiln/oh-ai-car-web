#!/usr/bin/env python
"""
Build a harder CCPD image subset based on filename metadata.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import cv2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a hard CCPD subset from filename metadata.")
    parser.add_argument("--source-dir", type=Path, required=True, help="Directory containing CCPD images.")
    parser.add_argument("--output-dir", type=Path, required=True, help="Directory to place selected hard images.")
    parser.add_argument("--count", type=int, default=40, help="Number of hard images to keep.")
    return parser.parse_args()


def parse_bbox_from_name(image_path: Path) -> tuple[int, int, int, int]:
    parts = image_path.stem.split("-")
    bbox_part = parts[2]
    top_left, bottom_right = bbox_part.split("_")
    x1, y1 = [int(v) for v in top_left.split("&")]
    x2, y2 = [int(v) for v in bottom_right.split("&")]
    return x1, y1, x2, y2


def parse_tilt_from_name(image_path: Path) -> tuple[int, int]:
    parts = image_path.stem.split("-")
    tilt_part = parts[1]
    tilt_x, tilt_y = [int(v) for v in tilt_part.split("_")]
    return tilt_x, tilt_y


def compute_difficulty(image_path: Path) -> dict[str, float]:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Image is unreadable: {image_path}")
    img_h, img_w = image.shape[:2]
    x1, y1, x2, y2 = parse_bbox_from_name(image_path)
    plate_w = max(1, x2 - x1)
    plate_h = max(1, y2 - y1)
    area_ratio = (plate_w * plate_h) / float(img_w * img_h)
    tilt_x, tilt_y = parse_tilt_from_name(image_path)
    # Smaller area and larger tilt are considered harder.
    difficulty_score = (1.0 / max(area_ratio, 1e-6)) + (tilt_x + tilt_y) * 0.08
    return {
        "image_path": str(image_path),
        "area_ratio": round(area_ratio, 6),
        "tilt_x": tilt_x,
        "tilt_y": tilt_y,
        "difficulty_score": round(difficulty_score, 6),
    }


def main() -> None:
    args = parse_args()
    image_paths = sorted(args.source_dir.glob("*.jpg"))
    if not image_paths:
        raise FileNotFoundError(f"No CCPD jpg images found in: {args.source_dir}")

    records = [compute_difficulty(path) for path in image_paths]
    records.sort(key=lambda item: item["difficulty_score"], reverse=True)
    selected = records[: args.count]

    if args.output_dir.exists():
        shutil.rmtree(args.output_dir)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for item in selected:
        src = Path(item["image_path"])
        shutil.copy2(src, args.output_dir / src.name)

    summary_path = args.output_dir / "hard_subset_summary.json"
    summary_path.write_text(json.dumps(selected, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Hard subset saved to: {args.output_dir}")
    print(f"Selected image count: {len(selected)}")
    print(f"Summary file: {summary_path}")


if __name__ == "__main__":
    main()