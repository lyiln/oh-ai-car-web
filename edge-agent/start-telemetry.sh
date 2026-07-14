#!/usr/bin/env bash
# Start telemetry agent (and optional mock GPS) inside a ROS2 Foxy environment.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

: "${PLATFORM_API_URL:?PLATFORM_API_URL is required, e.g. http://10.82.66.59:8788}"
: "${DEVICE_CREDENTIAL:?DEVICE_CREDENTIAL is required (uuid.secret)}"

export GPS_TOPIC="${GPS_TOPIC:-/gps/fix}"
export FLUSH_INTERVAL_SECONDS="${FLUSH_INTERVAL_SECONDS:-3}"
export OUTBOX_PATH="${OUTBOX_PATH:-$SCRIPT_DIR/telemetry-outbox.sqlite3}"
export MOCK_GPS="${MOCK_GPS:-0}"

if [ -f /opt/ros/foxy/setup.bash ]; then
  # shellcheck disable=SC1091
  source /opt/ros/foxy/setup.bash
elif [ -f /opt/ros/humble/setup.bash ]; then
  # shellcheck disable=SC1091
  source /opt/ros/humble/setup.bash
else
  echo "ROS2 setup.bash not found; source your distro first." >&2
  exit 1
fi

if [ "$MOCK_GPS" = "1" ]; then
  echo "Starting mock GPS publisher on $GPS_TOPIC"
  python3 "$SCRIPT_DIR/mock_gps_publisher.py" &
  MOCK_PID=$!
  trap 'kill $MOCK_PID 2>/dev/null || true' EXIT
  sleep 1
fi

echo "Starting telemetry agent -> $PLATFORM_API_URL topic=$GPS_TOPIC"
exec python3 "$SCRIPT_DIR/telemetry_agent.py"
