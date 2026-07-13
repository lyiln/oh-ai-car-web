#!/usr/bin/env python3
"""Unit tests for YOLO plate adapter (mock mode, no GPU)."""
from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

os.environ["PLATE_DETECTOR_MODE"] = "mock"


class PlateAdapterTests(unittest.TestCase):
    def test_mock_detector_returns_bbox(self) -> None:
        import numpy as np
        from yolo_plate_adapter import load_plate_detector

        detector = load_plate_detector()
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        results = detector.detect(frame)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].plate, "DEMO001")
        self.assertGreaterEqual(results[0].confidence, 0.75)
        self.assertEqual(len(results[0].bbox), 4)


class EvidenceStoreTests(unittest.TestCase):
    def test_save_and_url(self) -> None:
        import tempfile
        from evidence_store import EvidenceStore

        with tempfile.TemporaryDirectory() as tmp:
            store = EvidenceStore(Path(tmp), "http://example.invalid/evidence")
            url = store.save_jpeg(b"fake-jpeg", "test")
            self.assertTrue(url.startswith("http://example.invalid/evidence/test-"))
            self.assertTrue(any(Path(tmp).glob("test-*.jpg")))


if __name__ == "__main__":
    unittest.main()
