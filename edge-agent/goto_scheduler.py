#!/usr/bin/env python3
"""Single-goal goto scheduler: claim platform goto goals and NavigateToPose.

Mirrors RViz 「2D Goal Pose」. Uses the same NavBackend as patrol_scheduler
(sim | nav2). Does not talk to the Web TCP gateway.

Environment: PLATFORM_API_URL, DEVICE_CREDENTIAL, NAV_MODE, MAP_VERSION,
MAP_FRAME, POLL_SECONDS, SIM_TRAVEL_SECONDS, CMD_VEL_TOPIC.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Optional

from nav_backend import Pose2D, create_nav_backend


class PlatformClient:
    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip('/')
        self.token = token

    def _request(self, method: str, path: str, body: Optional[dict] = None) -> Any:
        data = None if body is None else json.dumps(body).encode()
        request = urllib.request.Request(
            f"{self.base_url}{path}",
            data=data,
            headers={
                "content-type": "application/json",
                "authorization": f"Bearer {self.token}",
            },
            method=method,
        )
        with urllib.request.urlopen(request, timeout=15) as response:
            raw = response.read().decode()
            return json.loads(raw) if raw else {}

    def claim_next(self) -> Optional[dict]:
        result = self._request("GET", "/device/v1/goto/next")
        return result.get("goal")

    def goal_status(self, goal_id: str) -> str:
        result = self._request("GET", f"/device/v1/goto/{goal_id}")
        goal = result.get("goal") or {}
        return str(goal.get("status") or "")

    def post_event(self, goal_id: str, payload: dict) -> dict:
        return self._request("POST", f"/device/v1/goto/{goal_id}/events", payload)


def log(message: str) -> None:
    print(message, flush=True)


class GotoScheduler:
    def __init__(self) -> None:
        self.api = PlatformClient(os.environ["PLATFORM_API_URL"], os.environ["DEVICE_CREDENTIAL"])
        self.nav_mode = os.environ.get("NAV_MODE", "sim").strip().lower()
        self.map_version = os.environ.get("MAP_VERSION", "floor-map-v1")
        self.map_frame = os.environ.get("MAP_FRAME", "map")
        self.poll_seconds = float(os.environ.get("POLL_SECONDS", "1.5"))
        self.cmd_vel_topic = os.environ.get("CMD_VEL_TOPIC", "/cmd_vel")
        self.travel_seconds = float(os.environ.get("SIM_TRAVEL_SECONDS", "3"))
        self._node = None
        self._ros_executor = None
        self.nav = self._build_nav()

    def _build_nav(self):
        if self.nav_mode == "nav2":
            import threading
            import rclpy
            from rclpy.executors import SingleThreadedExecutor
            from rclpy.node import Node

            if not rclpy.ok():
                rclpy.init()
            self._node = Node("oh_ai_car_goto_scheduler")
            self._ros_executor = SingleThreadedExecutor()
            self._ros_executor.add_node(self._node)

            def spin() -> None:
                while rclpy.ok():
                    self._ros_executor.spin_once(timeout_sec=0.05)

            threading.Thread(target=spin, daemon=True).start()
            # Give DDS discovery a moment before ActionClient attaches.
            time.sleep(2.0)

        return create_nav_backend(
            self.nav_mode,
            platform_api_url=os.environ["PLATFORM_API_URL"],
            device_credential=os.environ["DEVICE_CREDENTIAL"],
            map_version=self.map_version,
            node=self._node,
            map_frame=self.map_frame,
            cmd_vel_topic=self.cmd_vel_topic,
            travel_seconds=self.travel_seconds,
            action_name=os.environ.get("NAV2_ACTION", "/navigate_to_pose"),
        )

    def _should_cancel(self, goal_id: str) -> bool:
        try:
            status = self.api.goal_status(goal_id)
            return status in ("cancellation_requested", "cancelled", "arrived", "failed")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError):
            return False

    def run_once(self) -> bool:
        goal = self.api.claim_next()
        if not goal:
            return False
        goal_id = str(goal["id"])
        target = Pose2D(float(goal["x"]), float(goal["y"]), float(goal.get("yaw") or 0.0))
        log(f"claimed goto {goal_id} -> ({target.x:.2f}, {target.y:.2f})")
        try:
            ok = self.nav.navigate(target, lambda: self._should_cancel(goal_id))
            if not ok or self._should_cancel(goal_id):
                self.nav.cancel()
                status = self.api.goal_status(goal_id)
                if status in ("cancellation_requested", "navigating"):
                    self.nav.wait_zero_velocity(timeout_seconds=8.0)
                    self.api.post_event(goal_id, {"type": "stop_confirmed", "zeroVelocity": True})
                    log(f"goto cancelled {goal_id}")
                return True
            self.api.post_event(goal_id, {"type": "arrived"})
            log(f"arrived {goal_id}")
        except Exception as error:
            log(f"goto failed: {error}")
            try:
                self.api.post_event(goal_id, {"type": "failed", "reason": str(error)})
            except Exception:
                pass
        return True

    def loop(self) -> None:
        log(f"goto_scheduler mode={self.nav_mode} poll={self.poll_seconds}s")
        while True:
            try:
                if not self.run_once():
                    time.sleep(self.poll_seconds)
            except Exception as error:
                log(f"poll error: {error}")
                time.sleep(self.poll_seconds)


def main() -> int:
    if "PLATFORM_API_URL" not in os.environ or "DEVICE_CREDENTIAL" not in os.environ:
        print("PLATFORM_API_URL and DEVICE_CREDENTIAL are required", file=sys.stderr)
        return 1
    GotoScheduler().loop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
