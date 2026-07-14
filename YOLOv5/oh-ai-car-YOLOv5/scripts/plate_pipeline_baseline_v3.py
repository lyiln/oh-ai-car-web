#!/usr/bin/env python
"""
Baseline end-to-end plate detection -> crop -> OCR pipeline before v4 changes.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

import cv2

from plate_recognizer_baseline_v3 import build_ocr_model, recognize_plate_image


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run plate detection and OCR in one pipeline.")
    parser.add_argument("--yolov5-dir", type=Path, required=True, help="Path to ultralytics/yolov5 repo.")
    parser.add_argument("--weights", type=Path, required=True, help="Model weights for plate detector.")
    parser.add_argument("--source", type=Path, required=True, help="Input image path or directory.")
    parser.add_argument("--project", type=Path, default=Path("runs") / "plate_pipeline", help="Output project directory.")
    parser.add_argument("--name", type=str, default="predict", help="Run name under project directory.")
    parser.add_argument("--imgsz", type=int, default=640, help="Inference image size.")
    parser.add_argument("--conf-thres", type=float, default=0.25, help="Detection confidence threshold.")
    parser.add_argument("--iou-thres", type=float, default=0.45, help="Detection IoU threshold.")
    parser.add_argument("--device", type=str, default="", help="CUDA device id, leave empty for auto.")
    parser.add_argument("--ocr-lang", type=str, default="ch", help="PaddleOCR language setting.")
    parser.add_argument("--ocr-min-score", type=float, default=0.75, help="Minimum OCR confidence for compare-ready status.")
    parser.add_argument("--save-csv", action="store_true", help="Export CSV in addition to JSON.")
    return parser.parse_args()


def run_detector(args: argparse.Namespace, pipeline_dir: Path) -> Path:
    detector_script = Path(__file__).with_name("plate_detector.py")
    detector_name = "detector"
    command = [
        sys.executable,
        str(detector_script),
        "--yolov5-dir",
        str(args.yolov5_dir),
        "--weights",
        str(args.weights),
        "--source",
        str(args.source),
        "--project",
        str(pipeline_dir),
        "--name",
        detector_name,
        "--imgsz",
        str(args.imgsz),
        "--conf-thres",
        str(args.conf_thres),
        "--iou-thres",
        str(args.iou_thres),
    ]
    if args.device:
        command.extend(["--device", args.device])
    command.append("--save-csv")

    subprocess.run(command, check=True)
    detection_json = pipeline_dir / detector_name / "detections.json"
    if not detection_json.exists():
        raise FileNotFoundError(f"Detections file not found: {detection_json}")
    return detection_json


def clamp_bbox(bbox: list[int], img_w: int, img_h: int) -> list[int]:
    x1, y1, x2, y2 = bbox
    x1 = max(0, min(x1, img_w - 1))
    y1 = max(0, min(y1, img_h - 1))
    x2 = max(0, min(x2, img_w - 1))
    y2 = max(0, min(y2, img_h - 1))
    return [x1, y1, x2, y2]


def expand_bbox(bbox: list[int], img_w: int, img_h: int) -> list[int]:
    x1, y1, x2, y2 = bbox
    box_w = x2 - x1
    box_h = y2 - y1
    expanded = [
        int(round(x1 - box_w * 0.20)),
        int(round(y1 - box_h * 0.25)),
        int(round(x2 + box_w * 0.10)),
        int(round(y2 + box_h * 0.22)),
    ]
    return clamp_bbox(expanded, img_w, img_h)


def save_crop(image_path: Path, bbox: list[int], crop_dir: Path, crop_index: int) -> tuple[Path, list[int]]:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Image is unreadable: {image_path}")
    img_h, img_w = image.shape[:2]
    x1, y1, x2, y2 = expand_bbox(bbox, img_w, img_h)
    if x2 <= x1 or y2 <= y1:
        raise ValueError(f"Invalid bbox for crop: {bbox}")

    crop = image[y1:y2, x1:x2]
    crop_path = crop_dir / f"{image_path.stem}_plate_{crop_index:02d}.jpg"
    cv2.imwrite(str(crop_path), crop)
    return crop_path, [x1, y1, x2, y2]


def merge_results(
    detections: list[dict[str, Any]],
    ocr_model: Any,
    crop_dir: Path,
    ocr_min_score: float,
) -> list[dict[str, Any]]:
    merged: list[dict[str, Any]] = []
    per_image_index: dict[str, int] = {}

    for detection in detections:
        image_path = Path(detection["image_path"])
        image_key = str(image_path)
        per_image_index[image_key] = per_image_index.get(image_key, 0) + 1
        crop_path, crop_bbox = save_crop(image_path, detection["bbox"], crop_dir, per_image_index[image_key])

        ocr_result = recognize_plate_image(ocr_model, crop_path, ocr_min_score)
        merged.append(
            {
                "image_path": str(image_path),
                "bbox": detection["bbox"],
                "crop_bbox": crop_bbox,
                "det_confidence": round(float(detection["confidence"]), 6),
                "crop_path": str(crop_path),
                "plate_text": ocr_result["plate_text"],
                "ocr_confidence": ocr_result["ocr_confidence"],
                "is_valid_plate": ocr_result["is_valid_plate"],
                "ocr_variant": ocr_result["ocr_variant"],
                "status": (
                    "ready_for_whitelist_compare"
                    if ocr_result["status"] == "ocr_pass"
                    else "manual_review"
                ),
            }
        )
    return merged


def write_json(results: list[dict[str, Any]], output_path: Path) -> None:
    output_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


def write_csv(results: list[dict[str, Any]], output_path: Path) -> None:
    with output_path.open("w", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(
            csv_file,
            fieldnames=[
                "image_path",
                "bbox",
                "crop_bbox",
                "det_confidence",
                "crop_path",
                "plate_text",
                "ocr_confidence",
                "is_valid_plate",
                "ocr_variant",
                "status",
            ],
        )
        writer.writeheader()
        writer.writerows(results)


def main() -> None:
    args = parse_args()
    pipeline_dir = args.project / args.name
    if pipeline_dir.exists():
        shutil.rmtree(pipeline_dir)
    crop_dir = pipeline_dir / "plate_crops"
    crop_dir.mkdir(parents=True, exist_ok=True)

    detection_json = run_detector(args, pipeline_dir)
    detections = json.loads(detection_json.read_text(encoding="utf-8"))

    ocr_model = build_ocr_model(args.ocr_lang)
    results = merge_results(detections, ocr_model, crop_dir, args.ocr_min_score)

    json_path = pipeline_dir / "pipeline_results.json"
    write_json(results, json_path)
    if args.save_csv:
        write_csv(results, pipeline_dir / "pipeline_results.csv")

    ready_count = sum(1 for item in results if item["status"] == "ready_for_whitelist_compare")
    print(f"Pipeline finished, results saved to: {pipeline_dir}")
    print(f"JSON result file: {json_path}")
    print(f"Detection count: {len(detections)}")
    print(f"Whitelist-ready count: {ready_count}")


if __name__ == "__main__":
    main()
