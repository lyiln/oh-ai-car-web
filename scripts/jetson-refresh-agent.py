#!/usr/bin/env python3
"""Push updated edge-agent files into running oh-ai-gps container and restart processes."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
EDGE = ROOT / "edge-agent"
SECRETS = json.loads((ROOT / "scripts" / ".local-jetson-gps.json").read_text(encoding="utf-8"))
PASSWORD = os.environ["JETSON_SSH_PASSWORD"]
REMOTE = "/home/jetson/oh-ai-car-edge"
NAME = "oh-ai-gps"


def run(client, cmd, timeout=120):
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    return stdout.channel.recv_exit_status(), out, err


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("10.82.66.179", username="jetson", password=PASSWORD, timeout=20, allow_agent=False, look_for_keys=False)
    sftp = client.open_sftp()
    for name in ("telemetry_agent.py", "mock_gps_publisher.py", "start-telemetry.sh"):
        text = (EDGE / name).read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
        with sftp.file(f"{REMOTE}/{name}", "w") as fh:
            fh.write(text)
    sftp.close()
    run(client, f"chmod +x {REMOTE}/start-telemetry.sh")
    run(client, f"docker exec {NAME} pkill -f mock_gps_publisher.py")
    run(client, f"docker exec {NAME} pkill -f telemetry_agent.py")
    time.sleep(1)
    code, out, err = run(client, f"docker exec -d {NAME} bash /root/oh-ai-car-edge/run-inside.sh")
    print("restart", code, out, err)
    time.sleep(5)
    _, out, err = run(client, f"tail -20 {REMOTE}/agent.log; echo ---; tail -5 {REMOTE}/mock.log")
    print(out or err)
    client.close()


if __name__ == "__main__":
    main()
