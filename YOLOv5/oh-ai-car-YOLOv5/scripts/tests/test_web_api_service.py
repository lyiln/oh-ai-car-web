from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import sys


SCRIPTS_DIR = Path(__file__).resolve().parents[1]
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from web_api_service import (  # noqa: E402
    build_infer_response,
    copy_uploaded_input_to_run,
    create_request_dirs,
    validate_upload_filename,
)


class WebApiServiceTests(unittest.TestCase):
    def test_validate_upload_filename_rejects_invalid_extension(self) -> None:
        with self.assertRaises(ValueError):
            validate_upload_filename("demo.txt")

    def test_validate_upload_filename_sanitizes_name(self) -> None:
        self.assertEqual(validate_upload_filename("my plate?.jpg"), "my_plate_.jpg")

    def test_build_infer_response_maps_visual_urls(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime_root = Path(temp_dir)
            run_root = runtime_root / "runs" / "run_demo"
            (run_root / "input").mkdir(parents=True, exist_ok=True)
            (run_root / "car_detector").mkdir(parents=True, exist_ok=True)
            (run_root / "primary_vehicle" / "visuals").mkdir(parents=True, exist_ok=True)
            (run_root / "primary_vehicle" / "input").mkdir(parents=True, exist_ok=True)
            (run_root / "plate_pipeline" / "detector").mkdir(parents=True, exist_ok=True)
            (run_root / "plate_pipeline" / "plate_crops").mkdir(parents=True, exist_ok=True)

            image_name = "demo.jpg"
            crop_path = run_root / "plate_pipeline" / "plate_crops" / "demo_plate_01.jpg"
            primary_visual_path = run_root / "primary_vehicle" / "visuals" / image_name
            primary_crop_path = run_root / "primary_vehicle" / "input" / "demo_primary.jpg"
            plate_visual_path = run_root / "plate_pipeline" / "detector" / "demo_primary.jpg"
            for target in [
                run_root / "input" / image_name,
                run_root / "car_detector" / image_name,
                primary_visual_path,
                primary_crop_path,
                plate_visual_path,
                crop_path,
            ]:
                target.write_bytes(b"x")

            payload = {
                "summary": "Processed 1 image(s), vehicle-positive 1, plate-positive 1.",
                "stage_timings": {
                    "car_detection_sec": 1.25,
                    "plate_detection_sec": 2.5,
                    "ocr_sec": 3.75,
                },
                "results": [
                    {
                        "image_path": str(Path("somewhere") / image_name),
                        "car_detected": True,
                        "car_detection_count": 1,
                        "car_detections": [{"class_name": "car", "confidence": 0.91, "bbox": [1, 2, 3, 4]}],
                        "primary_car": {
                            "bbox": [10, 20, 200, 260],
                            "confidence": 0.91,
                            "class_name": "car",
                            "crop_bbox": [6, 12, 210, 270],
                            "visual_path": str(primary_visual_path),
                            "crop_path": str(primary_crop_path),
                        },
                        "plate_detected": True,
                        "plate_detection_count": 1,
                        "best_plate_result": {
                            "plate_text": "皖A·12345",
                            "ocr_confidence": 0.98,
                            "crop_path": str(crop_path),
                        },
                        "status": "plate_found",
                    }
                ],
            }

            response = build_infer_response(runtime_root, run_root, payload)

            self.assertTrue(response["ok"])
            self.assertEqual(response["imageName"], image_name)
            self.assertEqual(response["bestPlateResult"]["plate_text"], "皖A·12345")
            self.assertEqual(response["primaryCar"]["bbox"], [10, 20, 200, 260])
            self.assertEqual(response["stageTimings"]["car_detection_sec"], 1.25)
            self.assertEqual(response["stageTimings"]["plate_detection_sec"], 2.5)
            self.assertEqual(response["stageTimings"]["ocr_sec"], 3.75)
            self.assertEqual(response["imageUrls"]["uploadedImageUrl"], "/api/files/runs/run_demo/input/demo.jpg")
            self.assertEqual(response["imageUrls"]["carVisualUrl"], "/api/files/runs/run_demo/car_detector/demo.jpg")
            self.assertEqual(response["imageUrls"]["primaryCarVisualUrl"], "/api/files/runs/run_demo/primary_vehicle/visuals/demo.jpg")
            self.assertEqual(response["imageUrls"]["primaryCarCropUrl"], "/api/files/runs/run_demo/primary_vehicle/input/demo_primary.jpg")
            self.assertEqual(response["imageUrls"]["plateVisualUrl"], "/api/files/runs/run_demo/plate_pipeline/detector/demo_primary.jpg")
            self.assertEqual(response["imageUrls"]["plateCropUrl"], "/api/files/runs/run_demo/plate_pipeline/plate_crops/demo_plate_01.jpg")

    def test_build_infer_response_normalizes_plate_text_whitespace(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime_root = Path(temp_dir)
            run_root = runtime_root / "runs" / "run_demo"
            (run_root / "input").mkdir(parents=True, exist_ok=True)
            (run_root / "car_detector").mkdir(parents=True, exist_ok=True)
            image_name = "demo.jpg"
            for target in [
                run_root / "input" / image_name,
                run_root / "car_detector" / image_name,
            ]:
                target.write_bytes(b"x")

            payload = {
                "results": [
                    {
                        "image_path": str(Path("somewhere") / image_name),
                        "car_detected": True,
                        "car_detection_count": 1,
                        "car_detections": [],
                        "plate_detected": True,
                        "plate_detection_count": 1,
                        "best_plate_result": {
                            "plate_text": "\n 皖A·12345 \t",
                            "ocr_confidence": 0.98,
                        },
                        "status": "plate_found",
                    }
                ],
            }

            response = build_infer_response(runtime_root, run_root, payload)

            self.assertEqual(response["bestPlateResult"]["plate_text"], "皖A·12345")

    def test_create_request_dirs_separates_upload_staging_from_run_output(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime_root = Path(temp_dir)

            request_dirs = create_request_dirs(runtime_root)

            self.assertNotEqual(request_dirs["upload_dir"].parents[1], request_dirs["run_root"])
            self.assertTrue(str(request_dirs["upload_dir"]).startswith(str(runtime_root / "uploads")))
            self.assertEqual(request_dirs["display_input_dir"], request_dirs["run_root"] / "input")

    def test_copy_uploaded_input_to_run_keeps_image_for_web_preview(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            runtime_root = Path(temp_dir)
            saved_image = runtime_root / "uploads" / "run_demo" / "input" / "demo.jpg"
            saved_image.parent.mkdir(parents=True, exist_ok=True)
            saved_image.write_bytes(b"demo")

            copied_path = copy_uploaded_input_to_run(saved_image, runtime_root / "runs" / "run_demo" / "input")

            self.assertTrue(copied_path.exists())
            self.assertEqual(copied_path.read_bytes(), b"demo")


if __name__ == "__main__":
    unittest.main()
