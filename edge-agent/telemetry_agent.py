#!/usr/bin/env python3
"""ROS2 NavSatFix to platform telemetry bridge with a durable SQLite outbox."""
from __future__ import annotations

import json
import math
import os
import sqlite3
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import NavSatFix


class Outbox:
    def __init__(self, path: str) -> None:
        self.connection = sqlite3.connect(path, check_same_thread=False)
        self.connection.execute("CREATE TABLE IF NOT EXISTS outbox (occurred_at TEXT PRIMARY KEY, payload TEXT NOT NULL)")
        self.connection.commit()
        self.lock = threading.Lock()

    def enqueue(self, payload: dict) -> None:
        with self.lock:
            self.connection.execute("INSERT OR IGNORE INTO outbox (occurred_at,payload) VALUES (?,?)", (payload["occurredAt"], json.dumps(payload)))
            self.connection.commit()

    def batch(self, limit: int = 100) -> list[tuple[str, dict]]:
        with self.lock:
            rows = self.connection.execute("SELECT occurred_at,payload FROM outbox ORDER BY occurred_at LIMIT ?", (limit,)).fetchall()
        return [(row[0], json.loads(row[1])) for row in rows]

    def remove(self, timestamps: list[str]) -> None:
        if not timestamps:
            return
        with self.lock:
            self.connection.executemany("DELETE FROM outbox WHERE occurred_at=?", [(value,) for value in timestamps])
            self.connection.commit()


class TelemetryAgent(Node):
    def __init__(self) -> None:
        super().__init__('oh_ai_car_telemetry_agent')
        self.api_url = os.environ['PLATFORM_API_URL'].rstrip('/') + '/device/v1/telemetry'
        self.token = os.environ['DEVICE_CREDENTIAL']
        self.outbox = Outbox(os.environ.get('OUTBOX_PATH', 'telemetry-outbox.sqlite3'))
        self.create_subscription(NavSatFix, os.environ.get('GPS_TOPIC', '/gps/fix'), self.on_fix, 20)
        self.create_timer(float(os.environ.get('FLUSH_INTERVAL_SECONDS', '3')), self.flush)

    def on_fix(self, message: NavSatFix) -> None:
        if math.isnan(message.latitude) or math.isnan(message.longitude):
            self.get_logger().warning('Ignoring GPS fix without coordinates')
            return
        timestamp = datetime.fromtimestamp(message.header.stamp.sec + message.header.stamp.nanosec / 1_000_000_000, timezone.utc) if message.header.stamp.sec else datetime.now(timezone.utc)
        accuracy = None
        if message.position_covariance_type:
            accuracy = math.sqrt(max(message.position_covariance[0], message.position_covariance[4], 0))
        payload = {"occurredAt": timestamp.isoformat(), "longitude": message.longitude, "latitude": message.latitude, "altitudeM": None if math.isnan(message.altitude) else message.altitude, "accuracyM": accuracy}
        self.outbox.enqueue(payload)

    def flush(self) -> None:
        rows = self.outbox.batch()
        if not rows:
            return
        request = urllib.request.Request(self.api_url, data=json.dumps({"points": [value for _, value in rows]}).encode(), headers={"content-type": "application/json", "authorization": f"Bearer {self.token}"}, method='POST')
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                body = response.read()
                if response.status // 100 != 2:
                    raise urllib.error.HTTPError(self.api_url, response.status, 'Telemetry upload failed', response.headers, None)
            self.outbox.remove([timestamp for timestamp, _ in rows])
            message = f'Telemetry uploaded {len(rows)} point(s): {body.decode(errors="replace")}'
            self.get_logger().info(message)
            print(message, flush=True)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
            message = f'Telemetry upload deferred: {error}'
            self.get_logger().warning(message)
            print(message, flush=True)


def main() -> None:
    rclpy.init()
    node = TelemetryAgent()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
