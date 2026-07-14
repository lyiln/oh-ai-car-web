#!/usr/bin/env python
r"""
Build a small YOLO-friendly BDD100K subset from a downloaded split.

Expected source layout:
    <source-root>/
      images/
      annotations/
        bdd100k_labels_images_train.json or bdd100k_labels_images_val.json

Typical use:
    python scripts/prepare_bdd100k_mini_subset.py ^
        --source-root datasets\bdd100k\raw\val ^
        --output-root datasets\bdd100k_mini ^
        --train-count 200 ^
        --val-count 50
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Prepare a small BDD100K subset for first-round training.")
    parser.add_argument("--source-root", type=Path, required=True, help="Source split root with images/ and annotations/.")
    parser.add_argument("--output-root", type=Path, required=True, help="Output subset root.")
    parser.add_argument("--train-count", type=int, default=200, help="Number of labeled images for train split.")
    parser.add_argument("--val-count", type=int, default=50, help="Number of labeled images for val split.")
    parser.add_argument(
        "--vehicle-categories",
        nargs="+",
        default=["car", "bus", "truck"],
        help="Vehicle categories that must appear in an image to keep it.",
    )
    return parser.parse_args()


def find_annotation_json(source_root: Path) -> Path:
    annotation_dir = source_root / "annotations"
    candidates = [
        annotation_dir / "bdd100k_labels_images_train.json",
        annotation_dir / "bdd100k_labels_images_val.json",
        annotation_dir / "det_train.json",
        annotation_dir / "det_val.json",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    raise FileNotFoundError(f"Could not find BDD100K annotation json under {annotation_dir}")


def load_records(annotation_json: Path) -> list[dict[str, Any]]:
    payload = json.loads(annotation_json.read_text(encoding="utf-8-sig"))
    if isinstance(payload, dict):
        payload = [payload]
    if not isinstance(payload, list):
        raise ValueError(f"Expected a list of records in {annotation_json}")
    return payload


def has_target_vehicle(record: dict[str, Any], categories: set[str]) -> bool:
    for label in record.get("labels", []):
        if str(label.get("category", "")).strip() in categories and isinstance(label.get("box2d"), dict):
            return True
    return False


def ensure_output_dirs(output_root: Path) -> None:
    dirs = [
        output_root / "images" / "100k" / "train",
        output_root / "images" / "100k" / "val",
        output_root / "labels",
    ]
    for path in dirs:
        path.mkdir(parents=True, exist_ok=True)


def copy_record_images(records: list[dict[str, Any]], source_image_dir: Path, dest_image_dir: Path) -> list[dict[str, Any]]:
    copied_records: list[dict[str, Any]] = []
    for record in records:
        image_name = record.get("name")
        if not image_name:
            continue
        src = source_image_dir / image_name
        if not src.exists():
            continue
        dst = dest_image_dir / image_name
        if not dst.exists():
            shutil.copy2(src, dst)
        copied_records.append(record)
    return copied_records


def write_split_annotations(output_root: Path, split: str, records: list[dict[str, Any]]) -> Path:
    if split == "train":
        json_name = "bdd100k_labels_images_train.json"
    else:
        json_name = "bdd100k_labels_images_val.json"
    out_path = output_root / "labels" / json_name
    out_path.write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
    return out_path


def write_summary(output_root: Path, source_root: Path, train_records: list[dict[str, Any]], val_records: list[dict[str, Any]], categories: list[str]) -> None:
    summary = {
        "source_root": str(source_root),
        "output_root": str(output_root),
        "vehicle_categories": categories,
        "train_count": len(train_records),
        "val_count": len(val_records),
        "train_annotation": str(output_root / "labels" / "bdd100k_labels_images_train.json"),
        "val_annotation": str(output_root / "labels" / "bdd100k_labels_images_val.json"),
    }
    (output_root / "mini_subset_summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def main() -> None:
    args = parse_args()
    ensure_output_dirs(args.output_root)

    annotation_json = find_annotation_json(args.source_root)
    records = load_records(annotation_json)
    categories = {item.strip() for item in args.vehicle_categories if item.strip()}
    filtered = [record for record in records if has_target_vehicle(record, categories)]

    requested_total = args.train_count + args.val_count
    selected = filtered[:requested_total]
    if len(selected) < requested_total:
        print(
            f"Warning: only found {len(selected)} images with target vehicles, "
            f"less than requested {requested_total}."
        )

    train_records = selected[: args.train_count]
    val_records = selected[args.train_count : args.train_count + args.val_count]

    train_records = copy_record_images(
        train_records,
        args.source_root / "images",
        args.output_root / "images" / "100k" / "train",
    )
    val_records = copy_record_images(
        val_records,
        args.source_root / "images",
        args.output_root / "images" / "100k" / "val",
    )

    train_json = write_split_annotations(args.output_root, "train", train_records)
    val_json = write_split_annotations(args.output_root, "val", val_records)
    write_summary(args.output_root, args.source_root, train_records, val_records, sorted(categories))

    print("BDD100K mini subset is ready.")
    print(f"Source annotation : {annotation_json}")
    print(f"Train images      : {len(train_records)}")
    print(f"Val images        : {len(val_records)}")
    print(f"Train json        : {train_json}")
    print(f"Val json          : {val_json}")


if __name__ == "__main__":
    main()
