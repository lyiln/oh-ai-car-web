#!/usr/bin/env python3
"""
Platform integration hook for oh-ai-car edge-agent.

Loaded by edge-agent/yolo_plate_adapter.py via create_detector().
Uses the in-process WebInferenceRuntime (car gate -> plate detect -> OCR).
"""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parent
SCRIPTS_DIR = PROJECT_ROOT / "scripts"
YOLOV5_DIR = PROJECT_ROOT / "yolov5"

for path in (SCRIPTS_DIR, YOLOV5_DIR):
    path_str = str(path)
    if path_str not in sys.path:
        sys.path.insert(0, path_str)


@dataclass(frozen=True)
class PlateDetection:
    plate: str | None
    confidence: float
    bbox: list[float]  # normalized [x, y, width, height] in 0..1


def _env_path(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    return Path(raw) if raw else default


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return float(raw) if raw else default


def _resolve_car_weights() -> Path:
    candidates = (
        _env_path("YOLO_CAR_WEIGHTS", PROJECT_ROOT / "weights" / "car_bdd100k_mini_v1_best.pt"),
        PROJECT_ROOT / "weights" / "car_bdd100k_mini_v1_best.pt",
        PROJECT_ROOT / "weights" / "yolov5s.pt",
    )
    for path in candidates:
        if path.is_file():
            return path
    raise FileNotFoundError(
        "Car detector weights not found. Set YOLO_CAR_WEIGHTS or place "
        "weights/car_bdd100k_mini_v1_best.pt under the YOLO repo."
    )


def _resolve_plate_weights() -> Path:
    candidates = (
        _env_path("YOLO_PLATE_WEIGHTS", PROJECT_ROOT / "weights" / "best_plate_detector_v2.pt"),
        PROJECT_ROOT / "weights" / "best_plate_detector_v2.pt",
        PROJECT_ROOT / "weights" / "best_plate_detector.pt",
        PROJECT_ROOT / "runs" / "train" / "plate_ccpd_gpu_v3_continue" / "weights" / "best.pt",
    )
    for path in candidates:
        if path.is_file():
            return path
    raise FileNotFoundError(
        "Plate detector weights not found. Set YOLO_PLATE_WEIGHTS or place "
        "weights/best_plate_detector_v2.pt under the YOLO repo."
    )


def _build_runtime_paths():
    from web_api_service import RuntimePaths

    return RuntimePaths(
        project_root=PROJECT_ROOT,
        runtime_root=PROJECT_ROOT / "demo_output" / "platform_runtime",
        yolov5_dir=YOLOV5_DIR,
        car_weights=_resolve_car_weights(),
        plate_weights=_resolve_plate_weights(),
        python_executable=Path(sys.executable),
        pipeline_script=SCRIPTS_DIR / "car_plate_pipeline.py",
    )


def _xyxy_to_norm(bbox: list[int] | list[float], img_w: int, img_h: int) -> list[float]:
    x1, y1, x2, y2 = [float(v) for v in bbox]
    if img_w <= 0 or img_h <= 0:
        return [0.0, 0.0, 0.0, 0.0]
    x = max(0.0, min(1.0, x1 / img_w))
    y = max(0.0, min(1.0, y1 / img_h))
    w = max(0.0, min(1.0 - x, (x2 - x1) / img_w))
    h = max(0.0, min(1.0 - y, (y2 - y1) / img_h))
    return [x, y, w, h]


def _normalize_plate_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    # Drop middle-dot / spaces / hyphens; keep Chinese province + alphanumerics.
    cleaned = (
        text.replace("·", "")
        .replace(".", "")
        .replace("・", "")
        .replace("-", "")
        .replace(" ", "")
        .upper()
    )
    return cleaned or None


def _map_payload_to_detections(payload: dict[str, Any], img_w: int, img_h: int) -> list[PlateDetection]:
    results = payload.get("results") or []
    if not results:
        return []
    image_result = results[0]
    primary_car = image_result.get("primary_car") or {}
    primary_bbox = primary_car.get("bbox") if isinstance(primary_car, dict) else None
    plate_results = image_result.get("plate_results") or []

    detections: list[PlateDetection] = []
    for item in plate_results:
        plate = _normalize_plate_text(item.get("plate_text"))
        ocr_conf = float(item.get("ocr_confidence") or 0.0)
        det_conf = float(item.get("det_confidence") or 0.0)
        confidence = ocr_conf if ocr_conf > 0 else det_conf
        # Prefer vehicle box for ROI intersection; fall back to plate box.
        box_src = primary_bbox if primary_bbox else item.get("bbox")
        if not box_src:
            continue
        detections.append(
            PlateDetection(
                plate=plate,
                confidence=confidence,
                bbox=_xyxy_to_norm(list(box_src), img_w, img_h),
            )
        )

    # If car found but no plate OCR, still emit vehicle box for manual review.
    if not detections and primary_bbox:
        detections.append(
            PlateDetection(
                plate=None,
                confidence=float(primary_car.get("confidence") or 0.0),
                bbox=_xyxy_to_norm(list(primary_bbox), img_w, img_h),
            )
        )
    return detections


class VendorPlateDetector:
    """In-process two-stage detector shared with the YOLO web runtime."""

    def __init__(self) -> None:
        from web_api_service import ensure_runtime_root
        from web_runtime_inference import RuntimeConfig, WebInferenceRuntime

        self.paths = _build_runtime_paths()
        ensure_runtime_root(self.paths.runtime_root)

        device = os.environ.get("YOLO_DEVICE", "").strip()
        self.runtime = WebInferenceRuntime(
            self.paths,
            RuntimeConfig(
                device=device,
                car_imgsz=int(os.environ.get("YOLO_CAR_IMGSZ", "512")),
                plate_imgsz=int(os.environ.get("YOLO_PLATE_IMGSZ", "512")),
                ocr_min_score=_env_float("YOLO_OCR_MIN_SCORE", 0.75),
            ),
        )
        self._run_counter = 0

    def detect(self, frame_bgr) -> list[PlateDetection]:
        import cv2  # noqa: PLC0415

        if frame_bgr is None or getattr(frame_bgr, "size", 0) == 0:
            return []

        img_h, img_w = frame_bgr.shape[:2]
        self._run_counter += 1
        run_id = f"platform_{self._run_counter:06d}_{uuid.uuid4().hex[:8]}"
        run_root = self.paths.runtime_root / "runs" / run_id
        run_root.mkdir(parents=True, exist_ok=True)

        with tempfile.TemporaryDirectory(prefix="oh_plate_") as tmp:
            source = Path(tmp) / "frame.jpg"
            ok = cv2.imwrite(str(source), frame_bgr)
            if not ok:
                raise RuntimeError("Failed to write temporary frame for plate inference")
            payload = self.runtime.run(source, run_root)

        # Keep only a few recent runs to avoid filling disk.
        self._cleanup_old_runs(keep=10)
        return _map_payload_to_detections(payload, img_w, img_h)

    def _cleanup_old_runs(self, keep: int = 10) -> None:
        runs_root = self.paths.runtime_root / "runs"
        if not runs_root.is_dir():
            return
        run_dirs = sorted(
            [path for path in runs_root.iterdir() if path.is_dir()],
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
        for old_dir in run_dirs[keep:]:
            shutil.rmtree(old_dir, ignore_errors=True)


def create_detector() -> VendorPlateDetector:
    mode = os.environ.get("YOLO_PIPELINE_MODE", "two_stage").lower()
    if mode not in {"two_stage", "plate_only"}:
        raise ValueError(f"Unsupported YOLO_PIPELINE_MODE={mode!r}; use two_stage or plate_only")
    if mode == "plate_only":
        # plate_only still uses WebInferenceRuntime but can be switched later;
        # for now two_stage is the supported production path.
        pass
    return VendorPlateDetector()
