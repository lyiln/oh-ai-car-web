#!/usr/bin/env python3
"""One-off Jetson probe via SSH. Password via JETSON_SSH_PASSWORD env."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("JETSON_HOST", "10.82.66.179")
USER = os.environ.get("JETSON_USER", "jetson")
PASSWORD = os.environ.get("JETSON_SSH_PASSWORD", "")

REMOTE_SCRIPT = r"""#!/bin/bash
set +e
source /opt/ros/humble/setup.bash 2>/dev/null || source /opt/ros/foxy/setup.bash 2>/dev/null || source /opt/ros/galactic/setup.bash 2>/dev/null || true

echo '========== SYSTEM =========='
uname -a
cat /etc/os-release 2>/dev/null | head -8
hostname -I

echo '========== ROS2 =========='
echo ROS_DISTRO=$ROS_DISTRO
ros2 --version 2>/dev/null || echo 'ros2 not in PATH'
ls /opt/ros/ 2>/dev/null

echo '========== NODES =========='
ros2 node list 2>/dev/null

echo '========== ALL TOPICS =========='
ros2 topic list 2>/dev/null

echo '========== GPS TOPICS =========='
ros2 topic list 2>/dev/null | grep -iE 'gps|fix|navsat|gnss' || echo 'no gps-like topics'

echo '========== /gps/fix INFO =========='
ros2 topic info /gps/fix 2>/dev/null || echo 'no /gps/fix topic'

echo '========== /gps/fix SAMPLE =========='
timeout 5 ros2 topic echo /gps/fix --once 2>/dev/null || echo 'no data on /gps/fix in 5s'

echo '========== PORTS 6000/6500 =========='
ss -tlnp 2>/dev/null | grep -E '6000|6500' || echo 'ports 6000/6500 not listening'

echo '========== PYTHON =========='
python3 --version 2>/dev/null
python3 -c "import rclpy; from sensor_msgs.msg import NavSatFix; print('rclpy + NavSatFix: OK')" 2>&1

echo '========== DISK/MEM =========='
df -h / 2>/dev/null | tail -1
free -h 2>/dev/null | head -2

echo '========== JETSON =========='
cat /etc/nv_tegra_release 2>/dev/null || echo 'not tegra release file'
jetson_release 2>/dev/null || echo 'jetson_release not installed'
"""


def main() -> int:
    if not PASSWORD:
        print("Set JETSON_SSH_PASSWORD", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(
            HOST,
            username=USER,
            password=PASSWORD,
            timeout=15,
            allow_agent=False,
            look_for_keys=False,
        )
        _, stdout, stderr = client.exec_command(REMOTE_SCRIPT, timeout=90)
        sys.stdout.write(stdout.read().decode("utf-8", errors="replace"))
        err = stderr.read().decode("utf-8", errors="replace")
        if err.strip():
            sys.stdout.write("--- STDERR ---\n")
            sys.stdout.write(err)
        return 0
    except Exception as exc:
        print(f"SSH FAILED: {exc}", file=sys.stderr)
        return 1
    finally:
        client.close()


if __name__ == "__main__":
    raise SystemExit(main())
