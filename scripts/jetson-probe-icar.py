#!/usr/bin/env python3
from __future__ import annotations
import os, sys
import paramiko

PASSWORD = os.environ.get("JETSON_SSH_PASSWORD", "")
SCRIPT = r"""#!/bin/bash
set +e
CID=417562e09314

echo '========== run_docker.sh (icar image?) =========='
cat /home/jetson/run_docker.sh

echo '========== icar ws inside container =========='
docker exec $CID bash -lc 'ls -la /root/icar_ros2_ws 2>/dev/null | head -10; ls -la /root/yahboomcar_ros2_ws 2>/dev/null | head -10'

echo '========== grep gps/navsat in icar ws =========='
docker exec $CID bash -lc 'grep -ri "gps\|navsat\|/fix\|NavSatFix" /root/icar_ros2_ws /root/yahboomcar_ros2_ws 2>/dev/null | head -30'

echo '========== icar packages =========='
docker exec $CID bash -lc 'source /opt/ros/foxy/setup.bash; source /root/icar_ros2_ws/install/setup.bash 2>/dev/null; ros2 pkg list 2>/dev/null | grep -iE "icar|gps|nav|bringup" | head -30'

echo '========== serial device =========='
ls -la /dev/myserial /dev/ttyUSB* /dev/ttyACM* 2>/dev/null

echo '========== host port 6000 6500 =========='
ss -tlnp | grep -E '6000|6500|9090|8888' || echo 'not listening on host'

echo '========== Rosmaster app.py tcp? =========='
grep -n "6000\|6500\|tcp\|gps\|GPS" /home/jetson/Rosmaster-App/rosmaster/app.py 2>/dev/null | head -20
grep -rn "6000\|6500" /home/jetson/Rosmaster-App/rosmaster/*.py 2>/dev/null | head -15
"""


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('10.82.66.179', username='jetson', password=PASSWORD, timeout=15, allow_agent=False, look_for_keys=False)
    _, o, e = c.exec_command(SCRIPT, timeout=90)
    sys.stdout.write(o.read().decode('utf-8', errors='replace'))
    c.close()

if __name__ == '__main__':
    main()
