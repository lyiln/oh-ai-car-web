#!/usr/bin/env python3
"""Publish synthetic sensor_msgs/NavSatFix when no GPS hardware is available.

Use only for pipeline verification. Set MOCK_GPS_LAT / MOCK_GPS_LNG / GPS_TOPIC.
"""
from __future__ import annotations

import math
import os
import time

import rclpy
from rclpy.node import Node
from sensor_msgs.msg import NavSatFix, NavSatStatus


class MockGpsPublisher(Node):
    def __init__(self) -> None:
        super().__init__('oh_ai_car_mock_gps')
        topic = os.environ.get('GPS_TOPIC', '/gps/fix')
        self.base_lat = float(os.environ.get('MOCK_GPS_LAT', '39.949'))
        self.base_lng = float(os.environ.get('MOCK_GPS_LNG', '116.339'))
        self.period = float(os.environ.get('MOCK_GPS_PERIOD', '1.0'))
        self.pub = self.create_publisher(NavSatFix, topic, 10)
        self.t0 = time.time()
        self.create_timer(self.period, self.on_timer)
        self.get_logger().info(f'Mock GPS publishing on {topic} near ({self.base_lat}, {self.base_lng})')

    def on_timer(self) -> None:
        elapsed = time.time() - self.t0
        # ~5–15 m walk pattern so the map shows a short track
        lat = self.base_lat + 0.00008 * math.sin(elapsed / 8.0)
        lng = self.base_lng + 0.0001 * math.cos(elapsed / 11.0)
        msg = NavSatFix()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.header.frame_id = 'gps'
        msg.status.status = NavSatStatus.STATUS_FIX
        msg.status.service = NavSatStatus.SERVICE_GPS
        msg.latitude = lat
        msg.longitude = lng
        msg.altitude = 45.0
        msg.position_covariance_type = NavSatFix.COVARIANCE_TYPE_DIAGONAL_KNOWN
        msg.position_covariance[0] = 9.0
        msg.position_covariance[4] = 9.0
        msg.position_covariance[8] = 36.0
        self.pub.publish(msg)


def main() -> None:
    rclpy.init()
    node = MockGpsPublisher()
    try:
        rclpy.spin(node)
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()
