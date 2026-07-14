#!/usr/bin/env python
r"""
Convert CCPD image filenames into YOLO detection labels.

Typical use:
    python scripts/ccpd_to_yolo.py ^
        --source-dir datasets\CCPD-Base ^
        --output-dir datasets\ccpd_plate_small ^
        --train-count 400 ^
        --val-count 80
"""

from __future__ import annotations

import argparse
import json
import random
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Sequence

import cv2


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


@dataclass
class SampleResult:
    image_name: str
    split: str
    label_path: str


@dataclass
class ConvertError:
    image_name: str
    reason: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Convert CCPD filenames to YOLO labels.")
    parser.add_argument("--source-dir", type=Path, required=True, help="Directory containing CCPD images.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        required=True,
        help="Output dataset root with YOLO structure: images/{train,val}, labels/{train,val}.",
    )
    parser.add_argument("--train-count", type=int, default=400, help="Number of training images to sample.")
    parser.add_argument("--val-count", type=int, default=80, help="Number of validation images to sample.")
    parser.add_argument("--seed", type=int, default=42, help="Random seed for reproducible sampling.")
    parser.add_argument(
        "--copy-images",
        action="store_true",
        default=True,
        help="Copy sampled images into output directory. Enabled by default.",
    )
    parser.add_argument(
        "--no-copy-images",
        action="store_false",
        dest="copy_images",
        help="Do not copy images, only generate labels beside the output structure.",
    )
    parser.add_argument(
        "--summary-name",
        type=str,
        default="split_summary.json",
        help="Summary file name written under output directory.",
    )
    parser.add_argument(
        "--error-log-name",
        type=str,
        default="conversion_errors.txt",
        help="Error log file name written under output directory.",
    )
    return parser.parse_args()


def list_images(source_dir: Path) -> List[Path]:
    if not source_dir.exists():
        raise FileNotFoundError(f"Source directory does not exist: {source_dir}")
    files = [p for p in source_dir.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS]
    if not files:
        raise FileNotFoundError(f"No images found under source directory: {source_dir}")
    return sorted(files)


def parse_bbox_from_filename(image_path: Path) -> tuple[int, int, int, int]:
    parts = image_path.stem.split("-")
    if len(parts) < 3:
        raise ValueError(f"Filename format is not valid CCPD: {image_path.name}")

    bbox_field = parts[2]
    try:
        left_top, right_bottom = bbox_field.split("_")
        x1, y1 = [int(v) for v in left_top.split("&")]
        x2, y2 = [int(v) for v in right_bottom.split("&")]
    except Exception as exc:  # noqa: BLE001
        raise ValueError(f"Failed to parse bbox field '{bbox_field}' in {image_path.name}") from exc

    if x2 <= x1 or y2 <= y1:
        raise ValueError(f"Invalid bbox coordinates in {image_path.name}: {(x1, y1, x2, y2)}")
    return x1, y1, x2, y2


def normalize_bbox(x1: int, y1: int, x2: int, y2: int, width: int, height: int) -> tuple[float, float, float, float]:
    x1 = max(0, min(x1, width - 1))
    y1 = max(0, min(y1, height - 1))
    x2 = max(1, min(x2, width))
    y2 = max(1, min(y2, height))

    box_w = x2 - x1
    box_h = y2 - y1
    if box_w <= 0 or box_h <= 0:
        raise ValueError(f"Clamped bbox is invalid: {(x1, y1, x2, y2)}")

    x_center = (x1 + x2) / 2.0 / width
    y_center = (y1 + y2) / 2.0 / height
    norm_w = box_w / width
    norm_h = box_h / height

    values = (x_center, y_center, norm_w, norm_h)
    if any(v <= 0 or v > 1 for v in values):
        raise ValueError(f"Normalized bbox is out of range: {values}")
    return values


def ensure_structure(output_dir: Path) -> None:
    for split in ("train", "val"):
        (output_dir / "images" / split).mkdir(parents=True, exist_ok=True)
        (output_dir / "labels" / split).mkdir(parents=True, exist_ok=True)


def write_label(label_path: Path, bbox: Sequence[float]) -> None:
    content = f"0 {bbox[0]:.6f} {bbox[1]:.6f} {bbox[2]:.6f} {bbox[3]:.6f}\n"
    label_path.write_text(content, encoding="utf-8")


def process_one(image_path: Path, split: str, output_dir: Path, copy_images: bool) -> SampleResult:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Image is unreadable: {image_path}")

    height, width = image.shape[:2]
    x1, y1, x2, y2 = parse_bbox_from_filename(image_path)
    yolo_bbox = normalize_bbox(x1, y1, x2, y2, width, height)

    image_out = output_dir / "images" / split / image_path.name
    label_out = output_dir / "labels" / split / f"{image_path.stem}.txt"

    if copy_images:
        shutil.copy2(image_path, image_out)

    write_label(label_out, yolo_bbox)
    return SampleResult(image_name=image_path.name, split=split, label_path=str(label_out))


def sample_images(images: Sequence[Path], train_count: int, val_count: int, seed: int) -> tuple[List[Path], List[Path]]:
    required = train_count + val_count
    if len(images) < required:
        raise ValueError(f"Not enough images: found {len(images)}, required {required}.")

    pool = list(images)
    random.Random(seed).shuffle(pool)
    train_images = pool[:train_count]
    val_images = pool[train_count : train_count + val_count]
    return train_images, val_images


def convert_split(images: Iterable[Path], split: str, output_dir: Path, copy_images: bool) -> list[SampleResult]:
    results: list[SampleResult] = []
    for image_path in images:
        results.append(process_one(image_path, split, output_dir, copy_images))
    return results


def convert_split_safe(
    images: Iterable[Path], split: str, output_dir: Path, copy_images: bool
) -> tuple[list[SampleResult], list[ConvertError]]:
    results: list[SampleResult] = []
    errors: list[ConvertError] = []
    for image_path in images:
        try:
            results.append(process_one(image_path, split, output_dir, copy_images))
        except Exception as exc:  # noqa: BLE001
            errors.append(ConvertError(image_name=image_path.name, reason=str(exc)))
    return results, errors


def write_summary(
    summary_path: Path,
    source_dir: Path,
    output_dir: Path,
    train_results: Sequence[SampleResult],
    val_results: Sequence[SampleResult],
    errors: Sequence[ConvertError],
    seed: int,
) -> None:
    payload = {
        "source_dir": str(source_dir),
        "output_dir": str(output_dir),
        "seed": seed,
        "train_count": len(train_results),
        "val_count": len(val_results),
        "error_count": len(errors),
        "train_images": [item.image_name for item in train_results],
        "val_images": [item.image_name for item in val_results],
    }
    summary_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def write_error_log(error_log_path: Path, errors: Sequence[ConvertError]) -> None:
    if not errors:
        error_log_path.write_text("No conversion errors.\n", encoding="utf-8")
        return

    lines = [f"{item.image_name}\t{item.reason}" for item in errors]
    error_log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def print_summary(train_results: Sequence[SampleResult], val_results: Sequence[SampleResult], output_dir: Path) -> None:
    print("CCPD -> YOLO conversion finished.")
    print(f"Output directory : {output_dir}")
    print(f"Train samples    : {len(train_results)}")
    print(f"Val samples      : {len(val_results)}")
    if train_results:
        print(f"Train label demo : {train_results[0].label_path}")
    if val_results:
        print(f"Val label demo   : {val_results[0].label_path}")


def main() -> None:
    args = parse_args()
    ensure_structure(args.output_dir)

    images = list_images(args.source_dir)
    train_images, val_images = sample_images(images, args.train_count, args.val_count, args.seed)

    train_results, train_errors = convert_split_safe(train_images, "train", args.output_dir, args.copy_images)
    val_results, val_errors = convert_split_safe(val_images, "val", args.output_dir, args.copy_images)
    errors = [*train_errors, *val_errors]

    write_summary(
        args.output_dir / args.summary_name,
        args.source_dir,
        args.output_dir,
        train_results,
        val_results,
        errors,
        args.seed,
    )
    write_error_log(args.output_dir / args.error_log_name, errors)
    print_summary(train_results, val_results, args.output_dir)
    print(f"Error count      : {len(errors)}")
    print(f"Summary file     : {args.output_dir / args.summary_name}")
    print(f"Error log file   : {args.output_dir / args.error_log_name}")


if __name__ == "__main__":
    main()
