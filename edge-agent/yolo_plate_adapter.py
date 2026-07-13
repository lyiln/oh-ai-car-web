#!/usr/bin/env python3
"""Load plate detections from yolo-v5/oh-ai-car-YOLOv5 or Ultralytics weights."""
from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class PlateDetection:
    plate: str | None
    confidence: float
    bbox: list[float]  # normalized [x, y, width, height] in 0..1


class PlateDetector(Protocol):
    def detect(self, frame_bgr) -> list[PlateDetection]: ...


class MockPlateDetector:
    """Pipeline test without GPU / weights."""

    def detect(self, frame_bgr) -> list[PlateDetection]:
        height, width = frame_bgr.shape[:2]
        if width <= 0 or height <= 0:
            return []
        return [
            PlateDetection(
                plate="DEMO001",
                confidence=0.91,
                bbox=[0.25, 0.3, 0.2, 0.15],
            )
        ]


def _repo_candidates() -> list[Path]:
    root = Path(__file__).resolve().parents[1]
    env_path = os.environ.get("YOLO_REPO_PATH")
    candidates: list[Path] = []
    if env_path:
        candidates.append(Path(env_path))
    candidates.extend(
        [
            root / "yolo-v5" / "oh-ai-car-YOLOv5",
            root / "vendor" / "oh-ai-car-YOLOv5",
        ]
    )
    # Deduplicate while preserving order
    seen: set[str] = set()
    unique: list[Path] = []
    for path in candidates:
        key = str(path.resolve()) if path.exists() else str(path)
        if key in seen:
            continue
        seen.add(key)
        unique.append(path)
    return unique


def _repo_path() -> Path:
    for candidate in _repo_candidates():
        if candidate.is_dir():
            return candidate
    # Fall back to preferred default for error messages
    return Path(__file__).resolve().parents[1] / "yolo-v5" / "oh-ai-car-YOLOv5"


def _load_hook(repo: Path) -> PlateDetector | None:
    hook = repo / "platform_hook.py"
    if not hook.is_file():
        return None
    spec = importlib.util.spec_from_file_location("yolo_platform_hook", hook)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load {hook}")
    module = importlib.util.module_from_spec(spec)
    # Required for dataclasses + from __future__ import annotations on older CPython.
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    factory = getattr(module, "create_detector", None)
    if factory is None:
        raise RuntimeError(f"{hook} must define create_detector()")
    detector = factory()
    return detector  # type: ignore[return-value]


def _find_weights(repo: Path) -> Path | None:
    preferred = (
        "weights/best_plate_detector_v2.pt",
        "weights/best_plate_detector.pt",
        "weights/best.pt",
        "weights/last.pt",
        "best.pt",
        "runs/train/weights/best.pt",
    )
    for pattern in preferred:
        candidate = repo / pattern
        if candidate.is_file():
            return candidate
    weights_dir = repo / "weights"
    if weights_dir.is_dir():
        # Prefer plate weights over generic yolov5*.pt / car weights
        plate_hits = sorted(weights_dir.glob("*plate*.pt"))
        if plate_hits:
            return plate_hits[0]
        for path in sorted(weights_dir.glob("*.pt")):
            name = path.name.lower()
            if name.startswith("yolov5") or "car_" in name:
                continue
            return path
        for path in sorted(weights_dir.glob("*.pt")):
            return path
    return None


def _find_detect_script(repo: Path) -> Path | None:
    for candidate in (repo / "yolov5" / "detect.py", repo / "detect.py"):
        if candidate.is_file():
            return candidate
    return None


class TorchHubPlateDetector:
    """Fallback when vendor repo has weights but no platform_hook.py."""

    def __init__(self, weights: Path) -> None:
        import torch  # noqa: PLC0415

        self.model = torch.hub.load("ultralytics/yolov5", "custom", path=str(weights), source="local", force_reload=False)
        self.model.conf = float(os.environ.get("YOLO_CONF", "0.45"))
        names = getattr(self.model, "names", {}) or {}
        self.plate_class_ids = {
            index for index, label in names.items()
            if isinstance(label, str) and any(token in label.lower() for token in ("plate", "license", "lp"))
        }
        if not self.plate_class_ids and names:
            self.plate_class_ids = set(names.keys())

    def detect(self, frame_bgr) -> list[PlateDetection]:
        results = self.model(frame_bgr)
        height, width = frame_bgr.shape[:2]
        detections: list[PlateDetection] = []
        if not hasattr(results, "xyxy") or results.xyxy[0] is None:
            return detections
        for row in results.xyxy[0].cpu().numpy():
            x1, y1, x2, y2, conf, cls_id = row.tolist()
            if self.plate_class_ids and int(cls_id) not in self.plate_class_ids:
                continue
            bw = max(0.0, (x2 - x1) / width)
            bh = max(0.0, (y2 - y1) / height)
            detections.append(
                PlateDetection(
                    plate=None,
                    confidence=float(conf),
                    bbox=[float(x1 / width), float(y1 / height), bw, bh],
                )
            )
        return detections


class SubprocessDetectPlateDetector:
    """Invoke vendor yolov5/detect.py and parse saved labels (optional OCR in repo)."""

    def __init__(self, repo: Path, weights: Path) -> None:
        self.repo = repo
        self.weights = weights
        detect_script = _find_detect_script(repo)
        if detect_script is None:
            raise FileNotFoundError(f"Missing detect.py under {repo}/yolov5 or {repo}")
        self.detect_script = detect_script
        self.cwd = detect_script.parent

    def detect(self, frame_bgr) -> list[PlateDetection]:
        import cv2  # noqa: PLC0415
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            source = Path(tmp) / "frame.jpg"
            out = Path(tmp) / "out"
            cv2.imwrite(str(source), frame_bgr)
            cmd = [
                sys.executable,
                str(self.detect_script),
                "--weights",
                str(self.weights),
                "--source",
                str(source),
                "--project",
                str(out.parent),
                "--name",
                out.name,
                "--save-txt",
                "--save-conf",
                "--exist-ok",
            ]
            subprocess.run(cmd, cwd=self.cwd, check=True, capture_output=True, text=True)
            labels = list(out.rglob("labels/*.txt"))
            if not labels:
                return []
            detections: list[PlateDetection] = []
            for line in labels[0].read_text(encoding="utf-8").splitlines():
                parts = line.split()
                if len(parts) < 5:
                    continue
                _cls_id, xc, yc, bw, bh = parts[:5]
                conf = float(parts[5]) if len(parts) > 5 else 0.5
                xc, yc, bw, bh = map(float, (xc, yc, bw, bh))
                detections.append(
                    PlateDetection(
                        plate=None,
                        confidence=conf,
                        bbox=[
                            max(0.0, xc - bw / 2),
                            max(0.0, yc - bh / 2),
                            min(1.0, bw),
                            min(1.0, bh),
                        ],
                    )
                )
            return detections


def load_plate_detector() -> PlateDetector:
    mode = os.environ.get("PLATE_DETECTOR_MODE", "auto").lower()
    if mode == "mock":
        return MockPlateDetector()

    repo = _repo_path()
    if not repo.is_dir():
        raise FileNotFoundError(
            f"YOLO repo not found at {repo}. Place the repo at yolo-v5/oh-ai-car-YOLOv5 "
            "or set YOLO_REPO_PATH (see docs/integration/yolo-plate-recognition.md)."
        )

    hook = _load_hook(repo)
    if hook is not None:
        return hook

    weights = _find_weights(repo)
    if weights is None:
        raise FileNotFoundError(f"No weights/*.pt found under {repo}")

    detect_script = _find_detect_script(repo)
    if mode == "subprocess" or detect_script is not None:
        try:
            return SubprocessDetectPlateDetector(repo, weights)
        except Exception:
            if mode == "subprocess":
                raise

    return TorchHubPlateDetector(weights)
