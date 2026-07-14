#!/usr/bin/env python
"""
Thin wrapper around YOLOv5 detect.py for vehicle detection.

This script:
1. Calls the local YOLOv5 detect.py entrypoint.
2. Filters detections to configured vehicle classes.
3. Parses YOLO txt outputs back into pixel-space bbox + confidence.
4. Exports results to JSON and optional CSV.
"""

from __future__ import annotations

import argparse
import csv
import json
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Iterable

import cv2


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
COCO_CLASS_NAMES = {
    2: "car",
    5: "bus",
    7: "truck",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run vehicle detection with a local YOLOv5 repo.")
    parser.add_argument("--yolov5-dir", type=Path, required=True, help="Path to ultralytics/yolov5 repo.")
    parser.add_argument("--weights", type=Path, required=True, help="Model weights, for example yolov5s.pt or best.pt.")
    parser.add_argument("--source", type=Path, required=True, help="Input image path or directory.")
    parser.add_argument("--project", type=Path, default=Path("runs") / "car_detector", help="Output project directory.")
    parser.add_argument("--name", type=str, default="predict", help="Run name under project directory.")
    parser.add_argument("--imgsz", type=int, default=640, help="Inference image size.")
    parser.add_argument("--conf-thres", type=float, default=0.15, help="Confidence threshold.")
    parser.add_argument("--iou-thres", type=float, default=0.45, help="NMS IoU threshold.")
    parser.add_argument("--device", type=str, default="", help="CUDA device id, leave empty for auto.")
    parser.add_argument(
        "--classes",
        type=int,
        nargs="+",
        default=[2, 5, 7],
        help="Class ids to keep. COCO defaults: 2=car 5=bus 7=truck.",
    )
    parser.add_argument(
        "--class-names",
        type=str,
        nargs="+",
        help="Optional class names aligned with --classes order, for example: car bus truck.",
    )
    parser.add_argument("--save-csv", action="store_true", help="Export a CSV file in addition to JSON.")
    return parser.parse_args()


def run_detect(args: argparse.Namespace, save_dir: Path) -> None:
    detect_script = args.yolov5_dir / "detect.py"
    if not detect_script.exists():
        raise FileNotFoundError(f"detect.py not found: {detect_script}")

    if save_dir.exists():
        shutil.rmtree(save_dir)

    command = [
        sys.executable,
        str(detect_script),
        "--weights",
        str(args.weights),
        "--source",
        str(args.source),
        "--project",
        str(args.project),
        "--name",
        args.name,
        "--imgsz",
        str(args.imgsz),
        "--conf-thres",
        str(args.conf_thres),
        "--iou-thres",
        str(args.iou_thres),
        "--save-txt",
        "--save-conf",
        "--exist-ok",
    ]
    if args.device:
        command.extend(["--device", args.device])
    if args.classes:
        command.extend(["--classes", *[str(class_id) for class_id in args.classes]])

    subprocess.run(command, cwd=str(args.yolov5_dir), check=True)
    if not save_dir.exists():
        raise FileNotFoundError(f"YOLOv5 did not create expected output directory: {save_dir}")


def iter_input_images(source: Path) -> list[Path]:
    if source.is_file() and source.suffix.lower() == ".txt":
        images: list[Path] = []
        for line in source.read_text(encoding="utf-8").splitlines():
            raw_path = line.strip()
            if not raw_path:
                continue
            image_path = Path(raw_path)
            if image_path.suffix.lower() in IMAGE_EXTENSIONS:
                images.append(image_path)
        return images
    if source.is_file():
        return [source]
    return sorted([p for p in source.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS])


def yolo_to_xyxy(xc: float, yc: float, w: float, h: float, img_w: int, img_h: int) -> list[int]:
    x1 = int(round((xc - w / 2.0) * img_w))
    y1 = int(round((yc - h / 2.0) * img_h))
    x2 = int(round((xc + w / 2.0) * img_w))
    y2 = int(round((yc + h / 2.0) * img_h))
    x1 = max(0, min(x1, img_w - 1))
    y1 = max(0, min(y1, img_h - 1))
    x2 = max(0, min(x2, img_w - 1))
    y2 = max(0, min(y2, img_h - 1))
    return [x1, y1, x2, y2]


def build_class_name_map(classes: list[int], class_names: list[str] | None) -> dict[int, str]:
    if class_names is None:
        return dict(COCO_CLASS_NAMES)

    if len(class_names) != len(classes):
        raise ValueError("--class-names count must match --classes count.")

    return {class_id: class_name for class_id, class_name in zip(classes, class_names)}


def parse_label_file(label_file: Path, image_path: Path, class_name_map: dict[int, str]) -> list[dict[str, Any]]:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Image is unreadable: {image_path}")
    img_h, img_w = image.shape[:2]

    detections: list[dict[str, Any]] = []
    if not label_file.exists():
        return detections

    for line in label_file.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) < 6:
            continue
        class_id, xc, yc, w, h, conf = parts[:6]
        class_id_int = int(float(class_id))
        bbox = yolo_to_xyxy(float(xc), float(yc), float(w), float(h), img_w, img_h)
        detections.append(
            {
                "image_path": str(image_path),
                "bbox": bbox,
                "confidence": round(float(conf), 6),
                "class_id": class_id_int,
                "class_name": class_name_map.get(class_id_int, f"class_{class_id_int}"),
            }
        )
    return detections


def collect_results(images: Iterable[Path], save_dir: Path, class_name_map: dict[int, str]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    labels_dir = save_dir / "labels"
    for image_path in images:
        label_file = labels_dir / f"{image_path.stem}.txt"
        image_detections = parse_label_file(label_file, image_path, class_name_map)
        results.extend(image_detections)
    return results


def write_json(results: list[dict[str, Any]], output_path: Path) -> None:
    output_path.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")


def write_csv(results: list[dict[str, Any]], output_path: Path) -> None:
    with output_path.open("w", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(
            csv_file,
            fieldnames=["image_path", "bbox", "confidence", "class_id", "class_name"],
        )
        writer.writeheader()
        writer.writerows(results)


def main() -> None:
    args = parse_args()
    save_dir = args.project / args.name
    save_dir.parent.mkdir(parents=True, exist_ok=True)

    run_detect(args, save_dir)
    images = iter_input_images(args.source)
    class_name_map = build_class_name_map(args.classes, args.class_names)
    results = collect_results(images, save_dir, class_name_map)

    json_path = save_dir / "detections.json"
    write_json(results, json_path)
    if args.save_csv:
        write_csv(results, save_dir / "detections.csv")

    print(f"Vehicle detection finished, results saved to: {save_dir}")
    print(f"JSON result file: {json_path}")
    print(f"Detections count: {len(results)}")


if __name__ == "__main__":
    main()
