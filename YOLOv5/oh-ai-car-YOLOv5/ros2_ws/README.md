# ros2_ws

## 作用

这个工作区用于把当前车牌检测与 OCR 能力接入 Ubuntu 20.04 + ROS2 Foxy 小车环境。

## 当前包

- `plate_vision_ros`

## 建议构建步骤

```bash
cd /home/ubuntu/member_d_plate_detection
source /opt/ros/foxy/setup.bash
colcon build --base-paths ros2_ws/src
source install/setup.bash
```

## 启动节点

```bash
ros2 launch plate_vision_ros plate_trigger.launch.py
```

## 手工触发一次识别

```bash
ros2 service call /plate_recognizer/run_once std_srvs/srv/Trigger
```

## 查看识别结果

```bash
ros2 topic echo /plate_recognizer/result_json
```
