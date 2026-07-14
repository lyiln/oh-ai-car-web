#!/usr/bin/env python3
"""Start a healthy ROS Foxy container with mock GPS + telemetry agent."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "edge-agent"
SECRETS = ROOT / "scripts" / ".local-jetson-gps.json"
PASSWORD = os.environ["JETSON_SSH_PASSWORD"]
HOST = os.environ.get("JETSON_HOST", "10.82.66.179")
USER = os.environ.get("JETSON_SSH_USER", "jetson")
REMOTE = "/home/jetson/oh-ai-car-edge"
NAME = "oh-ai-gps"


def run(client, cmd, timeout=180):
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    return stdout.channel.recv_exit_status(), out, err


def main():
    if os.environ.get("JETSON_ALLOW_CONTAINER_REPLACE") != "1":
        print("Set JETSON_ALLOW_CONTAINER_REPLACE=1 before replacing a remote container", file=sys.stderr)
        return 2
    secrets = json.loads(SECRETS.read_text(encoding="utf-8"))
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(paramiko.RejectPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20, allow_agent=False, look_for_keys=False)

    run(client, f"mkdir -p {REMOTE}")
    sftp = client.open_sftp()
    for name in ("telemetry_agent.py", "mock_gps_publisher.py", "start-telemetry.sh", "requirements.txt"):
        text = (EDGE / name).read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
        with sftp.file(f"{REMOTE}/{name}", "w") as fh:
            fh.write(text)
    env = (
        f"PLATFORM_API_URL={secrets['platformApiUrl']}\n"
        f"DEVICE_CREDENTIAL={secrets['deviceCredential']}\n"
        "GPS_TOPIC=/gps/fix\nMOCK_GPS=1\nFLUSH_INTERVAL_SECONDS=3\n"
        f"OUTBOX_PATH={REMOTE}/telemetry-outbox.sqlite3\n"
    )
    # OUTBOX inside mounted host path so container sees /root/oh-ai-car-edge
    env = (
        f"PLATFORM_API_URL={secrets['platformApiUrl']}\n"
        f"DEVICE_CREDENTIAL={secrets['deviceCredential']}\n"
        "GPS_TOPIC=/gps/fix\nMOCK_GPS=1\nFLUSH_INTERVAL_SECONDS=3\n"
        "OUTBOX_PATH=/root/oh-ai-car-edge/telemetry-outbox.sqlite3\n"
    )
    with sftp.file(f"{REMOTE}/.env.runtime", "w") as fh:
        fh.write(env)
    launcher = """#!/bin/bash
source /opt/ros/foxy/setup.bash
set -a
. /root/oh-ai-car-edge/.env.runtime
set +a
cd /root/oh-ai-car-edge
python3 mock_gps_publisher.py > mock.log 2>&1 &
echo $! > mock.pid
python3 telemetry_agent.py > agent.log 2>&1 &
echo $! > agent.pid
echo STARTED
tail -f /dev/null
"""
    with sftp.file(f"{REMOTE}/run-inside.sh", "w") as fh:
        fh.write(launcher.replace("\r\n", "\n"))
    sftp.close()
    run(client, f"chmod +x {REMOTE}/*.sh")

    print("=== remove old oh-ai-gps container ===")
    run(client, f"docker rm -f {NAME}")

    print("=== start new container ===")
    # Use --net=host so ROS and HTTP to platform work; mount edge dir
    cmd = (
        f"docker run -d --name {NAME} --net=host "
        f"-v {REMOTE}:/root/oh-ai-car-edge "
        f"yahboomtechnology/ros-foxy:5.0.1 "
        f"bash /root/oh-ai-car-edge/run-inside.sh"
    )
    code, out, err = run(client, cmd)
    print("run", code, out, err)
    time.sleep(8)

    print("=== status ===")
    _, out, err = run(client, f"docker ps -a --filter name={NAME} --format '{{{{.ID}}}} {{{{.Status}}}}'")
    print(out or err)
    _, out, err = run(client, f"docker logs {NAME} 2>&1 | tail -30")
    print("logs:", out or err)
    _, out, err = run(client, f"ls -la {REMOTE}; echo ---; cat {REMOTE}/mock.log 2>/dev/null; echo ---; cat {REMOTE}/agent.log 2>/dev/null")
    print(out or err)

    _, out, err = run(
        client,
        f"docker exec {NAME} bash -lc 'source /opt/ros/foxy/setup.bash; "
        f"timeout 5 ros2 topic list; timeout 5 ros2 topic echo /gps/fix 2>&1 | head -50'",
        timeout=40,
    )
    print("topics:\n", out or err)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
