#!/usr/bin/env python3
"""
ROS2 Foxy node that triggers one-shot plate detection and OCR on the latest RGB frame.
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Optional

import cv2
import rclpy
from cv_bridge import CvBridge
from rclpy.node import Node
from sensor_msgs.msg import Image
from std_msgs.msg import String
from std_srvs.srv import Trigger


class PlateTriggerNode(Node):
    def __init__(self) -> None:
        super().__init__("plate_trigger_node")
        self.bridge = CvBridge()
        self.latest_frame = None
        self.latest_frame_stamp = None

        self.declare_parameter("image_topic", "/camera/color/image_raw")
        self.declare_parameter("result_topic", "/plate_recognizer/result_json")
        self.declare_parameter("service_name", "/plate_recognizer/run_once")
        self.declare_parameter("python_executable", sys.executable)
        self.declare_parameter("project_root", "/home/ubuntu/member_d_plate_detection")
        self.declare_parameter("pipeline_script", "")
        self.declare_parameter("yolov5_dir", "")
        self.declare_parameter("weights", "")
        self.declare_parameter("output_root", "")
        self.declare_parameter("device", "cpu")
        self.declare_parameter("imgsz", 640)
        self.declare_parameter("conf_thres", 0.25)
        self.declare_parameter("iou_thres", 0.45)
        self.declare_parameter("ocr_min_score", 0.75)

        image_topic = self.get_parameter("image_topic").value
        result_topic = self.get_parameter("result_topic").value
        service_name = self.get_parameter("service_name").value

        self.result_pub = self.create_publisher(String, result_topic, 10)
        self.image_sub = self.create_subscription(Image, image_topic, self.image_callback, 10)
        self.trigger_srv = self.create_service(Trigger, service_name, self.handle_trigger)

        self.get_logger().info("plate_trigger_node is ready")
        self.get_logger().info("image_topic: %s" % image_topic)
        self.get_logger().info("result_topic: %s" % result_topic)
        self.get_logger().info("service_name: %s" % service_name)

    def image_callback(self, msg: Image) -> None:
        try:
            self.latest_frame = self.bridge.imgmsg_to_cv2(msg, desired_encoding="bgr8")
            self.latest_frame_stamp = msg.header.stamp
        except Exception as exc:  # noqa: BLE001
            self.get_logger().error("Failed to convert image: %s" % exc)

    def handle_trigger(self, request: Trigger.Request, response: Trigger.Response) -> Trigger.Response:
        del request
        if self.latest_frame is None:
            response.success = False
            response.message = "No RGB frame received yet."
            return response

        try:
            payload = self.run_pipeline_once(self.latest_frame)
            msg = String()
            msg.data = json.dumps(payload, ensure_ascii=False)
            self.result_pub.publish(msg)
            response.success = True
            response.message = payload.get("summary", "plate recognition completed")
        except Exception as exc:  # noqa: BLE001
            response.success = False
            response.message = str(exc)
            self.get_logger().error("Recognition failed: %s" % exc)
        return response

    def run_pipeline_once(self, frame) -> dict:
        project_root = Path(self.get_parameter("project_root").value)
        pipeline_script = Path(self.get_parameter("pipeline_script").value or (project_root / "scripts" / "plate_pipeline.py"))
        yolov5_dir = Path(self.get_parameter("yolov5_dir").value or (project_root / "yolov5"))
        weights = Path(self.get_parameter("weights").value or (project_root / "weights" / "best_plate_detector.pt"))
        output_root = Path(self.get_parameter("output_root").value or (project_root / "ros2_runtime"))
        python_executable = self.get_parameter("python_executable").value

        output_root.mkdir(parents=True, exist_ok=True)
        input_dir = output_root / "input_cache"
        input_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
        image_path = input_dir / ("capture_%s.jpg" % timestamp)
        cv2.imwrite(str(image_path), frame)

        run_name = "trigger_%s" % timestamp
        command = [
            python_executable,
            str(pipeline_script),
            "--yolov5-dir",
            str(yolov5_dir),
            "--weights",
            str(weights),
            "--source",
            str(image_path),
            "--project",
            str(output_root),
            "--name",
            run_name,
            "--imgsz",
            str(self.get_parameter("imgsz").value),
            "--conf-thres",
            str(self.get_parameter("conf_thres").value),
            "--iou-thres",
            str(self.get_parameter("iou_thres").value),
            "--ocr-min-score",
            str(self.get_parameter("ocr_min_score").value),
            "--device",
            str(self.get_parameter("device").value),
            "--save-csv",
        ]

        self.get_logger().info("Running pipeline on cached frame: %s" % image_path)
        subprocess.run(command, check=True)

        result_json = output_root / run_name / "pipeline_results.json"
        if not result_json.exists():
            raise FileNotFoundError("Pipeline result json not found: %s" % result_json)

        results = json.loads(result_json.read_text(encoding="utf-8"))
        best_result = self.pick_best_result(results)
        payload = {
            "image_path": str(image_path),
            "result_json": str(result_json),
            "detection_count": len(results),
            "best_result": best_result,
            "summary": self.build_summary(best_result),
        }
        return payload

    @staticmethod
    def pick_best_result(results: list) -> Optional[dict]:
        if not results:
            return None
        return max(
            results,
            key=lambda item: (
                int(item.get("status") == "ready_for_whitelist_compare"),
                float(item.get("ocr_confidence", 0.0)),
                float(item.get("det_confidence", 0.0)),
            ),
        )

    @staticmethod
    def build_summary(best_result: Optional[dict]) -> str:
        if not best_result:
            return "No plate detected."
        return "plate=%s, status=%s, ocr_conf=%.3f" % (
            best_result.get("plate_text", ""),
            best_result.get("status", "unknown"),
            float(best_result.get("ocr_confidence", 0.0)),
        )


def main(args=None) -> None:
    rclpy.init(args=args)
    node = PlateTriggerNode()
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == "__main__":
    main()
