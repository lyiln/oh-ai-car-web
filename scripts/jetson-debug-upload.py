#!/usr/bin/env python3
from __future__ import annotations
import json
import os
import paramiko
from pathlib import Path

PASSWORD = os.environ["JETSON_SSH_PASSWORD"]
SECRETS = json.loads(Path(__file__).resolve().parents[1].joinpath("scripts/.local-jetson-gps.json").read_text())


def run(client, cmd, timeout=60):
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    return stdout.read().decode("utf-8", errors="replace"), stderr.read().decode("utf-8", errors="replace")


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("10.82.66.179", username="jetson", password=PASSWORD, timeout=20, allow_agent=False, look_for_keys=False)

    url = SECRETS["platformApiUrl"]
    token = SECRETS["deviceCredential"]
    print("=== curl from container ===")
    out, err = run(client, f"docker exec oh-ai-gps bash -lc \"curl -s -o /tmp/r.txt -w '%{{http_code}}' --connect-timeout 5 {url}/api/auth/me; echo; cat /tmp/r.txt\"")
    print(out or err)

    print("=== outbox rows ===")
    out, err = run(
        client,
        "python3 - <<'PY'\n"
        "import sqlite3, json\n"
        "c=sqlite3.connect('/home/jetson/oh-ai-car-edge/telemetry-outbox.sqlite3')\n"
        "rows=c.execute('select occurred_at,payload from outbox order by occurred_at').fetchall()\n"
        "print('count', len(rows))\n"
        "for t,p in rows[:5]:\n"
        " print(t, p)\n"
        "PY",
    )
    print(out or err)

    print("=== manual telemetry POST from Jetson ===")
    body = json.dumps({
        "points": [{
            "occurredAt": "2026-07-13T02:55:00.000Z",
            "longitude": 116.339,
            "latitude": 39.949,
            "accuracyM": 5,
        }]
    })
    # write body to remote file to avoid quoting hell
    sftp = client.open_sftp()
    with sftp.file("/tmp/telemetry-test.json", "w") as fh:
        fh.write(body)
    sftp.close()
    out, err = run(
        client,
        f"curl -s -w '\\nHTTP:%{{http_code}}\\n' -X POST {url}/device/v1/telemetry "
        f"-H 'Authorization: Bearer {token}' -H 'Content-Type: application/json' "
        f"--data @/tmp/telemetry-test.json",
    )
    print(out or err)

    print("=== agent env / try flush with verbose ===")
    out, err = run(
        client,
        "docker exec oh-ai-gps bash -lc 'source /opt/ros/foxy/setup.bash; set -a; . /root/oh-ai-car-edge/.env.runtime; set +a; "
        "python3 - <<\"PY\"\n"
        "import os,urllib.request,json,sqlite3\n"
        "url=os.environ[\"PLATFORM_API_URL\"].rstrip(\"/\")+\"/device/v1/telemetry\"\n"
        "token=os.environ[\"DEVICE_CREDENTIAL\"]\n"
        "c=sqlite3.connect(\"/root/oh-ai-car-edge/telemetry-outbox.sqlite3\")\n"
        "rows=c.execute(\"select payload from outbox\").fetchall()\n"
        "points=[json.loads(r[0]) for r in rows]\n"
        "print(\"points\", len(points), \"url\", url)\n"
        "req=urllib.request.Request(url, data=json.dumps({\"points\":points}).encode(), headers={\"content-type\":\"application/json\",\"authorization\":f\"Bearer {token}\"}, method=\"POST\")\n"
        "try:\n"
        "  r=urllib.request.urlopen(req, timeout=10)\n"
        "  print(\"status\", r.status, r.read())\n"
        "except Exception as e:\n"
        "  print(\"ERR\", type(e), e)\n"
        "PY'",
        timeout=40,
    )
    print(out)
    print(err)
    client.close()


if __name__ == "__main__":
    main()
