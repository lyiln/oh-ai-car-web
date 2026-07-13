#!/usr/bin/env bash
# Probe Jetson serial ports for NMEA and ROS /gps/fix.
# Usage (on Jetson): bash jetson-gps-probe.sh
# Or via SSH: ssh jetson@10.82.66.179 'bash -s' < scripts/jetson-gps-probe.sh
set -euo pipefail

echo "========== SERIAL DEVICES =========="
ls -la /dev/myserial /dev/ttyUSB* /dev/ttyACM* 2>/dev/null || echo "no serial devices"

probe_nmea() {
  local port="$1"
  local baud="$2"
  if [ ! -e "$port" ]; then
    return
  fi
  stty -F "$port" "$baud" cs8 -cstopb -parenb raw -echo 2>/dev/null || true
  local data
  data="$(timeout 3 cat "$port" 2>/dev/null | tr -cd '\11\12\15\40-\176' || true)"
  if echo "$data" | grep -qE '\$GP|\$GN|\$GL|GGA|RMC'; then
    echo "FOUND_NMEA port=$port baud=$baud"
    echo "$data" | head -c 400
    echo
  fi
}

echo "========== NMEA SCAN =========="
FOUND=0
for port in /dev/ttyUSB0 /dev/ttyUSB1 /dev/ttyUSB2 /dev/myserial /dev/ttyACM0; do
  for baud in 9600 115200 38400 57600; do
    if probe_nmea "$port" "$baud"; then
      FOUND=1
    fi
  done
done
if [ "$FOUND" -eq 0 ]; then
  echo "NO_NMEA: no GPS NMEA sentences found on common ports/baud rates"
fi

echo "========== DOCKER / ROS =========="
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}' 2>/dev/null || true
CID="$(docker ps -q --filter name=oh-ai-gps | head -1)"
if [ -z "$CID" ]; then
  CID="$(docker ps -q --filter ancestor=yahboomtechnology/ros-foxy:5.0.1 | head -1)"
fi
if [ -z "$CID" ]; then
  CID="$(docker ps -q | head -1)"
fi
echo "CONTAINER=$CID"

if [ -n "$CID" ]; then
  docker exec "$CID" bash -lc 'source /opt/ros/foxy/setup.bash 2>/dev/null; echo ROS_DISTRO=$ROS_DISTRO; ros2 topic list 2>/dev/null | grep -iE "gps|fix|navsat" || echo NO_GPS_TOPIC; timeout 4 ros2 topic echo /gps/fix 2>/dev/null | head -30 || echo NO_FIX_SAMPLE'
fi

echo "========== DONE =========="
