#!/usr/bin/env python3
"""ROS2 map-frame pose to platform bridge with a durable SQLite outbox.

阶段 B（只读位姿）用途：订阅 /amcl_pose（或 /odom）的 map 坐标位姿，转换为
{x, y, yaw}（米/弧度）后经设备凭据上报 POST /device/v1/pose。仅上报位姿，
不发送任何运动或导航指令；真车自主运动须遵守项目安全门禁分阶段执行。

环境变量：
  PLATFORM_API_URL   平台后端地址，如 http://127.0.0.1:8788（必填）
  DEVICE_CREDENTIAL  设备凭据 <id>.<secret>（必填）
  POSE_TOPIC         位姿话题，默认 /amcl_pose
  POSE_TOPIC_TYPE    amcl | odom，默认 amcl
  MAP_VERSION        地图版本，默认 floor-map-v1
  OUTBOX_PATH        本地断线缓存，默认 pose-outbox.sqlite3
  FLUSH_INTERVAL_SECONDS 上报间隔，默认 2
"""
from __future__ import annotations

import json
import math
import os
import sqlite3
import threading
import urllib.error
import urllib.request
from datetime import datetime, timezone

import rclpy
from rclpy.node import Node


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


def yaw_from_quaternion(z: float, w: float) -> float:
    # 平面机器人只有绕 z 轴的旋转，直接由 (z, w) 求偏航角。
    return math.atan2(2.0 * w * z, 1.0 - 2.0 * z * z)


class PoseAgent(Node):
    def __init__(self) -> None:
        super().__init__('oh_ai_car_pose_agent')
        self.api_url = os.environ['PLATFORM_API_URL'].rstrip('/') + '/device/v1/pose'
        self.token = os.environ['DEVICE_CREDENTIAL']
        self.map_version = os.environ.get('MAP_VERSION', 'floor-map-v1')
        self.outbox = Outbox(os.environ.get('OUTBOX_PATH', 'pose-outbox.sqlite3'))
        topic = os.environ.get('POSE_TOPIC', '/amcl_pose')
        topic_type = os.environ.get('POSE_TOPIC_TYPE', 'amcl').lower()
        if topic_type == 'odom':
            from nav_msgs.msg import Odometry
            self.create_subscription(Odometry, topic, self.on_odom, 20)
        else:
            from geometry_msgs.msg import PoseWithCovarianceStamped
            self.create_subscription(PoseWithCovarianceStamped, topic, self.on_amcl, 20)
        self.create_timer(float(os.environ.get('FLUSH_INTERVAL_SECONDS', '1')), self.flush)
        self.get_logger().info(f'Subscribing pose on {topic} ({topic_type}) -> {self.api_url}')

    def _enqueue_pose(self, header_stamp, position, orientation) -> None:
        # Use wall clock for occurredAt so live Web updates are not dropped by
        # ON CONFLICT when AMCL reuses/stamps collide across flushes.
        _ = header_stamp
        payload = {
            "occurredAt": datetime.now(timezone.utc).isoformat(),
            "x": float(position.x),
            "y": float(position.y),
            "yaw": yaw_from_quaternion(float(orientation.z), float(orientation.w)),
            "mapVersion": self.map_version,
        }
        self.outbox.enqueue(payload)

    def on_amcl(self, message) -> None:
        pose = message.pose.pose
        self._enqueue_pose(message.header.stamp, pose.position, pose.orientation)

    def on_odom(self, message) -> None:
        pose = message.pose.pose
        self._enqueue_pose(message.header.stamp, pose.position, pose.orientation)

    def flush(self) -> None:
        rows = self.outbox.batch()
        if not rows:
            return
        request = urllib.request.Request(
            self.api_url,
            data=json.dumps({"points": [value for _, value in rows]}).encode(),
            headers={"content-type": "application/json", "authorization": f"Bearer {self.token}"},
            method='POST',
        )
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                body = response.read()
                if response.status // 100 != 2:
                    raise urllib.error.HTTPError(self.api_url, response.status, 'Pose upload failed', response.headers, None)
            self.outbox.remove([timestamp for timestamp, _ in rows])
            message = f'Pose uploaded {len(rows)} point(s): {body.decode(errors="replace")}'
            self.get_logger().info(message)
            print(message, flush=True)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
            message = f'Pose upload deferred: {error}'
            self.get_logger().warning(message)
            print(message, flush=True)


def main() -> None:
    rclpy.init()
    node = PoseAgent()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
