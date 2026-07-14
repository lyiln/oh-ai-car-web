#!/usr/bin/env python3
"""Tests for YOLO platform_hook mapping (skips when weights/deps missing)."""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = ROOT.parent
sys.path.insert(0, str(ROOT))

YOLO_REPO = Path(
    os.environ.get(
        "YOLO_REPO_PATH",
        REPO_ROOT / "YOLOv5" / "oh-ai-car-YOLOv5",
    )
)
HOOK_PATH = YOLO_REPO / "platform_hook.py"
PLATE_WEIGHTS = YOLO_REPO / "weights" / "best_plate_detector_v2.pt"
CAR_WEIGHTS = YOLO_REPO / "weights" / "car_bdd100k_mini_v1_best.pt"
DEMO_DIRS = [
    YOLO_REPO / "demo_input" / "val_batch_40",
    YOLO_REPO / "demo_input" / "hard_batch_20",
]


def _first_demo_image() -> Path | None:
    for directory in DEMO_DIRS:
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob("*.jpg")):
            return path
    return None


def _load_hook_module():
    spec = importlib.util.spec_from_file_location("yolo_platform_hook_test", HOOK_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {HOOK_PATH}")
    module = importlib.util.module_from_spec(spec)
    # Required for dataclasses + from __future__ import annotations on older CPython.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


WEIGHTS_READY = HOOK_PATH.is_file() and PLATE_WEIGHTS.is_file() and CAR_WEIGHTS.is_file()
DEMO_IMAGE = _first_demo_image()


class PlatformHookMappingUnitTests(unittest.TestCase):
    """Pure mapping helpers — no GPU required."""

    @unittest.skipUnless(HOOK_PATH.is_file(), "platform_hook.py not found")
    def test_xyxy_to_norm_and_plate_text(self) -> None:
        module = _load_hook_module()
        self.assertEqual(module._xyxy_to_norm([100, 50, 300, 150], 1000, 500), [0.1, 0.1, 0.2, 0.2])
        self.assertEqual(module._normalize_plate_text("皖A·12345"), "皖A12345")
        self.assertIsNone(module._normalize_plate_text("  "))

    @unittest.skipUnless(HOOK_PATH.is_file(), "platform_hook.py not found")
    def test_map_payload_prefers_primary_car_bbox(self) -> None:
        module = _load_hook_module()
        payload = {
            "results": [
                {
                    "primary_car": {"bbox": [10, 20, 210, 220], "confidence": 0.8},
                    "plate_results": [
                        {
                            "plate_text": "京A·88888",
                            "ocr_confidence": 0.92,
                            "det_confidence": 0.7,
                            "bbox": [50, 60, 150, 100],
                        }
                    ],
                }
            ]
        }
        detections = module._map_payload_to_detections(payload, 1000, 1000)
        self.assertEqual(len(detections), 1)
        self.assertEqual(detections[0].plate, "京A88888")
        self.assertAlmostEqual(detections[0].confidence, 0.92)
        self.assertEqual(detections[0].bbox, [0.01, 0.02, 0.2, 0.2])


@unittest.skipUnless(WEIGHTS_READY and DEMO_IMAGE is not None, "YOLO weights or demo image missing")
class PlatformHookInferenceTests(unittest.TestCase):
    """Optional end-to-end inference when torch/paddle/weights are available."""

    def test_detect_on_demo_image_returns_normalized_bbox(self) -> None:
        import cv2

        os.environ.setdefault("YOLO_DEVICE", "cpu")
        module = _load_hook_module()
        try:
            detector = module.create_detector()
        except Exception as exc:  # noqa: BLE001
            self.skipTest(f"Could not initialize detector: {exc}")

        frame = cv2.imread(str(DEMO_IMAGE))
        self.assertIsNotNone(frame)
        detections = detector.detect(frame)
        # Demo images vary; require either a plate result or an empty list (no crash).
        self.assertIsInstance(detections, list)
        for det in detections:
            self.assertEqual(len(det.bbox), 4)
            self.assertTrue(all(0.0 <= value <= 1.0 for value in det.bbox))
            self.assertGreaterEqual(det.confidence, 0.0)
            self.assertLessEqual(det.confidence, 1.0)


class AdapterPathTests(unittest.TestCase):
    def test_repo_path_prefers_bundled_yolov5(self) -> None:
        os.environ.pop("YOLO_REPO_PATH", None)
        os.environ["PLATE_DETECTOR_MODE"] = "mock"
        from yolo_plate_adapter import _repo_candidates

        candidates = _repo_candidates()
        normalized = [str(path).replace("\\", "/") for path in candidates]
        self.assertTrue(any("/YOLOv5/oh-ai-car-YOLOv5" in path for path in normalized))


if __name__ == "__main__":
    unittest.main()
