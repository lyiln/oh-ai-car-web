#!/usr/bin/env python
"""
Two-stage vehicle gate -> plate detection -> OCR pipeline.

The first stage checks whether a vehicle is present. Only images with vehicle
detections are forwarded to the existing plate pipeline.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import cv2


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run vehicle-gated plate detection and OCR.")
    parser.add_argument("--yolov5-dir", type=Path, required=True, help="Path to ultralytics/yolov5 repo.")
    parser.add_argument("--car-weights", type=Path, required=True, help="Vehicle detector weights.")
    parser.add_argument("--plate-weights", type=Path, required=True, help="Plate detector weights.")
    parser.add_argument("--source", type=Path, required=True, help="Input image path or directory.")
    parser.add_argument(
        "--project",
        type=Path,
        default=Path("runs") / "car_plate_pipeline",
        help="Output project directory.",
    )
    parser.add_argument("--name", type=str, default="predict", help="Run name under project directory.")
    parser.add_argument("--imgsz", type=int, default=640, help="Inference image size.")
    parser.add_argument("--car-conf-thres", type=float, default=0.15, help="Vehicle confidence threshold.")
    parser.add_argument("--car-iou-thres", type=float, default=0.45, help="Vehicle NMS IoU threshold.")
    parser.add_argument("--plate-conf-thres", type=float, default=0.25, help="Plate confidence threshold.")
    parser.add_argument("--plate-iou-thres", type=float, default=0.45, help="Plate NMS IoU threshold.")
    parser.add_argument("--device", type=str, default="", help="CUDA device id, leave empty for auto.")
    parser.add_argument("--ocr-lang", type=str, default="ch", help="PaddleOCR language setting.")
    parser.add_argument("--ocr-min-score", type=float, default=0.75, help="Minimum OCR confidence.")
    parser.add_argument(
        "--car-classes",
        type=int,
        nargs="+",
        default=[2, 5, 7],
        help="Vehicle class ids to keep. COCO defaults: 2=car 5=bus 7=truck.",
    )
    parser.add_argument(
        "--car-class-names",
        type=str,
        nargs="+",
        help="Optional vehicle class names aligned with --car-classes order.",
    )
    parser.add_argument("--save-csv", action="store_true", help="Export CSV in addition to JSON.")
    return parser.parse_args()


def iter_input_images(source: Path) -> list[Path]:
    if source.is_file():
        return [source]
    return sorted([p for p in source.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTENSIONS])


def clamp_bbox(bbox: list[int], img_w: int, img_h: int) -> list[int]:
    x1, y1, x2, y2 = bbox
    x1 = max(0, min(x1, img_w - 1))
    y1 = max(0, min(y1, img_h - 1))
    x2 = max(0, min(x2, img_w - 1))
    y2 = max(0, min(y2, img_h - 1))
    return [x1, y1, x2, y2]


def expand_primary_bbox(bbox: list[int], img_w: int, img_h: int) -> list[int]:
    x1, y1, x2, y2 = bbox
    box_w = x2 - x1
    box_h = y2 - y1
    expanded = [
        int(round(x1 - box_w * 0.08)),
        int(round(y1 - box_h * 0.10)),
        int(round(x2 + box_w * 0.08)),
        int(round(y2 + box_h * 0.08)),
    ]
    return clamp_bbox(expanded, img_w, img_h)


def offset_bbox(bbox: list[int], offset_x: int, offset_y: int) -> list[int]:
    x1, y1, x2, y2 = bbox
    return [x1 + offset_x, y1 + offset_y, x2 + offset_x, y2 + offset_y]


def choose_primary_car_detection(
    image_path: Path,
    detections: list[dict[str, Any]],
) -> tuple[dict[str, Any] | None, tuple[int, int] | None]:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Image is unreadable: {image_path}")
    img_h, img_w = image.shape[:2]

    if not detections:
        return None, (img_w, img_h)

    image_center_x = img_w / 2.0
    image_center_y = img_h / 2.0
    diagonal = max((img_w**2 + img_h**2) ** 0.5, 1.0)

    best_detection: dict[str, Any] | None = None
    best_score = -1.0
    for detection in detections:
        x1, y1, x2, y2 = detection["bbox"]
        area = max(0, x2 - x1) * max(0, y2 - y1)
        area_ratio = area / float(img_w * img_h)
        center_x = (x1 + x2) / 2.0
        center_y = (y1 + y2) / 2.0
        center_distance = ((center_x - image_center_x) ** 2 + (center_y - image_center_y) ** 2) ** 0.5
        center_score = max(0.0, 1.0 - center_distance / diagonal)
        score = area_ratio * 0.7 + center_score * 0.3
        enriched = dict(detection)
        enriched["bbox_area_ratio"] = round(area_ratio, 6)
        enriched["center_score"] = round(center_score, 6)
        enriched["primary_score"] = round(score, 6)

        if score > best_score:
            best_score = score
            best_detection = enriched

    return best_detection, (img_w, img_h)


def save_primary_vehicle_visual(
    image_path: Path,
    visual_path: Path,
    primary_detection: dict[str, Any],
) -> None:
    image = cv2.imread(str(image_path))
    if image is None:
        raise ValueError(f"Image is unreadable: {image_path}")

    x1, y1, x2, y2 = primary_detection["bbox"]
    annotated = image.copy()
    cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 220, 255), 3)
    label = f"primary {primary_detection.get('class_name', 'vehicle')} {primary_detection.get('confidence', 0.0):.2f}"
    cv2.putText(
        annotated,
        label,
        (x1, max(28, y1 - 10)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (0, 220, 255),
        2,
        cv2.LINE_AA,
    )
    visual_path.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(visual_path), annotated)


def build_primary_vehicle_source(
    source: Path,
    pipeline_dir: Path,
    grouped_car_detections: dict[str, list[dict[str, Any]]],
) -> tuple[Path | None, dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    if not grouped_car_detections:
        return None, {}, {}

    primary_root = pipeline_dir / "primary_vehicle"
    input_dir = primary_root / "input"
    visual_dir = primary_root / "visuals"
    if primary_root.exists():
        shutil.rmtree(primary_root)
    input_dir.mkdir(parents=True, exist_ok=True)
    visual_dir.mkdir(parents=True, exist_ok=True)

    roi_mapping: dict[str, dict[str, Any]] = {}
    primary_by_original: dict[str, dict[str, Any]] = {}

    for image_path_str in sorted(grouped_car_detections):
        image_path = Path(image_path_str)
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Image is unreadable: {image_path}")
        img_h, img_w = image.shape[:2]
        primary_detection, _ = choose_primary_car_detection(image_path, grouped_car_detections[image_path_str])
        if primary_detection is None:
            continue

        crop_bbox = expand_primary_bbox(primary_detection["bbox"], img_w, img_h)
        x1, y1, x2, y2 = crop_bbox
        roi_image = image[y1:y2, x1:x2]

        if source.is_file():
            relative_path = Path(f"{image_path.stem}_primary{image_path.suffix}")
        else:
            relative_original = image_path.relative_to(source)
            relative_path = relative_original.with_name(f"{relative_original.stem}_primary{relative_original.suffix}")

        roi_path = input_dir / relative_path
        roi_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(roi_path), roi_image)

        visual_path = visual_dir / relative_path
        save_primary_vehicle_visual(image_path, visual_path, primary_detection)

        primary_payload = dict(primary_detection)
        primary_payload["crop_bbox"] = crop_bbox
        primary_payload["crop_path"] = str(roi_path)
        primary_payload["visual_path"] = str(visual_path)
        primary_by_original[image_path_str] = primary_payload
        roi_mapping[str(roi_path)] = {
            "original_path": image_path_str,
            "offset_x": x1,
            "offset_y": y1,
            "primary_detection": primary_payload,
        }

    if not roi_mapping:
        return None, {}, {}

    if source.is_file():
        first_roi_path = next(iter(roi_mapping))
        return Path(first_roi_path), roi_mapping, primary_by_original
    return input_dir, roi_mapping, primary_by_original


def run_car_detector(args: argparse.Namespace, pipeline_dir: Path) -> tuple[Path, float]:
    detector_script = Path(__file__).with_name("car_detector.py")
    detector_name = "car_detector"
    command = [
        sys.executable,
        str(detector_script),
        "--yolov5-dir",
        str(args.yolov5_dir),
        "--weights",
        str(args.car_weights),
        "--source",
        str(args.source),
        "--project",
        str(pipeline_dir),
        "--name",
        detector_name,
        "--imgsz",
        str(args.imgsz),
        "--conf-thres",
        str(args.car_conf_thres),
        "--iou-thres",
        str(args.car_iou_thres),
        "--classes",
        *[str(class_id) for class_id in args.car_classes],
    ]
    if args.device:
        command.extend(["--device", args.device])
    if args.car_class_names:
        command.extend(["--class-names", *args.car_class_names])
    if args.save_csv:
        command.append("--save-csv")

    start_time = time.perf_counter()
    subprocess.run(command, check=True)
    elapsed_sec = time.perf_counter() - start_time
    detection_json = pipeline_dir / detector_name / "detections.json"
    if not detection_json.exists():
        raise FileNotFoundError(f"Vehicle detections file not found: {detection_json}")
    return detection_json, elapsed_sec


def build_gated_source(
    source: Path,
    pipeline_dir: Path,
    grouped_car_detections: dict[str, list[dict[str, Any]]],
) -> tuple[Path | None, dict[str, str]]:
    if not grouped_car_detections:
        return None, {}

    if source.is_file():
        return source, {str(source): str(source)}

    gated_input_dir = pipeline_dir / "gated_input"
    if gated_input_dir.exists():
        shutil.rmtree(gated_input_dir)
    gated_input_dir.mkdir(parents=True, exist_ok=True)

    path_mapping: dict[str, str] = {}
    for image_path_str in sorted(grouped_car_detections):
        image_path = Path(image_path_str)
        relative_path = image_path.relative_to(source)
        copied_path = gated_input_dir / relative_path
        copied_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(image_path, copied_path)
        path_mapping[str(copied_path)] = str(image_path)

    return gated_input_dir, path_mapping

def run_plate_pipeline(
    args: argparse.Namespace,
    pipeline_dir: Path,
    gated_source: Path,
) -> tuple[Path, float]:
    pipeline_script = Path(__file__).with_name("plate_pipeline.py")
    plate_name = "plate_pipeline"
    command = [
        sys.executable,
        str(pipeline_script),
        "--yolov5-dir",
        str(args.yolov5_dir),
        "--weights",
        str(args.plate_weights),
        "--source",
        str(gated_source),
        "--project",
        str(pipeline_dir),
        "--name",
        plate_name,
        "--imgsz",
        str(args.imgsz),
        "--conf-thres",
        str(args.plate_conf_thres),
        "--iou-thres",
        str(args.plate_iou_thres),
        "--ocr-lang",
        str(args.ocr_lang),
        "--ocr-min-score",
        str(args.ocr_min_score),
    ]
    if args.device:
        command.extend(["--device", args.device])
    if args.save_csv:
        command.append("--save-csv")

    start_time = time.perf_counter()
    subprocess.run(command, check=True)
    elapsed_sec = time.perf_counter() - start_time
    result_json = pipeline_dir / plate_name / "pipeline_results.json"
    if not result_json.exists():
        raise FileNotFoundError(f"Plate pipeline result file not found: {result_json}")
    return result_json, elapsed_sec


def group_by_image(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        image_path = str(record["image_path"])
        grouped.setdefault(image_path, []).append(record)
    return grouped


def pick_best_plate_result(results: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not results:
        return None
    return max(
        results,
        key=lambda item: (
            int(item.get("status") == "ready_for_whitelist_compare"),
            float(item.get("ocr_confidence", 0.0)),
            float(item.get("det_confidence", 0.0)),
        ),
    )


def normalize_plate_results(
    plate_results: list[dict[str, Any]],
    path_mapping: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in plate_results:
        normalized_item = dict(item)
        mapping = path_mapping.get(str(item["image_path"]))
        if mapping:
            normalized_item["image_path"] = mapping["original_path"]
            normalized_item["bbox"] = offset_bbox(
                list(normalized_item["bbox"]),
                int(mapping["offset_x"]),
                int(mapping["offset_y"]),
            )
            normalized_item["crop_bbox"] = offset_bbox(
                list(normalized_item["crop_bbox"]),
                int(mapping["offset_x"]),
                int(mapping["offset_y"]),
            )
            normalized_item["primary_car_bbox"] = mapping["primary_detection"]["bbox"]
            normalized_item["primary_car_crop_bbox"] = mapping["primary_detection"]["crop_bbox"]
        normalized.append(normalized_item)
    return normalized


def build_summary_text(image_results: list[dict[str, Any]]) -> str:
    total_images = len(image_results)
    car_images = sum(1 for item in image_results if item["car_detected"])
    plate_images = sum(1 for item in image_results if item["plate_detected"])
    return (
        f"Processed {total_images} image(s), "
        f"vehicle-positive {car_images}, "
        f"plate-positive {plate_images}."
    )


def main() -> None:
    args = parse_args()
    pipeline_dir = args.project / args.name
    if pipeline_dir.exists():
        shutil.rmtree(pipeline_dir)
    pipeline_dir.mkdir(parents=True, exist_ok=True)

    pipeline_start = time.perf_counter()
    input_images = iter_input_images(args.source)
    car_detection_json, car_detection_elapsed_sec = run_car_detector(args, pipeline_dir)
    car_detections = json.loads(car_detection_json.read_text(encoding="utf-8"))
    grouped_car_detections = group_by_image(car_detections)

    gated_source_start = time.perf_counter()
    gated_source, roi_mapping, primary_by_original = build_primary_vehicle_source(
        args.source,
        pipeline_dir,
        grouped_car_detections,
    )
    gated_source_elapsed_sec = time.perf_counter() - gated_source_start

    plate_results: list[dict[str, Any]] = []
    plate_result_json: str | None = None
    plate_pipeline_elapsed_sec = 0.0
    plate_timing_payload: dict[str, Any] | None = None
    if gated_source is not None:
        plate_result_path, plate_pipeline_elapsed_sec = run_plate_pipeline(args, pipeline_dir, gated_source)
        plate_result_json = str(plate_result_path)
        raw_plate_results = json.loads(plate_result_path.read_text(encoding="utf-8"))
        plate_results = normalize_plate_results(raw_plate_results, roi_mapping)
        plate_timing_path = pipeline_dir / "plate_pipeline" / "timings.json"
        if plate_timing_path.exists():
            plate_timing_payload = json.loads(plate_timing_path.read_text(encoding="utf-8"))
    grouped_plate_results = group_by_image(plate_results)

    image_results: list[dict[str, Any]] = []
    for image_path in input_images:
        image_path_str = str(image_path)
        image_car_detections = grouped_car_detections.get(image_path_str, [])
        image_plate_results = grouped_plate_results.get(image_path_str, [])
        best_plate_result = pick_best_plate_result(image_plate_results)
        primary_car = primary_by_original.get(image_path_str)
        image_results.append(
            {
                "image_path": image_path_str,
                "car_detected": bool(image_car_detections),
                "car_detection_count": len(image_car_detections),
                "car_detections": image_car_detections,
                "primary_car": primary_car,
                "plate_detected": bool(image_plate_results),
                "plate_detection_count": len(image_plate_results),
                "plate_results": image_plate_results,
                "best_plate_result": best_plate_result,
                "status": (
                    "no_car_detected"
                    if not image_car_detections
                    else "plate_found"
                    if image_plate_results
                    else "car_found_but_no_plate"
                ),
            }
        )

    total_elapsed_sec = time.perf_counter() - pipeline_start
    stage_timings = {
        "car_detection_sec": round(car_detection_elapsed_sec, 6),
        "gated_source_prepare_sec": round(gated_source_elapsed_sec, 6),
        "plate_pipeline_sec": round(plate_pipeline_elapsed_sec, 6),
        "plate_detection_sec": (
            plate_timing_payload.get("plate_detection_sec") if plate_timing_payload else 0.0
        ),
        "ocr_model_init_sec": (
            plate_timing_payload.get("ocr_model_init_sec") if plate_timing_payload else 0.0
        ),
        "crop_save_total_sec": (
            plate_timing_payload.get("crop_save_total_sec") if plate_timing_payload else 0.0
        ),
        "ocr_sec": plate_timing_payload.get("ocr_total_sec") if plate_timing_payload else 0.0,
        "ocr_stage_total_sec": (
            plate_timing_payload.get("ocr_stage_total_sec") if plate_timing_payload else 0.0
        ),
        "total_pipeline_sec": round(total_elapsed_sec, 6),
    }

    payload = {
        "source": str(args.source),
        "car_detection_json": str(car_detection_json),
        "plate_result_json": plate_result_json,
        "image_count": len(input_images),
        "vehicle_positive_count": sum(1 for item in image_results if item["car_detected"]),
        "plate_positive_count": sum(1 for item in image_results if item["plate_detected"]),
        "stage_timings": stage_timings,
        "summary": build_summary_text(image_results),
        "results": image_results,
    }

    result_json = pipeline_dir / "car_plate_results.json"
    result_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"Car-plate pipeline finished, results saved to: {pipeline_dir}")
    print(f"Vehicle detections file: {car_detection_json}")
    if plate_result_json:
        print(f"Plate pipeline file: {plate_result_json}")
    print(f"Final result file: {result_json}")
    print(f"Car detection time : {stage_timings['car_detection_sec']:.3f}s")
    print(f"Plate detection time: {stage_timings['plate_detection_sec']:.3f}s")
    print(f"OCR time           : {stage_timings['ocr_sec']:.3f}s")
    print(payload["summary"])


if __name__ == "__main__":
    main()
