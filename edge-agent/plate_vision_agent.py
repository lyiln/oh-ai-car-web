#!/usr/bin/env python3
"""
Run YOLO plate detection on a camera stream and post patrol observations.

Requires:
  - yolo-v5/oh-ai-car-YOLOv5 (or vendor/oh-ai-car-YOLOv5) with platform_hook.py
  - PLATFORM_API_URL + DEVICE_CREDENTIAL
  - Active patrol task (queued on platform) or PLATE_VISION_TASK_ID + PLATE_VISION_WAYPOINT_ID
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

from evidence_store import default_store
from platform_client import PlatformClient
from yolo_plate_adapter import PlateDetection, load_plate_detector


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name)
    return float(raw) if raw else default


def _latest_gps() -> tuple[float | None, float | None]:
    path = Path(os.environ.get("GPS_CACHE_PATH", "gps-cache.json"))
    if not path.is_file():
        return None, None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
        lng = payload.get("longitude")
        lat = payload.get("latitude")
        return (float(lng), float(lat)) if lng is not None and lat is not None else (None, None)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None, None


def _open_capture(source: str):
    import cv2  # noqa: PLC0415

    if source.isdigit():
        return cv2.VideoCapture(int(source))
    return cv2.VideoCapture(source)


def _encode_jpeg(frame_bgr) -> bytes:
    import cv2  # noqa: PLC0415

    ok, encoded = cv2.imencode(".jpg", frame_bgr, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
    if not ok:
        raise RuntimeError("Failed to encode JPEG evidence")
    return encoded.tobytes()


def _annotate(frame_bgr, detections: list[PlateDetection]):
    import cv2  # noqa: PLC0415

    height, width = frame_bgr.shape[:2]
    annotated = frame_bgr.copy()
    for det in detections:
        x, y, bw, bh = det.bbox
        x1 = int(x * width)
        y1 = int(y * height)
        x2 = int((x + bw) * width)
        y2 = int((y + bh) * height)
        cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 200, 255), 2)
        label = det.plate or "plate"
        cv2.putText(annotated, f"{label} {det.confidence:.2f}", (x1, max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 200, 255), 2)
    return annotated


def _pick_waypoint(task: dict) -> dict | None:
    override = os.environ.get("PLATE_VISION_WAYPOINT_ID")
    waypoints = task.get("waypoints") or []
    if override:
        for item in waypoints:
            if item.get("id") == override:
                return item
    return waypoints[0] if waypoints else None


def _should_post(det: PlateDetection) -> bool:
    min_conf = _env_float("PLATE_MIN_CONFIDENCE", 0.45)
    if det.confidence < min_conf:
        return False
    if det.plate:
        return True
    return os.environ.get("PLATE_ALLOW_BBOX_ONLY", "0") == "1"


def run_loop() -> None:
    client = PlatformClient()
    detector = load_plate_detector()
    store = default_store()
    if os.environ.get("EVIDENCE_SERVE", "1") == "1":
        host = os.environ.get("EVIDENCE_HOST", "0.0.0.0")
        port = int(os.environ.get("EVIDENCE_PORT", "8089"))
        store.start_server(host, port)
        print(f"Evidence server http://{host}:{port}/", flush=True)

    source = os.environ.get("PLATE_VIDEO_SOURCE", "0")
    interval = _env_float("PLATE_SCAN_INTERVAL_SECONDS", 2.0)
    task_poll = _env_float("PLATE_TASK_POLL_SECONDS", 5.0)

    fixed_task_id = os.environ.get("PLATE_VISION_TASK_ID")
    active_task: dict | None = None
    active_waypoint: dict | None = None
    last_task_poll = 0.0

    capture = _open_capture(source)
    if not capture.isOpened():
        raise RuntimeError(f"Could not open video source: {source}")

    print(f"Plate vision agent started source={source}", flush=True)
    try:
        while True:
            now = time.time()
            if fixed_task_id:
                if active_task is None:
                    active_task = {"id": fixed_task_id, "waypoints": []}
                    active_waypoint = {"id": os.environ["PLATE_VISION_WAYPOINT_ID"]} if os.environ.get("PLATE_VISION_WAYPOINT_ID") else {"id": "manual"}
            elif now - last_task_poll >= task_poll:
                last_task_poll = now
                claimed = client.claim_next_patrol_task()
                if claimed:
                    active_task = claimed
                    active_waypoint = _pick_waypoint(claimed)
                    print(f"Claimed patrol task {claimed.get('id')} waypoint={active_waypoint and active_waypoint.get('id')}", flush=True)
                elif active_task is None:
                    print("No queued patrol task; waiting…", flush=True)

            ok, frame = capture.read()
            if not ok:
                time.sleep(0.2)
                continue

            detections = [det for det in detector.detect(frame) if _should_post(det)]
            if not detections or active_task is None or active_waypoint is None:
                time.sleep(interval)
                continue

            best = max(detections, key=lambda item: item.confidence)
            evidence_bytes = _encode_jpeg(frame)
            annotated_bytes = _encode_jpeg(_annotate(frame, detections))
            evidence_url = store.save_jpeg(evidence_bytes, "evidence")
            annotated_url = store.save_jpeg(annotated_bytes, "annotated")
            longitude, latitude = _latest_gps()

            event = {
                "type": "observation",
                "waypointId": active_waypoint["id"],
                "occurredAt": datetime.now(timezone.utc).isoformat(),
                "plate": best.plate,
                "confidence": best.confidence,
                "vehicleBox": best.bbox,
                "evidenceImageUrl": evidence_url,
                "annotatedImageUrl": annotated_url,
            }
            if longitude is not None and latitude is not None:
                event["longitude"] = longitude
                event["latitude"] = latitude

            result = client.post_patrol_event(active_task["id"], event)
            print(f"Posted observation plate={best.plate} conf={best.confidence:.2f} -> {result}", flush=True)
            time.sleep(interval)
    finally:
        capture.release()


if __name__ == "__main__":
    run_loop()
