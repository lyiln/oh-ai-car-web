#!/usr/bin/env python3
from __future__ import annotations
import os
import paramiko

PASSWORD = os.environ["JETSON_SSH_PASSWORD"]
NAME = "oh-ai-gps"


def run(client, cmd, timeout=60):
    _, stdout, stderr = client.exec_command(cmd, timeout=timeout)
    out = stdout.read().decode("utf-8", errors="replace")
    err = stderr.read().decode("utf-8", errors="replace")
    return out, err


def main():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect("10.82.66.179", username="jetson", password=PASSWORD, timeout=20, allow_agent=False, look_for_keys=False)
    cmds = [
        f"docker exec {NAME} bash -lc 'ps aux | grep -E \"python|mock|telemetry\" | grep -v grep'",
        f"docker exec {NAME} bash -lc 'cat /root/oh-ai-car-edge/mock.pid /root/oh-ai-car-edge/agent.pid; ls -la /root/oh-ai-car-edge/*.log; wc -c /root/oh-ai-car-edge/*.log; cat /root/oh-ai-car-edge/mock.log; echo ===; cat /root/oh-ai-car-edge/agent.log'",
        f"docker exec {NAME} bash -lc 'source /opt/ros/foxy/setup.bash; echo ROS_DOMAIN_ID=$ROS_DOMAIN_ID; ros2 node list; ros2 topic list'",
        f"docker exec {NAME} bash -lc 'source /opt/ros/foxy/setup.bash; python3 -c \"import rclpy; from sensor_msgs.msg import NavSatFix; print(OK)\"'",
        "ls -la /home/jetson/oh-ai-car-edge/; sqlite3 /home/jetson/oh-ai-car-edge/telemetry-outbox.sqlite3 'select count(*) from outbox;' 2>/dev/null || python3 -c \"import sqlite3; c=sqlite3.connect('/home/jetson/oh-ai-car-edge/telemetry-outbox.sqlite3'); print(c.execute('select count(*) from outbox').fetchone())\"",
    ]
    for cmd in cmds:
        print("CMD:", cmd[:80])
        out, err = run(client, cmd, timeout=40)
        print(out)
        if err.strip():
            print("ERR:", err)
    client.close()


if __name__ == "__main__":
    main()
