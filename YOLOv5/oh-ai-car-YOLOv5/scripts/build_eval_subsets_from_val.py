#!/usr/bin/env python
"""
Build additional regular and hard evaluation subsets from a held-out CCPD val split.
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
from pathlib import Path

import cv2


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build non-overlapping CCPD evaluation subsets from held-out val data.")
    parser.add_argument("--source-dir", type=Path, required=True, help="Held-out validation image directory.")
    parser.add_argument("--regular-output-dir", type=Path, required=True, help="Output directory for the new regular subset.")
    parser.add_argument("--hard-output-dir", type=Path, required=True, help="Output directory for the new hard subset.")
    parser.add_argument("--regular-count", type=int, default=40, help="Number of regular images to sample.")
    parser.add_argument("--hard-count", type=int, default=20, help="Number of hard images to sample.")
    parser.add_argument("--seed", type=int, default=123, help="Random seed for regular subset sampling.")
    parser.add_argument(
        "--exclude-dir",
        type=Path,
        action="append",
        default=[],
        help="Directory containing images to exclude by filename. Can be passed multiple times.",
    )
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


def compute_difficulty(image_path: Path) -> dict[str, float | str]:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Image is unreadable: {image_path}")
    img_h, img_w = image.shape[:2]
    x1, y1, x2, y2 = parse_bbox_from_name(image_path)
    plate_w = max(1, x2 - x1)
    plate_h = max(1, y2 - y1)
    area_ratio = (plate_w * plate_h) / float(img_w * img_h)
    tilt_x, tilt_y = parse_tilt_from_name(image_path)
    difficulty_score = (1.0 / max(area_ratio, 1e-6)) + (tilt_x + tilt_y) * 0.08
    return {
        "image_path": str(image_path),
        "area_ratio": round(area_ratio, 6),
        "tilt_x": tilt_x,
        "tilt_y": tilt_y,
        "difficulty_score": round(difficulty_score, 6),
    }


def collect_excluded_names(exclude_dirs: list[Path]) -> set[str]:
    excluded: set[str] = set()
    for folder in exclude_dirs:
        if not folder.exists():
            continue
        excluded.update(path.name for path in folder.glob("*.jpg"))
    return excluded


def copy_subset(records: list[dict[str, float | str]], output_dir: Path, summary_name: str) -> None:
    if output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    for item in records:
        src = Path(str(item["image_path"]))
        shutil.copy2(src, output_dir / src.name)

    summary_path = output_dir / summary_name
    summary_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")


def main() -> None:
    args = parse_args()
    image_paths = sorted(args.source_dir.glob("*.jpg"))
    if not image_paths:
        raise FileNotFoundError(f"No CCPD jpg images found in: {args.source_dir}")

    excluded_names = collect_excluded_names(args.exclude_dir)
    candidate_paths = [path for path in image_paths if path.name not in excluded_names]
    if len(candidate_paths) < args.regular_count + args.hard_count:
        raise ValueError("Not enough held-out images remaining after exclusions.")

    difficulty_records = [compute_difficulty(path) for path in candidate_paths]
    difficulty_records.sort(key=lambda item: float(item["difficulty_score"]), reverse=True)

    hard_records = difficulty_records[: args.hard_count]
    hard_names = {Path(str(item["image_path"])).name for item in hard_records}

    regular_pool = [item for item in difficulty_records if Path(str(item["image_path"])).name not in hard_names]
    random.Random(args.seed).shuffle(regular_pool)
    regular_records = sorted(
        regular_pool[: args.regular_count],
        key=lambda item: Path(str(item["image_path"])).name,
    )

    copy_subset(regular_records, args.regular_output_dir, "regular_subset_summary.json")
    copy_subset(hard_records, args.hard_output_dir, "hard_subset_summary.json")

    print(f"Regular subset saved to: {args.regular_output_dir}")
    print(f"Regular image count    : {len(regular_records)}")
    print(f"Hard subset saved to   : {args.hard_output_dir}")
    print(f"Hard image count       : {len(hard_records)}")


if __name__ == "__main__":
    main()
