#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

: "${PLATFORM_API_URL:?}"
: "${DEVICE_CREDENTIAL:?}"

# Prefer bundled YOLO checkout, then legacy local paths
DEFAULT_YOLO_REPO="$SCRIPT_DIR/../YOLOv5/oh-ai-car-YOLOv5"
if [ ! -d "$DEFAULT_YOLO_REPO" ]; then
  DEFAULT_YOLO_REPO="$SCRIPT_DIR/../yolo-v5/oh-ai-car-YOLOv5"
fi
if [ ! -d "$DEFAULT_YOLO_REPO" ]; then
  DEFAULT_YOLO_REPO="$SCRIPT_DIR/../vendor/oh-ai-car-YOLOv5"
fi
export YOLO_REPO_PATH="${YOLO_REPO_PATH:-$DEFAULT_YOLO_REPO}"
export PLATE_VIDEO_SOURCE="${PLATE_VIDEO_SOURCE:-0}"
export EVIDENCE_DIR="${EVIDENCE_DIR:-$SCRIPT_DIR/evidence-cache}"
export EVIDENCE_PUBLIC_BASE_URL="${EVIDENCE_PUBLIC_BASE_URL:-http://127.0.0.1:8089/evidence}"
export PLATE_SCAN_INTERVAL_SECONDS="${PLATE_SCAN_INTERVAL_SECONDS:-2}"
export PLATE_MIN_CONFIDENCE="${PLATE_MIN_CONFIDENCE:-0.45}"
export YOLO_DEVICE="${YOLO_DEVICE:-}"
export YOLO_OCR_MIN_SCORE="${YOLO_OCR_MIN_SCORE:-0.75}"
export YOLO_PIPELINE_MODE="${YOLO_PIPELINE_MODE:-two_stage}"

if [ -f /opt/ros/foxy/setup.bash ]; then
  # shellcheck disable=SC1091
  source /opt/ros/foxy/setup.bash
fi

exec python3 "$SCRIPT_DIR/plate_vision_agent.py"
