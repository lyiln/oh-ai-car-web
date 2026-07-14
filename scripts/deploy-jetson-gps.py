#!/usr/bin/env python3
"""Deploy edge-agent to Jetson and start mock GPS + telemetry inside ROS Docker."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
LOCAL_EDGE = ROOT / "edge-agent"
SECRETS = ROOT / "scripts" / ".local-jetson-gps.json"
HOST = os.environ.get("JETSON_HOST", "10.82.66.179")
USER = os.environ.get("JETSON_USER", "jetson")
PASSWORD = os.environ.get("JETSON_SSH_PASSWORD", "")
REMOTE_DIR = "/home/jetson/oh-ai-car-edge"


def ssh_exec(client: paramiko.SSHClient, cmd: str, timeout: int = 120) -> tuple[int, str, str]:
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    code = stdout.channel.recv_exit_status()
    return code, out, err


def main() -> int:
    if not PASSWORD:
        print("Set JETSON_SSH_PASSWORD", file=sys.stderr)
        return 1
    if not SECRETS.exists():
        print(f"Missing {SECRETS}; run platform-setup-jetson-gps.py first", file=sys.stderr)
        return 1
    secrets = json.loads(SECRETS.read_text(encoding="utf-8"))
    platform_url = secrets["platformApiUrl"]
    credential = secrets["deviceCredential"]

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20, allow_agent=False, look_for_keys=False)

    print("=== mkdir remote ===")
    ssh_exec(client, f"mkdir -p {REMOTE_DIR}")

    print("=== sftp edge-agent ===")
    sftp = client.open_sftp()
    for name in ("telemetry_agent.py", "mock_gps_publisher.py", "start-telemetry.sh", "requirements.txt"):
        local = str(LOCAL_EDGE / name)
        remote = f"{REMOTE_DIR}/{name}"
        sftp.put(local, remote)
        print("uploaded", name)
    env_file = (
        f"PLATFORM_API_URL={platform_url}\n"
        f"DEVICE_CREDENTIAL={credential}\n"
        "GPS_TOPIC=/gps/fix\n"
        "MOCK_GPS=1\n"
        "FLUSH_INTERVAL_SECONDS=3\n"
        "OUTBOX_PATH=/root/oh-ai-car-edge/telemetry-outbox.sqlite3\n"
    )
    with sftp.file(f"{REMOTE_DIR}/.env.runtime", "w") as fh:
        fh.write(env_file)
    sftp.close()
    ssh_exec(client, f"chmod +x {REMOTE_DIR}/start-telemetry.sh")

    print("=== reachability from Jetson ===")
    code, out, err = ssh_exec(
        client,
        f"curl -s -o /dev/null -w '%{{http_code}}' --connect-timeout 5 {platform_url}/api/auth/me || echo FAIL",
    )
    print("curl platform:", out.strip() or err.strip(), "exit", code)

    print("=== docker container ===")
    code, out, _ = ssh_exec(client, "docker ps -q --filter ancestor=yahboomtechnology/ros-foxy:5.0.1 | head -1")
    cid = out.strip()
    if not cid:
        code, out, _ = ssh_exec(client, "docker ps -q | head -1")
        cid = out.strip()
    print("container:", cid)
    if not cid:
        print("No running Docker container.")
        client.close()
        return 1

    print("=== copy into container ===")
    ssh_exec(client, f"docker exec {cid} mkdir -p /root/oh-ai-car-edge")
    ssh_exec(client, f"docker cp {REMOTE_DIR}/. {cid}:/root/oh-ai-car-edge/")

    print("=== check gps packages ===")
    code, out, err = ssh_exec(
        client,
        f"docker exec {cid} bash -lc 'source /opt/ros/foxy/setup.bash; "
        f"ros2 pkg list 2>/dev/null | grep -iE \"nmea|gps|navsat\" || echo NO_GPS_PKGS'",
    )
    print(out.strip() or err.strip())

    print("=== stop previous ===")
    ssh_exec(
        client,
        f"docker exec {cid} bash -lc "
        "'pkill -f mock_gps_publisher.py || true; pkill -f telemetry_agent.py || true'",
    )
    time.sleep(1)

    print("=== start mock GPS + telemetry ===")
    start_cmd = (
        f"docker exec -d {cid} bash -lc "
        "'source /opt/ros/foxy/setup.bash; "
        "set -a; . /root/oh-ai-car-edge/.env.runtime; set +a; "
        "cd /root/oh-ai-car-edge; "
        "nohup bash start-telemetry.sh > /root/oh-ai-car-edge/agent.log 2>&1'"
    )
    code, out, err = ssh_exec(client, start_cmd)
    print("start exit", code, out, err)

    time.sleep(6)
    print("=== agent log ===")
    code, out, err = ssh_exec(client, f"docker exec {cid} bash -lc 'tail -50 /root/oh-ai-car-edge/agent.log 2>/dev/null || echo no_log'")
    print(out or err)

    print("=== /gps/fix sample ===")
    code, out, err = ssh_exec(
        client,
        f"docker exec {cid} bash -lc 'source /opt/ros/foxy/setup.bash; "
        f"timeout 6 ros2 topic echo /gps/fix --once 2>/dev/null || echo NO_FIX'",
        timeout=40,
    )
    print(out or err)

    print("=== processes ===")
    code, out, err = ssh_exec(
        client,
        f"docker exec {cid} bash -lc 'ps aux | grep -E \"mock_gps|telemetry_agent\" | grep -v grep || true'",
    )
    print(out or err)

    client.close()
    print("DONE")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
