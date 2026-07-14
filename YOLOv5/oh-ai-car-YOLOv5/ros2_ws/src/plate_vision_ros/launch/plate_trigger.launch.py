from launch import LaunchDescription
from launch_ros.actions import Node


def generate_launch_description():
    return LaunchDescription(
        [
            Node(
                package="plate_vision_ros",
                executable="plate_trigger_node",
                name="plate_trigger_node",
                output="screen",
                parameters=[
                    {
                        "image_topic": "/camera/color/image_raw",
                        "result_topic": "/plate_recognizer/result_json",
                        "service_name": "/plate_recognizer/run_once",
                        "project_root": "/home/ubuntu/member_d_plate_detection",
                        "pipeline_script": "/home/ubuntu/member_d_plate_detection/scripts/plate_pipeline.py",
                        "yolov5_dir": "/home/ubuntu/member_d_plate_detection/yolov5",
                        "weights": "/home/ubuntu/member_d_plate_detection/weights/best_plate_detector.pt",
                        "output_root": "/home/ubuntu/member_d_plate_detection/ros2_runtime",
                        "device": "cpu",
                        "imgsz": 640,
                        "conf_thres": 0.25,
                        "iou_thres": 0.45,
                        "ocr_min_score": 0.75,
                    }
                ],
            )
        ]
    )
