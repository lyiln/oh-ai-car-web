#!/usr/bin/env python
from __future__ import annotations

import mimetypes
import os
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any


IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv", ".webm"}


@dataclass(frozen=True)
class RuntimePaths:
    project_root: Path
    runtime_root: Path
    yolov5_dir: Path
    car_weights: Path
    plate_weights: Path
    python_executable: Path
    pipeline_script: Path


def build_runtime_paths(project_root: Path, python_executable: Path) -> RuntimePaths:
    return RuntimePaths(
        project_root=project_root,
        runtime_root=project_root / "demo_output" / "web_runtime",
        yolov5_dir=project_root / "yolov5",
        car_weights=project_root / "weights" / "yolov5s.pt",
        plate_weights=project_root / "runs" / "train" / "plate_ccpd_gpu_v3_continue" / "weights" / "best.pt",
        python_executable=python_executable,
        pipeline_script=project_root / "scripts" / "car_plate_pipeline.py",
    )


def build_health_payload(paths: RuntimePaths) -> dict[str, Any]:
    return {
        "ok": all(
            [
                paths.python_executable.exists(),
                paths.yolov5_dir.exists(),
                paths.car_weights.exists(),
                paths.plate_weights.exists(),
                paths.pipeline_script.exists(),
            ]
        ),
        "pythonReady": paths.python_executable.exists(),
        "yolov5Ready": paths.yolov5_dir.exists(),
        "carWeightsReady": paths.car_weights.exists(),
        "plateWeightsReady": paths.plate_weights.exists(),
        "pipelineReady": paths.pipeline_script.exists(),
        "pythonPath": str(paths.python_executable),
        "carWeightsPath": str(paths.car_weights),
        "plateWeightsPath": str(paths.plate_weights),
        "message": "模型与运行环境已就绪" if all(
            [
                paths.python_executable.exists(),
                paths.yolov5_dir.exists(),
                paths.car_weights.exists(),
                paths.plate_weights.exists(),
                paths.pipeline_script.exists(),
            ]
        ) else "存在缺失文件，请检查后端环境与模型路径",
    }


def ensure_runtime_root(runtime_root: Path) -> None:
    runtime_root.mkdir(parents=True, exist_ok=True)


def validate_upload_filename(
    filename: str,
    allowed_extensions: set[str] | None = None,
    error_message: str | None = None,
) -> str:
    allowed = allowed_extensions or IMAGE_EXTENSIONS
    suffix = Path(filename).suffix.lower()
    if suffix not in allowed:
        raise ValueError(error_message or "文件格式不受支持。")
    safe_stem = "".join(ch if ch.isalnum() or ch in {"-", "_"} else "_" for ch in Path(filename).stem)
    return f"{safe_stem or 'upload'}{suffix}"


def create_request_dirs(runtime_root: Path) -> dict[str, Path]:
    run_id = f"run_{uuid.uuid4().hex[:12]}"
    run_root = runtime_root / "runs" / run_id
    staging_root = runtime_root / "uploads" / run_id
    upload_dir = staging_root / "input"
    upload_dir.mkdir(parents=True, exist_ok=True)
    return {
        "run_id": Path(run_id),
        "run_root": run_root,
        "staging_root": staging_root,
        "upload_dir": upload_dir,
        "display_input_dir": run_root / "input",
    }


def save_upload_bytes(upload_dir: Path, filename: str, content: bytes) -> Path:
    saved_path = upload_dir / filename
    saved_path.write_bytes(content)
    return saved_path


def copy_uploaded_input_to_run(saved_image: Path, display_input_dir: Path) -> Path:
    display_input_dir.mkdir(parents=True, exist_ok=True)
    copied_path = display_input_dir / saved_image.name
    shutil.copy2(saved_image, copied_path)
    return copied_path


def file_to_public_url(runtime_root: Path, file_path: Path | None) -> str | None:
    if file_path is None or not file_path.exists():
        return None
    relative_path = file_path.relative_to(runtime_root).as_posix()
    return f"/api/files/{relative_path}"


def find_single_image_result(payload: dict[str, Any]) -> dict[str, Any]:
    results = payload.get("results", [])
    if not results:
        raise ValueError("模型返回中没有结果记录。")
    return results[0]


def normalize_plate_text(value: Any) -> str:
    if value is None:
        return ""
    return "".join(str(value).split())


def infer_visual_paths(
    runtime_root: Path,
    run_root: Path,
    image_name: str,
    best_plate_result: dict[str, Any] | None,
    primary_car: dict[str, Any] | None,
) -> dict[str, str | None]:
    best_crop_path = None
    if best_plate_result:
        crop_path = best_plate_result.get("crop_path")
        if crop_path:
            best_crop_path = Path(crop_path)
    plate_visual_name = image_name
    if primary_car and primary_car.get("crop_path"):
        plate_visual_name = Path(str(primary_car["crop_path"])).name

    return {
        "uploadedImageUrl": file_to_public_url(runtime_root, run_root / "input" / image_name),
        "carVisualUrl": file_to_public_url(runtime_root, run_root / "car_detector" / image_name),
        "plateVisualUrl": file_to_public_url(runtime_root, run_root / "plate_pipeline" / "detector" / plate_visual_name),
        "plateCropUrl": file_to_public_url(runtime_root, best_crop_path),
    }


def build_infer_response(runtime_root: Path, run_root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    image_result = find_single_image_result(payload)
    image_name = Path(str(image_result["image_path"])).name
    best_plate_result = image_result.get("best_plate_result")
    primary_car = image_result.get("primary_car")
    if isinstance(best_plate_result, dict):
        best_plate_result = dict(best_plate_result)
        best_plate_result["plate_text"] = normalize_plate_text(best_plate_result.get("plate_text"))
    if isinstance(primary_car, dict):
        primary_car = dict(primary_car)

    image_urls = infer_visual_paths(runtime_root, run_root, image_name, best_plate_result, primary_car)
    if isinstance(primary_car, dict):
        image_urls["primaryCarVisualUrl"] = file_to_public_url(runtime_root, Path(str(primary_car["visual_path"])))
        image_urls["primaryCarCropUrl"] = file_to_public_url(runtime_root, Path(str(primary_car["crop_path"])))

    return {
        "ok": True,
        "imageName": image_name,
        "summary": payload.get("summary", ""),
        "carDetected": bool(image_result.get("car_detected", False)),
        "carDetectionCount": int(image_result.get("car_detection_count", 0)),
        "carDetections": image_result.get("car_detections", []),
        "primaryCar": primary_car,
        "plateDetected": bool(image_result.get("plate_detected", False)),
        "plateDetectionCount": int(image_result.get("plate_detection_count", 0)),
        "bestPlateResult": best_plate_result,
        "status": str(image_result.get("status", "unknown")),
        "stageTimings": payload.get("stage_timings", {}),
        "imageUrls": image_urls,
        "rawResultPath": str(run_root / "car_plate_results.json"),
    }


def build_gate_response(runtime_root: Path, run_root: Path, payload: dict[str, Any]) -> dict[str, Any]:
    image_result = find_single_image_result(payload)
    image_name = Path(str(image_result["image_path"])).name
    primary_car = image_result.get("primary_car")
    if isinstance(primary_car, dict):
        primary_car = dict(primary_car)

    image_urls = {
        "uploadedImageUrl": file_to_public_url(runtime_root, run_root / "input" / image_name),
        "carVisualUrl": file_to_public_url(runtime_root, run_root / "car_detector" / image_name),
        "primaryCarVisualUrl": None,
        "primaryCarCropUrl": None,
        "plateVisualUrl": None,
        "plateCropUrl": None,
    }
    if isinstance(primary_car, dict):
        image_urls["primaryCarVisualUrl"] = file_to_public_url(runtime_root, Path(str(primary_car["visual_path"])))
        image_urls["primaryCarCropUrl"] = file_to_public_url(runtime_root, Path(str(primary_car["crop_path"])))

    return {
        "ok": True,
        "imageName": image_name,
        "summary": payload.get("summary", ""),
        "carDetected": bool(image_result.get("car_detected", False)),
        "carDetectionCount": int(image_result.get("car_detection_count", 0)),
        "carDetections": image_result.get("car_detections", []),
        "primaryCar": primary_car,
        "status": str(image_result.get("status", "unknown")),
        "stageTimings": payload.get("stage_timings", {}),
        "imageUrls": image_urls,
        "rawResultPath": str(run_root / "car_gate_results.json"),
    }


def cleanup_old_runs(runtime_root: Path, keep: int = 20) -> None:
    runs_root = runtime_root / "runs"
    if not runs_root.exists():
        return

    run_dirs = sorted(
        [path for path in runs_root.iterdir() if path.is_dir()],
        key=lambda item: item.stat().st_mtime,
        reverse=True,
    )
    for old_dir in run_dirs[keep:]:
        shutil.rmtree(old_dir, ignore_errors=True)


def guess_mime_type(file_path: Path) -> str:
    mime_type, _ = mimetypes.guess_type(str(file_path))
    return mime_type or "application/octet-stream"


def env_python_path() -> Path:
    return Path(os.environ.get("PYTHON_EXECUTABLE_OVERRIDE", Path(os.sys.executable)))
