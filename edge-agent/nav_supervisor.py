#!/usr/bin/env python3
"""Nav readiness supervisor for Web one-click prepare + initial pose.

On prepare_requested from the platform:
  1) Optionally run NAV_BRINGUP_CMD once (user-configured Nav2/yahboom launches).
  2) Ensure pose_agent + goto_scheduler child processes are running.
  3) Publish pending Web initial poses to /initialpose (RViz 2D Pose Estimate equivalent).
  4) Heartbeat readiness to POST /device/v1/nav/status.

If NAV_BRINGUP_CMD is empty, bringup_ok stays false unless NAV_ASSUME_BRINGUP=true
(or NAV_MODE=sim). Web will show checklist — that is the intentional B fallback.

Environment:
  PLATFORM_API_URL, DEVICE_CREDENTIAL  required
  NAV_MODE              sim | nav2 (default nav2)
  MAP_VERSION           default floor-map-v1
  NAV_BRINGUP_CMD       optional shell command to start laser/nav launches
  NAV_ASSUME_BRINGUP    true = treat Nav2 as already started by operator
  POLL_SECONDS          default 2
  EDGE_AGENT_DIR        directory containing pose_agent.py / goto_scheduler.py
  PYTHON_BIN            default sys.executable
  INITIAL_POSE_TOPIC    default /initialpose
  NAV2_ACTION           default navigate_to_pose
"""
from __future__ import annotations

import json
import math
import os
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Optional


def log(message: str) -> None:
    print(message, flush=True)


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

    def get_state(self) -> dict:
        return self._request("GET", "/device/v1/nav/state")

    def post_status(self, payload: dict) -> dict:
        return self._request("POST", "/device/v1/nav/status", payload)


class ChildProc:
    def __init__(self, name: str, args: list[str], env: dict[str, str], log_dir: Optional[Path] = None) -> None:
        self.name = name
        self.args = args
        self.env = env
        self.log_dir = log_dir
        self.proc: Optional[subprocess.Popen] = None
        self._seen_alive_at = 0.0

    def ensure(self) -> bool:
        if self.proc and self.proc.poll() is None:
            self._seen_alive_at = time.time()
            return True
        log(f"starting {self.name}: {' '.join(self.args)}")
        stdout = subprocess.DEVNULL
        if self.log_dir is not None:
            self.log_dir.mkdir(parents=True, exist_ok=True)
            stdout = open(self.log_dir / f"{self.name}.log", "ab")
        self.proc = subprocess.Popen(
            self.args,
            env=self.env,
            stdout=stdout,
            stderr=subprocess.STDOUT,
        )
        time.sleep(0.5)
        alive = self.proc.poll() is None
        if alive:
            self._seen_alive_at = time.time()
        return alive

    def alive(self, grace_seconds: float = 8.0) -> bool:
        if self.proc and self.proc.poll() is None:
            self._seen_alive_at = time.time()
            return True
        # Brief restart grace so Web ready does not flicker while child respawns.
        return bool(self._seen_alive_at and time.time() - self._seen_alive_at < grace_seconds)

    def stop(self) -> None:
        if not self.proc or self.proc.poll() is not None:
            return
        self.proc.send_signal(signal.SIGTERM)
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()


class InitialPosePublisher:
    """Publish geometry_msgs/PoseWithCovarianceStamped on /initialpose."""

    def __init__(self, topic: str) -> None:
        self.topic = topic
        self._node = None
        self._pub = None
        self._ok = False
        try:
            import rclpy
            from geometry_msgs.msg import PoseWithCovarianceStamped
            from rclpy.node import Node

            if not rclpy.ok():
                rclpy.init()
            self._PoseWithCovarianceStamped = PoseWithCovarianceStamped
            self._node = Node("oh_ai_car_initial_pose")
            self._pub = self._node.create_publisher(PoseWithCovarianceStamped, topic, 10)
            self._executor_stop = threading.Event()

            def spin() -> None:
                while not self._executor_stop.is_set() and rclpy.ok():
                    rclpy.spin_once(self._node, timeout_sec=0.1)

            threading.Thread(target=spin, daemon=True).start()
            self._ok = True
            log(f"initial pose publisher on {topic}")
        except Exception as error:
            log(f"initial pose publisher unavailable: {error}")

    @property
    def ok(self) -> bool:
        return self._ok

    def publish(self, x: float, y: float, yaw: float) -> bool:
        if not self._ok or self._pub is None or self._node is None:
            return False
        # Burst a few times like a careful RViz click: AMCL can miss a single message
        # when discovery/QoS is still settling after bringup.
        for index in range(3):
            msg = self._PoseWithCovarianceStamped()
            msg.header.stamp = self._node.get_clock().now().to_msg()
            msg.header.frame_id = "map"
            msg.pose.pose.position.x = float(x)
            msg.pose.pose.position.y = float(y)
            msg.pose.pose.orientation.z = math.sin(yaw / 2.0)
            msg.pose.pose.orientation.w = math.cos(yaw / 2.0)
            # Match common RViz 2D Pose Estimate covariance.
            msg.pose.covariance[0] = 0.25
            msg.pose.covariance[7] = 0.25
            msg.pose.covariance[35] = 0.06853891945200942
            self._pub.publish(msg)
            if index < 2:
                time.sleep(0.05)
        log(f"published /initialpose x={x:.2f} y={y:.2f} yaw={yaw:.2f} (x3)")
        return True


class Nav2ActionProbe:
    """Keep one ActionClient and require a real action server.

    `ros2 action list` also lists client-only actions, so it produced a false
    positive while bt_navigator was unconfigured and the server count was zero.
    """

    def __init__(self, action_name: str) -> None:
        normalized = action_name.strip() or "navigate_to_pose"
        self.action_name = normalized if normalized.startswith("/") else f"/{normalized}"
        self._node = None
        self._client = None
        self._last_ready: Optional[bool] = None
        self._last_log = 0.0

    def ready(self) -> bool:
        if not self._ensure_client() or self._client is None:
            return False
        try:
            ready = bool(
                self._client.server_is_ready()
                or self._client.wait_for_server(timeout_sec=1.5)
            )
        except Exception as error:
            ready = False
            if time.time() - self._last_log > 30:
                log(f"nav2 action probe failed: {error}")
                self._last_log = time.time()
        if ready != self._last_ready:
            log(
                f"nav2 action server {self.action_name}: "
                f"{'ready' if ready else 'not ready'}"
            )
            self._last_ready = ready
        return ready

    def _ensure_client(self) -> bool:
        if self._client is not None:
            return True
        try:
            import rclpy
            from nav2_msgs.action import NavigateToPose
            from rclpy.action import ActionClient
            from rclpy.node import Node

            if not rclpy.ok():
                rclpy.init()
            self._node = Node("oh_ai_car_nav2_probe")
            self._client = ActionClient(
                self._node,
                NavigateToPose,
                self.action_name,
            )
            return True
        except Exception as error:
            if time.time() - self._last_log > 30:
                log(f"nav2 ActionClient init failed: {error}")
                self._last_log = time.time()
            self._node = None
            self._client = None
            return False


class NavSupervisor:
    def __init__(self) -> None:
        self.api = PlatformClient(os.environ["PLATFORM_API_URL"], os.environ["DEVICE_CREDENTIAL"])
        self.nav_mode = os.environ.get("NAV_MODE", "nav2").strip().lower()
        self.poll_seconds = float(os.environ.get("POLL_SECONDS", "2"))
        self.bringup_cmd = os.environ.get("NAV_BRINGUP_CMD", "").strip()
        self.assume_bringup = os.environ.get("NAV_ASSUME_BRINGUP", "").lower() in ("1", "true", "yes")
        self.edge_dir = Path(os.environ.get("EDGE_AGENT_DIR", Path(__file__).resolve().parent))
        self.python_bin = os.environ.get("PYTHON_BIN", sys.executable)
        self.action_name = os.environ.get("NAV2_ACTION", "navigate_to_pose")
        self.nav2_probe = Nav2ActionProbe(self.action_name)
        self.child_env = os.environ.copy()
        log_dir = self.edge_dir / "logs"
        self.pose_child = ChildProc(
            "pose_agent",
            [self.python_bin, str(self.edge_dir / "pose_agent.py")],
            self.child_env,
            log_dir=log_dir,
        )
        self.goto_child = ChildProc(
            "goto_scheduler",
            [self.python_bin, str(self.edge_dir / "goto_scheduler.py")],
            self.child_env,
            log_dir=log_dir,
        )
        self.bringup_proc: Optional[subprocess.Popen] = None
        self.bringup_started = False
        self.pose_pub = InitialPosePublisher(os.environ.get("INITIAL_POSE_TOPIC", "/initialpose"))
        self.last_consumed_seq = 0

    def _run_bringup_once(self) -> tuple[bool, str]:
        if self.nav_mode == "sim" or self.assume_bringup:
            return True, "bringup assumed (sim or NAV_ASSUME_BRINGUP)"
        if not self.bringup_cmd:
            return False, "NAV_BRINGUP_CMD unset; start Nav2 manually or set the command"
        if self.bringup_started and self.bringup_proc and self.bringup_proc.poll() is None:
            return True, "bringup command still running"
        if self.bringup_started:
            # Already attempted; do not restart loops forever.
            alive = self.bringup_proc is not None and self.bringup_proc.poll() is None
            return alive, "bringup previously started" if alive else "bringup process exited"
        log(f"running NAV_BRINGUP_CMD: {self.bringup_cmd}")
        try:
            self.bringup_proc = subprocess.Popen(
                self.bringup_cmd,
                shell=True,
                env=self.child_env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.STDOUT,
            )
            self.bringup_started = True
            time.sleep(2.0)
            if self.bringup_proc.poll() is not None:
                return False, f"bringup exited early code={self.bringup_proc.returncode}"
            return True, "bringup command started"
        except Exception as error:
            return False, f"bringup failed: {error}"

    def _handle_initial_pose(self, state: dict) -> Optional[int]:
        pose = state.get("initialPose")
        if not pose:
            return None
        seq = int(pose.get("seq") or 0)
        if seq <= self.last_consumed_seq:
            return self.last_consumed_seq
        ok = self.pose_pub.publish(float(pose["x"]), float(pose["y"]), float(pose.get("yaw") or 0.0))
        if ok:
            self.last_consumed_seq = seq
            return seq
        return None

    def tick(self) -> None:
        state = self.api.get_state()
        prepare = bool(state.get("prepareRequested"))
        detail_parts: list[str] = []

        bringup_ok = False
        nav2_ok = False
        if prepare:
            bringup_ok, bringup_detail = self._run_bringup_once()
            detail_parts.append(bringup_detail)
            self.pose_child.ensure()
            self.goto_child.ensure()
        else:
            detail_parts.append("waiting for Web prepare")

        pose_ok = self.pose_child.alive() if self.nav_mode != "sim" else self.pose_child.alive() or prepare
        # In sim, goto_scheduler alone is enough for motion+pose; still start both when prepare.
        if self.nav_mode == "sim":
            if prepare:
                self.goto_child.ensure()
                # pose_agent needs ROS; for sim prefer goto_scheduler pose publishing
                pose_ok = True
                bringup_ok = True
                nav2_ok = False
            goto_ok = self.goto_child.alive() if prepare else False
        else:
            goto_ok = self.goto_child.alive()
            if bringup_ok or self.assume_bringup:
                nav2_ok = self.nav2_probe.ready()
                if not nav2_ok:
                    detail_parts.append(f"NavigateToPose '{self.action_name}' not ready yet")
            if self.assume_bringup and not bringup_ok:
                bringup_ok = True

        consumed = self._handle_initial_pose(state)
        if state.get("initialPose") and consumed is None and self.nav_mode != "sim":
            detail_parts.append("initial pose pending but /initialpose publish failed (is ROS up?)")

        if self.nav_mode == "sim":
            ready_hint = "sim bridges"
        elif nav2_ok:
            ready_hint = "nav2 action ready"
        else:
            ready_hint = "nav2 not ready"

        detail_parts.append(ready_hint)
        payload = {
            "poseOk": bool(pose_ok) if self.nav_mode != "sim" else True,
            "gotoOk": bool(goto_ok),
            "nav2Ok": bool(nav2_ok),
            "bringupOk": bool(bringup_ok),
            "navMode": self.nav_mode,
            "detail": "; ".join(detail_parts)[:500],
        }
        if consumed is not None:
            payload["consumedInitialPoseSeq"] = consumed
        # For sim, mark bringupOk so Web ready = poseOk && gotoOk && bringupOk
        if self.nav_mode == "sim":
            payload["poseOk"] = True
            payload["bringupOk"] = True
            payload["nav2Ok"] = False

        self.api.post_status(payload)

    def loop(self) -> None:
        log(f"nav_supervisor mode={self.nav_mode} bringup_cmd={'set' if self.bringup_cmd else 'unset'}")
        try:
            while True:
                try:
                    self.tick()
                except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError, json.JSONDecodeError) as error:
                    log(f"nav_supervisor poll error: {error}")
                except Exception as error:
                    log(f"nav_supervisor error: {error}")
                time.sleep(self.poll_seconds)
        finally:
            log("stopping edge-agent children")
            self.goto_child.stop()
            self.pose_child.stop()


def main() -> int:
    if "PLATFORM_API_URL" not in os.environ or "DEVICE_CREDENTIAL" not in os.environ:
        print("PLATFORM_API_URL and DEVICE_CREDENTIAL are required", file=sys.stderr)
        return 1
    NavSupervisor().loop()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
