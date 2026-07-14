#!/usr/bin/env python3
"""Probe Jetson serial ports for NMEA GPS sentences."""
from __future__ import annotations

import os
import sys

import paramiko

HOST = os.environ.get("JETSON_HOST", "10.82.66.179")
USER = os.environ.get("JETSON_USER", "jetson")
PASSWORD = os.environ.get("JETSON_SSH_PASSWORD", "")

SCRIPT = r"""#!/bin/bash
set +e
echo '========== SERIAL DEVICES =========='
ls -la /dev/myserial /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
udevadm info -q property -n /dev/ttyUSB0 2>/dev/null | grep -E 'ID_VENDOR|ID_MODEL|ID_SERIAL|DEVNAME' | head -10
udevadm info -q property -n /dev/ttyUSB1 2>/dev/null | grep -E 'ID_VENDOR|ID_MODEL|ID_SERIAL|DEVNAME' | head -10
udevadm info -q property -n /dev/ttyUSB2 2>/dev/null | grep -E 'ID_VENDOR|ID_MODEL|ID_SERIAL|DEVNAME' | head -10

echo '========== DOCKER =========='
docker ps --format 'table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Names}}'

probe_port() {
  local port="$1"
  local baud="$2"
  echo "----- $port baud=$baud -----"
  if [ ! -e "$port" ]; then echo missing; return; fi
  stty -F "$port" "$baud" cs8 -cstopb -parenb raw -echo 2>/dev/null
  timeout 4 cat "$port" 2>/dev/null | tr -cd '\11\12\15\40-\176' | head -c 800
  echo
}

echo '========== NMEA PROBE (no sudo) =========='
for port in /dev/ttyUSB0 /dev/ttyUSB1 /dev/ttyUSB2 /dev/myserial; do
  for baud in 9600 115200 38400 57600; do
    probe_port "$port" "$baud"
  done
done

echo '========== NMEA GREP =========='
for port in /dev/ttyUSB0 /dev/ttyUSB1 /dev/ttyUSB2 /dev/myserial; do
  for baud in 9600 115200; do
    stty -F "$port" "$baud" cs8 -cstopb -parenb raw -echo 2>/dev/null
    data=$(timeout 3 cat "$port" 2>/dev/null | tr -cd '\11\12\15\40-\176')
    if echo "$data" | grep -qE '\$GP|\$GN|\$GL|GGA|RMC'; then
      echo "FOUND_NMEA port=$port baud=$baud"
      echo "$data" | head -c 500
      echo
    fi
  done
done

echo '========== DONE =========='
"""


def main() -> int:
    if not PASSWORD:
        print("Set JETSON_SSH_PASSWORD", file=sys.stderr)
        return 1
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(HOST, username=USER, password=PASSWORD, timeout=20, allow_agent=False, look_for_keys=False)
    _, stdout, stderr = client.exec_command(SCRIPT, timeout=180)
    sys.stdout.write(stdout.read().decode("utf-8", errors="replace"))
    err = stderr.read().decode("utf-8", errors="replace")
    if err.strip():
        sys.stdout.write("--- STDERR ---\n" + err)
    client.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
