#!/usr/bin/env python3
"""Local dev launcher: load secrets from scripts/.local-jetson-gps.json without shell env."""
from __future__ import annotations

import json
import os
from pathlib import Path


def _repo_candidates(root: Path) -> list[Path]:
    env_path = os.environ.get("YOLO_REPO_PATH", "").strip()
    candidates = [
        Path(env_path) if env_path else None,
        root / "YOLOv5" / "oh-ai-car-YOLOv5",
        root / "yolo-v5" / "oh-ai-car-YOLOv5",
        root / "vendor" / "oh-ai-car-YOLOv5",
        root.parents[1] / "YOLOv5" / "oh-ai-car-YOLOv5",
    ]
    unique: list[Path] = []
    seen: set[str] = set()
    for candidate in candidates:
        if candidate is None:
            continue
        key = str(candidate)
        if key in seen:
            continue
        seen.add(key)
        unique.append(candidate)
    return unique


def _resolve_repo(root: Path) -> Path:
    for candidate in _repo_candidates(root):
        if candidate.is_dir():
            return candidate
    return _repo_candidates(root)[0]


def main() -> None:
    root = Path(__file__).resolve().parents[1]
    secrets_path = root / "scripts" / ".local-jetson-gps.json"
    if secrets_path.is_file():
        secrets = json.loads(secrets_path.read_text(encoding="utf-8"))
        os.environ.setdefault("DEVICE_CREDENTIAL", secrets.get("deviceCredential", ""))

    # Local dev stack always talks to the machine running backend/gateway.
    os.environ["PLATFORM_API_URL"] = os.environ.get("PLATFORM_API_URL", "http://127.0.0.1:8788")

    task_path = root / "scripts" / ".local-plate-task.json"
    if task_path.is_file() and "PLATE_VISION_TASK_ID" not in os.environ:
        task_info = json.loads(task_path.read_text(encoding="utf-8"))
        if task_info.get("taskId"):
            os.environ["PLATE_VISION_TASK_ID"] = task_info["taskId"]
        if task_info.get("waypointId"):
            os.environ["PLATE_VISION_WAYPOINT_ID"] = task_info["waypointId"]

    yolo_repo = _resolve_repo(root)
    os.environ.setdefault("YOLO_REPO_PATH", str(yolo_repo))
    os.environ.setdefault("YOLO_DEVICE", "cpu")
    os.environ.setdefault("PLATE_DETECTOR_MODE", os.environ.get("PLATE_DETECTOR_MODE", "auto"))
    os.environ.setdefault("EVIDENCE_PUBLIC_BASE_URL", "http://127.0.0.1:8089/evidence")
    os.environ.setdefault("PLATE_SCAN_INTERVAL_SECONDS", "5")
    os.environ.setdefault("YOLO_RUNTIME_PROFILE", "video")

    demo = yolo_repo / "demo_input" / "first_batch"
    if demo.is_dir() and "PLATE_VIDEO_SOURCE" not in os.environ:
        images = sorted(demo.glob("*.jpg"))
        if images:
            os.environ["PLATE_VIDEO_SOURCE"] = str(images[0])

    from yolo_plate_adapter import load_plate_detector
    from plate_vision_agent import run_loop

    if os.environ.get("PLATE_DETECTOR_MODE", "auto") == "auto":
        try:
            load_plate_detector()
        except Exception as exc:  # noqa: BLE001
            print(f"YOLO detector unavailable ({exc}); falling back to mock mode.", flush=True)
            os.environ["PLATE_DETECTOR_MODE"] = "mock"

    run_loop()


if __name__ == "__main__":
    main()
