#!/usr/bin/env python
r"""
Convert BDD100K detection labels to YOLO labels for vehicle-only training.

Typical use:
    python scripts/bdd100k_to_yolo_vehicle.py ^
        --dataset-root datasets\bdd100k ^
        --summary-name vehicle_yolo_summary.json
"""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2


DEFAULT_CATEGORY_MAP = {
    "car": 0,
    "bus": 1,
    "truck": 2,
}


@dataclass
class SplitStats:
    split: str
    frame_count: int = 0
    labeled_image_count: int = 0
    label_file_count: int = 0
    skipped_missing_image: int = 0
    skipped_missing_box2d: int = 0
    skipped_unknown_category: int = 0
    skipped_invalid_bbox: int = 0
    object_count: int = 0
    image_width: int = 0
    image_height: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert BDD100K vehicle annotations to YOLO labels.")
    parser.add_argument("--dataset-root", type=Path, required=True, help="BDD100K root directory.")
    parser.add_argument(
        "--include-train-class",
        action="store_true",
        help="Include the BDD100K 'train' class as an extra vehicle category.",
    )
    parser.add_argument(
        "--max-images-per-split",
        type=int,
        default=0,
        help="Optional debug limit per split. Use 0 for full conversion.",
    )
    parser.add_argument(
        "--summary-name",
        type=str,
        default="vehicle_yolo_summary.json",
        help="Summary file name written under dataset root.",
    )
    return parser.parse_args()


def build_category_map(include_train_class: bool) -> dict[str, int]:
    category_map = dict(DEFAULT_CATEGORY_MAP)
    if include_train_class:
        category_map["train"] = len(category_map)
    return category_map


def find_label_json(dataset_root: Path, split: str) -> Path:
    candidates = [
        dataset_root / "labels" / "det_20" / f"det_{split}.json",
        dataset_root / "labels" / f"bdd100k_labels_images_{split}.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Could not find BDD100K label json for split '{split}' under {dataset_root}")


def load_split_records(label_json: Path) -> list[dict[str, Any]]:
    payload = json.loads(label_json.read_text(encoding="utf-8-sig"))
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        raise ValueError(f"Expected a list of frames in {label_json}")
    return payload


def clamp_bbox(x1: float, y1: float, x2: float, y2: float, width: int, height: int) -> tuple[float, float, float, float]:
    x1 = max(0.0, min(x1, width - 1))
    y1 = max(0.0, min(y1, height - 1))
    x2 = max(1.0, min(x2, width))
    y2 = max(1.0, min(y2, height))
    if x2 <= x1 or y2 <= y1:
        raise ValueError(f"Invalid bbox after clamp: {(x1, y1, x2, y2)}")
    return x1, y1, x2, y2


def to_yolo_bbox(x1: float, y1: float, x2: float, y2: float, width: int, height: int) -> tuple[float, float, float, float]:
    box_w = x2 - x1
    box_h = y2 - y1
    x_center = (x1 + x2) / 2.0 / width
    y_center = (y1 + y2) / 2.0 / height
    norm_w = box_w / width
    norm_h = box_h / height
    values = (x_center, y_center, norm_w, norm_h)
    if any(value <= 0 or value > 1 for value in values):
        raise ValueError(f"Normalized bbox out of range: {values}")
    return values


def read_image_size(image_path: Path) -> tuple[int, int]:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Image is unreadable: {image_path}")
    height, width = image.shape[:2]
    return width, height


def ensure_yolo_label_dirs(dataset_root: Path) -> None:
    for split in ("train", "val"):
        (dataset_root / "labels" / "100k" / split).mkdir(parents=True, exist_ok=True)


def convert_split(
    dataset_root: Path,
    split: str,
    category_map: dict[str, int],
    max_images_per_split: int,
) -> SplitStats:
    label_json = find_label_json(dataset_root, split)
    records = load_split_records(label_json)
    if max_images_per_split > 0:
        records = records[:max_images_per_split]

    stats = SplitStats(split=split, frame_count=len(records))
    image_dir = dataset_root / "images" / "100k" / split
    label_dir = dataset_root / "labels" / "100k" / split

    for frame in records:
        image_name = frame.get("name")
        if not image_name:
            continue

        image_path = image_dir / image_name
        if not image_path.exists():
            stats.skipped_missing_image += 1
            continue

        try:
            width, height = read_image_size(image_path)
        except Exception:  # noqa: BLE001
            stats.skipped_missing_image += 1
            continue

        stats.image_width = width
        stats.image_height = height

        yolo_lines: list[str] = []
        for label in frame.get("labels", []):
            category = str(label.get("category", "")).strip()
            if category not in category_map:
                stats.skipped_unknown_category += 1
                continue

            box2d = label.get("box2d")
            if not isinstance(box2d, dict):
                stats.skipped_missing_box2d += 1
                continue

            try:
                x1, y1, x2, y2 = clamp_bbox(
                    float(box2d["x1"]),
                    float(box2d["y1"]),
                    float(box2d["x2"]),
                    float(box2d["y2"]),
                    width,
                    height,
                )
                bbox = to_yolo_bbox(x1, y1, x2, y2, width, height)
            except Exception:  # noqa: BLE001
                stats.skipped_invalid_bbox += 1
                continue

            class_id = category_map[category]
            yolo_lines.append(
                f"{class_id} {bbox[0]:.6f} {bbox[1]:.6f} {bbox[2]:.6f} {bbox[3]:.6f}"
            )
            stats.object_count += 1

        if not yolo_lines:
            continue

        label_path = label_dir / f"{Path(image_name).stem}.txt"
        label_path.write_text("\n".join(yolo_lines) + "\n", encoding="utf-8")
        stats.labeled_image_count += 1
        stats.label_file_count += 1

    return stats


def write_summary(
    output_path: Path,
    dataset_root: Path,
    category_map: dict[str, int],
    split_stats: list[SplitStats],
    max_images_per_split: int,
) -> None:
    payload = {
        "dataset_root": str(dataset_root),
        "class_names": [name for name, _ in sorted(category_map.items(), key=lambda item: item[1])],
        "category_map": category_map,
        "max_images_per_split": max_images_per_split,
        "splits": {
            stats.split: {
                "frame_count": stats.frame_count,
                "labeled_image_count": stats.labeled_image_count,
                "label_file_count": stats.label_file_count,
                "object_count": stats.object_count,
                "skipped_missing_image": stats.skipped_missing_image,
                "skipped_missing_box2d": stats.skipped_missing_box2d,
                "skipped_unknown_category": stats.skipped_unknown_category,
                "skipped_invalid_bbox": stats.skipped_invalid_bbox,
                "image_size_last_seen": [stats.image_width, stats.image_height],
            }
            for stats in split_stats
        },
    }
    output_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def print_summary(stats_list: list[SplitStats], summary_path: Path, class_names: list[str]) -> None:
    print("BDD100K -> YOLO vehicle conversion finished.")
    print(f"Classes          : {class_names}")
    for stats in stats_list:
        print(
            f"[{stats.split}] frames={stats.frame_count}, labeled_images={stats.labeled_image_count}, "
            f"objects={stats.object_count}, skipped_missing_image={stats.skipped_missing_image}, "
            f"skipped_invalid_bbox={stats.skipped_invalid_bbox}"
        )
    print(f"Summary file     : {summary_path}")


def main() -> None:
    args = parse_args()
    ensure_yolo_label_dirs(args.dataset_root)
    category_map = build_category_map(args.include_train_class)

    stats_list = [
        convert_split(args.dataset_root, "train", category_map, args.max_images_per_split),
        convert_split(args.dataset_root, "val", category_map, args.max_images_per_split),
    ]

    summary_path = args.dataset_root / args.summary_name
    write_summary(summary_path, args.dataset_root, category_map, stats_list, args.max_images_per_split)
    class_names = [name for name, _ in sorted(category_map.items(), key=lambda item: item[1])]
    print_summary(stats_list, summary_path, class_names)


if __name__ == "__main__":
    main()
