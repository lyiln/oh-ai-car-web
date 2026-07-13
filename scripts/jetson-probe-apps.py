#!/usr/bin/env python3
from __future__ import annotations
import os, sys
import paramiko

PASSWORD = os.environ.get("JETSON_SSH_PASSWORD", "")
SCRIPT = r"""#!/bin/bash
set +e

echo '========== cmd.txt =========='
cat /home/jetson/cmd.txt 2>/dev/null

echo '========== code workspace =========='
ls -la /home/jetson/code/ 2>/dev/null
ls -la /home/jetson/code/yahboomcar_ws/ 2>/dev/null | head -15

echo '========== grep gps in workspace =========='
grep -ri "gps\|navsat\|/fix" /home/jetson/code/yahboomcar_ws --include="*.py" --include="*.launch*" --include="*.xml" --include="*.yaml" 2>/dev/null | head -25

echo '========== icar container inspect =========='
ICAR=$(docker ps -aq --filter ancestor=icar/ros-foxy:1.0.2 | head -1)
echo ICAR_ID=$ICAR
if [ -n "$ICAR" ]; then
  docker inspect icar/ros-foxy:1.0.2 --format '{{.Config.Cmd}} {{.Config.Entrypoint}}' 2>/dev/null
fi

echo '========== running host car processes =========='
ps aux | grep -iE 'app\.py|app_sim|rosmaster|car|tcp|6000|ros2|launch' | grep -v grep | head -25

echo '========== docker run helper scripts =========='
find /home/jetson -maxdepth 4 -name '*.sh' 2>/dev/null | xargs grep -l 'ros-foxy\|icar\|docker run' 2>/dev/null | head -10
for f in $(find /home/jetson -maxdepth 3 -name 'run*.sh' -o -name 'start*.sh' 2>/dev/null | head -8); do
  echo "--- $f ---"
  head -15 "$f" 2>/dev/null
done

echo '========== try icar container if exists running =========='
for CID in $(docker ps -q); do
  IMG=$(docker inspect -f '{{.Config.Image}}' $CID)
  echo "CONTAINER $CID IMAGE $IMG"
  docker exec $CID bash -lc 'source /opt/ros/foxy/setup.bash 2>/dev/null; ros2 topic list 2>/dev/null' | head -20
done
"""


def main():
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect('10.82.66.179', username='jetson', password=PASSWORD, timeout=15, allow_agent=False, look_for_keys=False)
    _, o, e = c.exec_command(SCRIPT, timeout=120)
    sys.stdout.write(o.read().decode('utf-8', errors='replace'))
    if e.read().strip():
        sys.stdout.write('--- STDERR ---\n' + e.read().decode('utf-8', errors='replace'))
    c.close()

if __name__ == '__main__':
    main()
