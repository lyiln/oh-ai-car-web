"""Navigation backends for patrol_scheduler.

- sim: time-based fake navigation; no ROS dependency; may publish pose over HTTPS.
- nav2: NavigateToPose action client (requires ROS 2 + nav2_msgs on the vehicle).
"""
from __future__ import annotations

import json
import math
import os
import threading
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable, Optional, Protocol


@dataclass
class Pose2D:
    x: float
    y: float
    yaw: float


class NavBackend(Protocol):
    def navigate(self, goal: Pose2D, should_cancel: Callable[[], bool]) -> bool:
        """Drive toward goal. Return True on success, False if cancelled or failed."""

    def cancel(self) -> None:
        ...

    def wait_zero_velocity(self, timeout_seconds: float = 5.0) -> bool:
        ...


class SimNavBackend:
    """Fake navigator: interpolate pose over duration and optionally POST /device/v1/pose."""

    def __init__(
        self,
        *,
        platform_api_url: str,
        device_credential: str,
        map_version: str,
        travel_seconds: float = 2.0,
        publish_pose: bool = True,
    ) -> None:
        self.platform_api_url = platform_api_url.rstrip('/')
        self.device_credential = device_credential
        self.map_version = map_version
        self.travel_seconds = max(0.2, travel_seconds)
        self.publish_pose = publish_pose
        self._cancel = threading.Event()
        self._pose = Pose2D(0.0, 0.0, 0.0)

    def cancel(self) -> None:
        self._cancel.set()

    def wait_zero_velocity(self, timeout_seconds: float = 5.0) -> bool:
        # Simulated motion is discrete; treat cancel as already stopped.
        return True

    def navigate(self, goal: Pose2D, should_cancel: Callable[[], bool]) -> bool:
        self._cancel.clear()
        start = self._pose
        steps = max(1, int(self.travel_seconds / 0.2))
        for index in range(1, steps + 1):
            if self._cancel.is_set() or should_cancel():
                self._cancel.set()
                return False
            t = index / steps
            pose = Pose2D(
                x=start.x + (goal.x - start.x) * t,
                y=start.y + (goal.y - start.y) * t,
                yaw=start.yaw + (goal.yaw - start.yaw) * t,
            )
            self._pose = pose
            if self.publish_pose:
                self._post_pose(pose)
            time.sleep(self.travel_seconds / steps)
        self._pose = goal
        if self.publish_pose:
            self._post_pose(goal)
        return True

    def _post_pose(self, pose: Pose2D) -> None:
        from datetime import datetime, timezone

        payload = {
            "points": [{
                "occurredAt": datetime.now(timezone.utc).isoformat(),
                "x": pose.x,
                "y": pose.y,
                "yaw": pose.yaw,
                "mapVersion": self.map_version,
            }],
        }
        request = urllib.request.Request(
            f"{self.platform_api_url}/device/v1/pose",
            data=json.dumps(payload).encode(),
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {self.device_credential}",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=5) as response:
                response.read()
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
            # Pose publish is best-effort during sim travel.
            pass


class Nav2Backend:
    """Real Nav2 NavigateToPose client. Import rclpy only when constructed."""

    def __init__(
        self,
        *,
        node,
        action_name: str = "navigate_to_pose",
        map_frame: str = "map",
        cmd_vel_topic: str = "/cmd_vel",
    ) -> None:
        import rclpy
        from action_msgs.msg import GoalStatus, GoalStatusArray
        from geometry_msgs.msg import Twist
        from nav2_msgs.action import NavigateToPose
        from rclpy.action import ActionClient
        from rclpy.qos import DurabilityPolicy, QoSProfile, ReliabilityPolicy

        self._node = node
        self._rclpy = rclpy
        self._map_frame = map_frame
        self._GoalStatus = GoalStatus
        self._NavigateToPose = NavigateToPose
        self._ActionClient = ActionClient
        name = (action_name or "navigate_to_pose").strip() or "navigate_to_pose"
        self._action_name = name if name.startswith("/") else f"/{name}"
        self._client = ActionClient(node, NavigateToPose, self._action_name)
        self._goal_handle = None
        self._status_by_goal: dict[bytes, int] = {}
        self._status_stamp_by_goal: dict[bytes, int] = {}
        self._last_cmd = Twist()
        self._cmd_lock = threading.Lock()
        self._cmd_subscription = node.create_subscription(Twist, cmd_vel_topic, self._on_cmd, 10)
        status_qos = QoSProfile(depth=10)
        status_qos.reliability = ReliabilityPolicy.RELIABLE
        status_qos.durability = DurabilityPolicy.TRANSIENT_LOCAL
        self._status_subscription = node.create_subscription(
            GoalStatusArray,
            f"{self._action_name}/_action/status",
            self._on_status,
            status_qos,
        )
        self._node.get_logger().info(f"Nav2 backend action={self._action_name}")

    def _on_cmd(self, message) -> None:
        with self._cmd_lock:
            self._last_cmd = message

    def _on_status(self, message) -> None:
        for item in message.status_list:
            goal_key = bytes(item.goal_info.goal_id.uuid)
            status = int(item.status)
            self._status_by_goal[goal_key] = status
            stamp = item.goal_info.stamp
            self._status_stamp_by_goal[goal_key] = stamp.sec * 1_000_000_000 + stamp.nanosec
            if status in (
                self._GoalStatus.STATUS_SUCCEEDED,
                self._GoalStatus.STATUS_ABORTED,
                self._GoalStatus.STATUS_CANCELED,
            ):
                self._node.get_logger().info(
                    f"NavigateToPose terminal status uuid={goal_key.hex()} status={status}"
                )

    def _latest_status_after(self, sent_at_ns: int) -> tuple[Optional[bytes], Optional[int]]:
        candidates = [
            (stamp, goal_key, self._status_by_goal.get(goal_key))
            for goal_key, stamp in self._status_stamp_by_goal.items()
            if stamp >= sent_at_ns - 1_000_000_000
        ]
        if not candidates:
            return None, None
        _, goal_key, status = max(candidates, key=lambda item: item[0])
        return goal_key, status

    def cancel(self) -> None:
        handle = self._goal_handle
        if handle is None:
            return
        future = handle.cancel_goal_async()
        # Best-effort; scheduler will still wait for zero velocity.
        future.add_done_callback(lambda _f: None)

    def wait_zero_velocity(self, timeout_seconds: float = 5.0) -> bool:
        deadline = time.time() + timeout_seconds
        while time.time() < deadline:
            with self._cmd_lock:
                linear = abs(self._last_cmd.linear.x) + abs(self._last_cmd.linear.y)
                angular = abs(self._last_cmd.angular.z)
            if linear < 0.02 and angular < 0.05:
                return True
            time.sleep(0.1)
        return False

    def _wait_action_server(self, timeout_sec: float = 30.0) -> bool:
        deadline = time.time() + timeout_sec
        attempt = 0
        while time.time() < deadline:
            attempt += 1
            remaining = max(0.5, deadline - time.time())
            slice_timeout = min(5.0, remaining)
            if self._client.server_is_ready():
                return True
            if self._client.wait_for_server(timeout_sec=slice_timeout):
                return True
            # Recreate client once discovery looks stuck (common on Foxy + late bringup).
            if attempt in (2, 4):
                self._node.get_logger().warn(
                    f"recreating ActionClient for {self._action_name} (attempt {attempt})"
                )
                try:
                    self._client = self._ActionClient(self._node, self._NavigateToPose, self._action_name)
                except Exception as error:
                    self._node.get_logger().error(f"ActionClient recreate failed: {error}")
            time.sleep(0.2)
        return False

    def _log_action_list(self) -> None:
        try:
            import subprocess

            completed = subprocess.run(
                ["ros2", "action", "list"],
                capture_output=True,
                text=True,
                timeout=8,
                check=False,
            )
            text = (completed.stdout or completed.stderr or "").strip()
            self._node.get_logger().error(f"ros2 action list:\n{text or '(empty)'}")
        except Exception as error:
            self._node.get_logger().error(f"ros2 action list failed: {error}")

    def navigate(self, goal: Pose2D, should_cancel: Callable[[], bool]) -> bool:
        if not self._wait_action_server(timeout_sec=float(os.environ.get("NAV2_WAIT_SERVER_SEC", "30"))):
            self._node.get_logger().error(
                f"NavigateToPose action server not available ({self._action_name})"
            )
            self._log_action_list()
            return False

        request = self._NavigateToPose.Goal()
        request.pose.header.frame_id = self._map_frame
        request.pose.header.stamp = self._node.get_clock().now().to_msg()
        request.pose.pose.position.x = float(goal.x)
        request.pose.pose.position.y = float(goal.y)
        request.pose.pose.orientation.z = math.sin(goal.yaw / 2.0)
        request.pose.pose.orientation.w = math.cos(goal.yaw / 2.0)
        sent_at_ns = self._node.get_clock().now().nanoseconds

        self._node.get_logger().info(
            f"sending NavigateToPose x={goal.x:.2f} y={goal.y:.2f} yaw={goal.yaw:.2f}"
        )
        send_future = self._client.send_goal_async(request)
        while not send_future.done():
            fallback_key, fallback_status = self._latest_status_after(sent_at_ns)
            if fallback_key is not None and fallback_status == self._GoalStatus.STATUS_SUCCEEDED:
                self._node.get_logger().warning(
                    "NavigateToPose send response stalled; accepted SUCCEEDED from action status topic"
                )
                return True
            if fallback_status in (
                self._GoalStatus.STATUS_ABORTED,
                self._GoalStatus.STATUS_CANCELED,
            ):
                return False
            if should_cancel():
                return False
            time.sleep(0.05)
        self._goal_handle = send_future.result()
        if self._goal_handle is None or not self._goal_handle.accepted:
            self._node.get_logger().warning("NavigateToPose goal rejected")
            return False

        result_future = self._goal_handle.get_result_async()
        goal_key = bytes(self._goal_handle.goal_id.uuid)
        self._node.get_logger().info(f"waiting NavigateToPose result uuid={goal_key.hex()}")
        while not result_future.done():
            action_status = self._status_by_goal.get(goal_key)
            if action_status == self._GoalStatus.STATUS_SUCCEEDED:
                self._goal_handle = None
                self._node.get_logger().warning(
                    "NavigateToPose result service stalled; accepted SUCCEEDED from action status topic"
                )
                return True
            if action_status in (
                self._GoalStatus.STATUS_ABORTED,
                self._GoalStatus.STATUS_CANCELED,
            ):
                self._goal_handle = None
                return False
            if should_cancel():
                self.cancel()
                return False
            time.sleep(0.05)

        result = result_future.result()
        self._goal_handle = None
        if result is None:
            return False
        return result.status == self._GoalStatus.STATUS_SUCCEEDED


def create_nav_backend(
    mode: str,
    *,
    platform_api_url: str,
    device_credential: str,
    map_version: str,
    node=None,
    map_frame: str = "map",
    cmd_vel_topic: str = "/cmd_vel",
    travel_seconds: float = 2.0,
    action_name: Optional[str] = None,
) -> NavBackend:
    normalized = (mode or "sim").strip().lower()
    if normalized == "nav2":
        if node is None:
            raise ValueError("NAV_MODE=nav2 requires an rclpy node")
        return Nav2Backend(
            node=node,
            action_name=action_name or os.environ.get("NAV2_ACTION", "/navigate_to_pose"),
            map_frame=map_frame,
            cmd_vel_topic=cmd_vel_topic,
        )
    return SimNavBackend(
        platform_api_url=platform_api_url,
        device_credential=device_credential,
        map_version=map_version,
        travel_seconds=travel_seconds,
        publish_pose=True,
    )
