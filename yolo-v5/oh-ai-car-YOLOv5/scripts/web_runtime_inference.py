#!/usr/bin/env python
from __future__ import annotations

import json
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import cv2
import numpy as np
import torch

from car_plate_pipeline import (
    build_summary_text,
    choose_primary_car_detection,
    expand_primary_bbox,
    offset_bbox,
    pick_best_plate_result,
    save_primary_vehicle_visual,
)
from plate_pipeline import save_crop
from plate_recognizer import build_ocr_model, recognize_plate_image
from web_api_service import RuntimePaths


@dataclass(frozen=True)
class RuntimeConfig:
    device: str
    car_imgsz: int = 512
    plate_imgsz: int = 512
    car_conf_thres: float = 0.15
    car_iou_thres: float = 0.45
    plate_conf_thres: float = 0.25
    plate_iou_thres: float = 0.45
    ocr_min_score: float = 0.75
    ocr_lang: str = "ch"
    full_ocr_det_conf_thres: float = 0.75


def ensure_yolov5_imports(yolov5_dir: Path) -> dict[str, Any]:
    if str(yolov5_dir) not in sys.path:
        sys.path.insert(0, str(yolov5_dir))

    from models.common import DetectMultiBackend
    from ultralytics.utils.plotting import Annotator, colors
    from utils.augmentations import letterbox
    from utils.general import check_img_size, non_max_suppression, scale_boxes
    from utils.torch_utils import select_device

    return {
        "DetectMultiBackend": DetectMultiBackend,
        "Annotator": Annotator,
        "colors": colors,
        "letterbox": letterbox,
        "check_img_size": check_img_size,
        "non_max_suppression": non_max_suppression,
        "scale_boxes": scale_boxes,
        "select_device": select_device,
    }


class CachedYoloDetector:
    def __init__(
        self,
        yolov5_dir: Path,
        weights: Path,
        device: str,
        imgsz: int,
        conf_thres: float,
        iou_thres: float,
        classes: list[int] | None = None,
        class_names: list[str] | None = None,
    ) -> None:
        mods = ensure_yolov5_imports(yolov5_dir)
        self.annotator_cls = mods["Annotator"]
        self.colors = mods["colors"]
        self.letterbox = mods["letterbox"]
        self.non_max_suppression = mods["non_max_suppression"]
        self.scale_boxes = mods["scale_boxes"]
        self.device = mods["select_device"](device or "")
        fp16 = self.device.type == "cuda"
        self.model = mods["DetectMultiBackend"](weights, device=self.device, dnn=False, fp16=fp16)
        self.stride = self.model.stride
        self.names = self.model.names
        self.pt = self.model.pt
        self.imgsz = mods["check_img_size"]((imgsz, imgsz), s=self.stride)
        self.conf_thres = conf_thres
        self.iou_thres = iou_thres
        self.classes = classes
        self.class_name_map = self._build_class_name_map(classes, class_names)
        self.model.warmup(imgsz=(1, 3, *self.imgsz))

    @staticmethod
    def _build_class_name_map(classes: list[int] | None, class_names: list[str] | None) -> dict[int, str]:
        if not classes or not class_names:
            return {}
        return {cls_id: class_names[index] for index, cls_id in enumerate(classes) if index < len(class_names)}

    def _label_for(self, cls_id: int, conf: float) -> str:
        class_name = self.class_name_map.get(cls_id, str(self.names[int(cls_id)]))
        return f"{class_name} {conf:.2f}"

    def _class_name(self, cls_id: int) -> str:
        return self.class_name_map.get(cls_id, str(self.names[int(cls_id)]))

    def infer(self, image_path: Path, visual_path: Path) -> tuple[list[dict[str, Any]], float]:
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Image is unreadable: {image_path}")

        letterboxed = self.letterbox(image, self.imgsz, stride=self.stride, auto=self.pt)[0]
        tensor_image = letterboxed.transpose((2, 0, 1))[::-1]
        tensor_image = np.ascontiguousarray(tensor_image)

        start_time = time.perf_counter()
        with torch.inference_mode():
            tensor = torch.from_numpy(tensor_image).to(self.device)
            tensor = tensor.half() if self.model.fp16 else tensor.float()
            tensor /= 255.0
            if tensor.ndim == 3:
                tensor = tensor.unsqueeze(0)

            predictions = self.model(tensor, augment=False, visualize=False)
            predictions = self.non_max_suppression(
                predictions,
                self.conf_thres,
                self.iou_thres,
                classes=self.classes,
                agnostic=False,
                max_det=1000,
            )
        elapsed_sec = time.perf_counter() - start_time

        detections: list[dict[str, Any]] = []
        annotator = self.annotator_cls(image.copy(), line_width=3, example=str(self.names))
        prediction = predictions[0].clone()
        if len(prediction):
            prediction[:, :4] = self.scale_boxes(tensor.shape[2:], prediction[:, :4], image.shape).round()
            for *xyxy, conf, cls in prediction.tolist():
                cls_id = int(cls)
                bbox = [int(round(value)) for value in xyxy]
                detections.append(
                    {
                        "image_path": str(image_path),
                        "bbox": bbox,
                        "confidence": round(float(conf), 6),
                        "class_id": cls_id,
                        "class_name": self._class_name(cls_id),
                    }
                )
                annotator.box_label(bbox, self._label_for(cls_id, float(conf)), color=self.colors(cls_id, True))

        visual_path.parent.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(visual_path), annotator.result())
        return detections, elapsed_sec


class WebInferenceRuntime:
    def __init__(self, paths: RuntimePaths, config: RuntimeConfig) -> None:
        self.paths = paths
        self.config = config
        self.lock = threading.Lock()
        torch.backends.cudnn.benchmark = True

        # car_bdd100k_mini weights use nc=3 (0=car, 1=bus, 2=truck), not COCO ids 2/5/7.
        self.car_detector = CachedYoloDetector(
            yolov5_dir=paths.yolov5_dir,
            weights=paths.car_weights,
            device=config.device,
            imgsz=config.car_imgsz,
            conf_thres=config.car_conf_thres,
            iou_thres=config.car_iou_thres,
            classes=[0, 1, 2],
            class_names=["car", "bus", "truck"],
        )
        self.plate_detector = CachedYoloDetector(
            yolov5_dir=paths.yolov5_dir,
            weights=paths.plate_weights,
            device=config.device,
            imgsz=config.plate_imgsz,
            conf_thres=config.plate_conf_thres,
            iou_thres=config.plate_iou_thres,
        )
        ocr_init_start = time.perf_counter()
        self.ocr_model = build_ocr_model(config.ocr_lang)
        self.ocr_model_init_sec = time.perf_counter() - ocr_init_start

    def run(self, source_image: Path, run_root: Path) -> dict[str, Any]:
        with self.lock:
            return self._run_locked(source_image, run_root)

    def _run_locked(self, source_image: Path, run_root: Path) -> dict[str, Any]:
        pipeline_start = time.perf_counter()
        car_visual_path = run_root / "car_detector" / source_image.name
        car_detections, car_detection_elapsed_sec = self.car_detector.infer(source_image, car_visual_path)

        primary_visual_path = run_root / "primary_vehicle" / "visuals" / source_image.name
        primary_input_dir = run_root / "primary_vehicle" / "input"
        plate_visual_dir = run_root / "plate_pipeline" / "detector"
        crop_dir = run_root / "plate_pipeline" / "plate_crops"
        crop_dir.mkdir(parents=True, exist_ok=True)

        primary_prepare_start = time.perf_counter()
        primary_detection, _ = choose_primary_car_detection(source_image, car_detections)
        primary_prepare_elapsed_sec = time.perf_counter() - primary_prepare_start

        plate_results: list[dict[str, Any]] = []
        primary_payload: dict[str, Any] | None = None
        plate_detection_elapsed_sec = 0.0
        crop_save_elapsed_total = 0.0
        ocr_elapsed_total = 0.0

        if primary_detection is not None:
            image = cv2.imread(str(source_image))
            if image is None:
                raise ValueError(f"Image is unreadable: {source_image}")
            img_h, img_w = image.shape[:2]
            crop_bbox = expand_primary_bbox(primary_detection["bbox"], img_w, img_h)
            x1, y1, x2, y2 = crop_bbox
            roi_image = image[y1:y2, x1:x2]
            primary_input_dir.mkdir(parents=True, exist_ok=True)
            primary_crop_path = primary_input_dir / f"{source_image.stem}_primary{source_image.suffix}"
            cv2.imwrite(str(primary_crop_path), roi_image)
            save_primary_vehicle_visual(source_image, primary_visual_path, primary_detection)

            primary_payload = dict(primary_detection)
            primary_payload["crop_bbox"] = crop_bbox
            primary_payload["crop_path"] = str(primary_crop_path)
            primary_payload["visual_path"] = str(primary_visual_path)

            plate_detections_roi, plate_detection_elapsed_sec = self.plate_detector.infer(
                primary_crop_path,
                plate_visual_dir / primary_crop_path.name,
            )
            plate_detections_roi = sorted(
                plate_detections_roi,
                key=lambda item: float(item.get("confidence", 0.0)),
                reverse=True,
            )

            for index, detection in enumerate(plate_detections_roi, start=1):
                crop_start = time.perf_counter()
                crop_path, crop_bbox_roi = save_crop(primary_crop_path, detection["bbox"], crop_dir, index)
                crop_save_elapsed_total += time.perf_counter() - crop_start

                ocr_start = time.perf_counter()
                det_confidence = float(detection["confidence"])
                ocr_result = recognize_plate_image(
                    self.ocr_model,
                    crop_path,
                    self.config.ocr_min_score,
                    variant_preset="fast",
                )
                fast_pass = bool(ocr_result["is_valid_plate"]) and float(ocr_result["ocr_confidence"]) >= self.config.ocr_min_score
                ran_full_ocr = False
                if det_confidence >= self.config.full_ocr_det_conf_thres and not fast_pass:
                    ocr_result = recognize_plate_image(
                        self.ocr_model,
                        crop_path,
                        self.config.ocr_min_score,
                        variant_preset="full",
                    )
                    ran_full_ocr = True
                ocr_elapsed_total += time.perf_counter() - ocr_start

                plate_results.append(
                    {
                        "image_path": str(source_image),
                        "bbox": offset_bbox(list(detection["bbox"]), x1, y1),
                        "crop_bbox": offset_bbox(list(crop_bbox_roi), x1, y1),
                        "det_confidence": round(float(detection["confidence"]), 6),
                        "crop_path": str(crop_path),
                        "plate_text": ocr_result["plate_text"],
                        "ocr_confidence": ocr_result["ocr_confidence"],
                        "is_valid_plate": ocr_result["is_valid_plate"],
                        "ocr_variant": ocr_result["ocr_variant"],
                        "ocr_profile": ocr_result.get("ocr_profile", "full"),
                        "full_ocr_triggered": ran_full_ocr,
                        "status": (
                            "ready_for_whitelist_compare"
                            if ocr_result["status"] == "ocr_pass"
                            else "manual_review"
                        ),
                        "primary_car_bbox": primary_detection["bbox"],
                        "primary_car_crop_bbox": crop_bbox,
                    }
                )

        best_plate_result = pick_best_plate_result(plate_results)
        image_result = {
            "image_path": str(source_image),
            "car_detected": bool(car_detections),
            "car_detection_count": len(car_detections),
            "car_detections": car_detections,
            "primary_car": primary_payload,
            "plate_detected": bool(plate_results),
            "plate_detection_count": len(plate_results),
            "plate_results": plate_results,
            "best_plate_result": best_plate_result,
            "status": (
                "no_car_detected"
                if not car_detections
                else "plate_found"
                if plate_results
                else "car_found_but_no_plate"
            ),
        }

        total_elapsed_sec = time.perf_counter() - pipeline_start
        payload = {
            "source": str(source_image),
            "car_detection_json": str(run_root / "car_detector" / "detections.json"),
            "plate_result_json": str(run_root / "plate_pipeline" / "pipeline_results.json"),
            "image_count": 1,
            "vehicle_positive_count": int(bool(car_detections)),
            "plate_positive_count": int(bool(plate_results)),
            "stage_timings": {
                "car_detection_sec": round(car_detection_elapsed_sec, 6),
                "gated_source_prepare_sec": round(primary_prepare_elapsed_sec, 6),
                "plate_pipeline_sec": round(
                    plate_detection_elapsed_sec + crop_save_elapsed_total + ocr_elapsed_total,
                    6,
                ),
                "plate_detection_sec": round(plate_detection_elapsed_sec, 6),
                "ocr_model_init_sec": 0.0,
                "crop_save_total_sec": round(crop_save_elapsed_total, 6),
                "ocr_sec": round(ocr_elapsed_total, 6),
                "ocr_stage_total_sec": round(crop_save_elapsed_total + ocr_elapsed_total, 6),
                "total_pipeline_sec": round(total_elapsed_sec, 6),
                "runtime_warm_start": True,
            },
            "summary": build_summary_text([image_result]),
            "results": [image_result],
        }

        (run_root / "car_detector").mkdir(parents=True, exist_ok=True)
        (run_root / "plate_pipeline").mkdir(parents=True, exist_ok=True)
        (run_root / "car_detector" / "detections.json").write_text(
            json.dumps(car_detections, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (run_root / "plate_pipeline" / "pipeline_results.json").write_text(
            json.dumps(plate_results, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (run_root / "plate_pipeline" / "timings.json").write_text(
            json.dumps(payload["stage_timings"], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        (run_root / "car_plate_results.json").write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return payload
