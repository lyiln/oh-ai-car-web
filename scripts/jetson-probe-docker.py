#!/usr/bin/env python3
"""Probe Jetson ROS inside Docker container."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("JETSON_HOST", "10.82.66.179")
USER = os.environ.get("JETSON_USER", "jetson")
PASSWORD = os.environ.get("JETSON_SSH_PASSWORD", "")

REMOTE_SCRIPT = r"""#!/bin/bash
set +e
echo '========== DOCKER CONTAINERS =========='
docker ps -a --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'

CID=$(docker ps -q --filter ancestor=yahboomtechnology/ros-foxy:5.0.1 | head -1)
if [ -z "$CID" ]; then CID=$(docker ps -q | head -1); fi
echo CONTAINER_ID=$CID

if [ -n "$CID" ]; then
  echo '========== INSIDE CONTAINER: ROS =========='
  docker exec "$CID" bash -lc 'source /opt/ros/foxy/setup.bash 2>/dev/null; echo ROS_DISTRO=$ROS_DISTRO; ros2 --version 2>/dev/null; ros2 node list 2>/dev/null'

  echo '========== INSIDE CONTAINER: ALL TOPICS =========='
  docker exec "$CID" bash -lc 'source /opt/ros/foxy/setup.bash; ros2 topic list 2>/dev/null'

  echo '========== INSIDE CONTAINER: GPS-LIKE TOPICS =========='
  docker exec "$CID" bash -lc 'source /opt/ros/foxy/setup.bash; ros2 topic list 2>/dev/null | grep -iE "gps|fix|navsat|gnss|odom|imu|pose"'

  echo '========== INSIDE CONTAINER: /gps/fix =========='
  docker exec "$CID" bash -lc 'source /opt/ros/foxy/setup.bash; ros2 topic info /gps/fix 2>/dev/null; timeout 5 ros2 topic echo /gps/fix --once 2>/dev/null' || echo 'no /gps/fix data'

  echo '========== INSIDE CONTAINER: PORTS =========='
  docker exec "$CID" bash -lc 'ss -tlnp 2>/dev/null | grep -E "6000|6500|9090|8888" || echo no matching ports in container'

  echo '========== INSIDE CONTAINER: PROCESSES =========='
  docker exec "$CID" bash -lc 'ps aux | grep -iE "ros|gps|car|tcp|nav" | grep -v grep | head -20'

  echo '========== INSIDE CONTAINER: PYTHON =========='
  docker exec "$CID" bash -lc 'python3 --version; python3 -c "import rclpy; from sensor_msgs.msg import NavSatFix; print(\"rclpy OK\")" 2>&1'
fi

echo '========== HOST Rosmaster-App =========='
ls -la /home/jetson/Rosmaster-App/rosmaster/ 2>/dev/null | head -12
if [ -f /home/jetson/Rosmaster-App/rosmaster/start_app.sh ]; then
  echo '--- start_app.sh head ---'
  head -20 /home/jetson/Rosmaster-App/rosmaster/start_app.sh
fi
"""


def main() -> int:
    if not PASSWORD:
        print("Set JETSON_SSH_PASSWORD", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(HOST, username=USER, password=PASSWORD, timeout=15, allow_agent=False, look_for_keys=False)
        _, stdout, stderr = client.exec_command(REMOTE_SCRIPT, timeout=120)
        sys.stdout.write(stdout.read().decode("utf-8", errors="replace"))
        err = stderr.read().decode("utf-8", errors="replace")
        if err.strip():
            sys.stdout.write("--- STDERR ---\n" + err)
        return 0
    except Exception as exc:
        print(f"SSH FAILED: {exc}", file=sys.stderr)
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
