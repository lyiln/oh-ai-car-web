#!/usr/bin/env python3
"""Patrol task scheduler: claim platform tasks and navigate waypoint-by-waypoint.

Safety:
- Autonomous motion only through NavBackend (sim or Nav2). Never uses the Web TCP gateway.
- On cancellation_requested: cancel navigation, confirm zero velocity, post stop_confirmed.
- NAV_MODE=sim needs no ROS and is for Stage C closed-loop on a developer machine.
- NAV_MODE=nav2 requires ROS 2 + Nav2 on the vehicle; Stage D hardware gates still apply.

Environment:
  PLATFORM_API_URL     Platform base URL (required)
  DEVICE_CREDENTIAL    <id>.<secret> (required)
  NAV_MODE             sim | nav2 (default sim)
  MAP_VERSION          Expected map version label (default floor-map-v1)
  MAP_FRAME            Nav2 frame (default map)
  POLL_SECONDS         Idle poll interval (default 2)
  CMD_VEL_TOPIC        For nav2 zero-velocity sampling (default /cmd_vel)
  SIM_TRAVEL_SECONDS   Per-waypoint travel time in sim mode (default 2)
  STATE_PATH           SQLite path for in-progress task id (default patrol-scheduler-state.sqlite3)
"""
from __future__ import annotations

import json
import os
import sqlite3
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
        result = self._request("GET", "/device/v1/patrol/tasks/next")
        return result.get("task")

    def task_status(self, task_id: str) -> str:
        result = self._request("GET", f"/device/v1/patrol/tasks/{task_id}")
        task = result.get("task") or {}
        return str(task.get("status") or "")

    def post_event(self, task_id: str, payload: dict) -> dict:
        return self._request("POST", f"/device/v1/patrol/tasks/{task_id}/events", payload)


class LocalState:
    def __init__(self, path: str) -> None:
        self.connection = sqlite3.connect(path)
        self.connection.execute(
            "CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
        )
        self.connection.commit()

    def get(self, key: str) -> Optional[str]:
        row = self.connection.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
        return row[0] if row else None

    def set(self, key: str, value: str) -> None:
        self.connection.execute(
            "INSERT INTO state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
        self.connection.commit()

    def clear(self, key: str) -> None:
        self.connection.execute("DELETE FROM state WHERE key=?", (key,))
        self.connection.commit()


def log(message: str) -> None:
    print(message, flush=True)


class PatrolScheduler:
    def __init__(self) -> None:
        self.api = PlatformClient(os.environ["PLATFORM_API_URL"], os.environ["DEVICE_CREDENTIAL"])
        self.nav_mode = os.environ.get("NAV_MODE", "sim").strip().lower()
        self.map_version = os.environ.get("MAP_VERSION", "floor-map-v1")
        self.map_frame = os.environ.get("MAP_FRAME", "map")
        self.poll_seconds = float(os.environ.get("POLL_SECONDS", "2"))
        self.cmd_vel_topic = os.environ.get("CMD_VEL_TOPIC", "/cmd_vel")
        self.travel_seconds = float(os.environ.get("SIM_TRAVEL_SECONDS", "2"))
        self.state = LocalState(os.environ.get("STATE_PATH", "patrol-scheduler-state.sqlite3"))
        self._cancel_requested = False
        self._node = None
        self._ros_executor = None
        self.nav = self._build_nav()

    def _build_nav(self):
        if self.nav_mode == "nav2":
            import rclpy
            from rclpy.executors import SingleThreadedExecutor
            from rclpy.node import Node

            if not rclpy.ok():
                rclpy.init()
            self._node = Node("oh_ai_car_patrol_scheduler")
            self._ros_executor = SingleThreadedExecutor()
            self._ros_executor.add_node(self._node)

            def spin() -> None:
                while rclpy.ok():
                    self._ros_executor.spin_once(timeout_sec=0.05)

            import threading
            threading.Thread(target=spin, daemon=True).start()

        return create_nav_backend(
            self.nav_mode,
            platform_api_url=os.environ["PLATFORM_API_URL"],
            device_credential=os.environ["DEVICE_CREDENTIAL"],
            map_version=self.map_version,
            node=self._node,
            map_frame=self.map_frame,
            cmd_vel_topic=self.cmd_vel_topic,
            travel_seconds=self.travel_seconds,
        )

    def _should_cancel(self, task_id: str) -> bool:
        if self._cancel_requested:
            return True
        try:
            status = self.api.task_status(task_id)
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as error:
            log(f"status poll deferred: {error}")
            return False
        if status == "cancellation_requested":
            self._cancel_requested = True
            return True
        if status in {"stopped", "completed", "failed"}:
            self._cancel_requested = True
            return True
        return False

    def _handle_cancel(self, task_id: str) -> None:
        log(f"cancellation detected for task {task_id}; stopping navigation")
        self.nav.cancel()
        if not self.nav.wait_zero_velocity(timeout_seconds=8.0):
            log("zero-velocity wait timed out; posting stop_confirmed anyway after cancel")
        try:
            self.api.post_event(task_id, {"type": "stop_confirmed", "zeroVelocity": True})
            log(f"stop_confirmed posted for {task_id}")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
            log(f"stop_confirmed failed: {error}")
        self.state.clear("active_task_id")
        self._cancel_requested = False

    def run_task(self, task: dict) -> None:
        task_id = str(task["id"])
        waypoints = list(task.get("waypoints") or [])
        waypoints.sort(key=lambda item: int(item.get("ordinal", 0)))
        self.state.set("active_task_id", task_id)
        self._cancel_requested = False
        log(f"claimed task {task_id} with {len(waypoints)} waypoint(s)")

        try:
            for waypoint in waypoints:
                if self._should_cancel(task_id):
                    self._handle_cancel(task_id)
                    return
                goal = Pose2D(
                    x=float(waypoint["x"]),
                    y=float(waypoint["y"]),
                    yaw=float(waypoint.get("yaw") or 0.0),
                )
                name = waypoint.get("name") or waypoint.get("id")
                log(f"navigating to waypoint {name} ({goal.x:.2f}, {goal.y:.2f})")
                ok = self.nav.navigate(goal, lambda: self._should_cancel(task_id))
                if not ok or self._should_cancel(task_id):
                    self._handle_cancel(task_id)
                    return
                dwell = int(waypoint.get("dwellSeconds") or 8)
                dwell = min(10, max(8, dwell))
                deadline = time.time() + dwell
                while time.time() < deadline:
                    if self._should_cancel(task_id):
                        self._handle_cancel(task_id)
                        return
                    time.sleep(0.2)
                self.api.post_event(task_id, {"type": "waypoint", "waypointId": waypoint["id"]})
                log(f"waypoint reached: {name}")

            self.api.post_event(task_id, {"type": "status", "status": "completed"})
            log(f"task {task_id} completed")
            self.state.clear("active_task_id")
        except Exception as error:  # noqa: BLE001 - surface as failed task for platform
            log(f"task {task_id} failed: {error}")
            try:
                self.api.post_event(task_id, {"type": "status", "status": "failed", "reason": str(error)})
            except Exception as post_error:  # noqa: BLE001
                log(f"failed to post failure status: {post_error}")
            self.state.clear("active_task_id")
            self._cancel_requested = False

    def loop(self) -> None:
        log(f"patrol_scheduler started NAV_MODE={self.nav_mode} map={self.map_version}")
        while True:
            try:
                task = self.api.claim_next()
                if task:
                    self.run_task(task)
                else:
                    time.sleep(self.poll_seconds)
            except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as error:
                log(f"platform poll deferred: {error}")
                time.sleep(self.poll_seconds)


def main() -> None:
    required = ["PLATFORM_API_URL", "DEVICE_CREDENTIAL"]
    missing = [key for key in required if not os.environ.get(key)]
    if missing:
        print(f"Missing required env: {', '.join(missing)}", file=sys.stderr)
        sys.exit(1)
    scheduler = PatrolScheduler()
    try:
        scheduler.loop()
    finally:
        if scheduler._node is not None:
            scheduler._node.destroy_node()
        try:
            import rclpy
            if rclpy.ok():
                rclpy.shutdown()
        except Exception:  # noqa: BLE001
            pass


if __name__ == "__main__":
    main()
