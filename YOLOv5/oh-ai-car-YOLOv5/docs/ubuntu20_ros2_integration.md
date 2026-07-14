# Ubuntu20.04 + ROS2 Foxy 集成说明

## 目标

将当前 `plate_detector + plate_recognizer` 能力接到 Ubuntu 20.04 版小车上，满足“到点停车后触发一次识别”的课题流程。

## 推荐集成方式

当前阶段不建议把识别逻辑做成持续 30 FPS 的流式识别，而是采用 **到点触发式识别**：

1. Astra RGB 相机持续发布 `/camera/color/image_raw`
2. `patrol_scheduler` 到达航点后调用一次识别服务
3. 识别节点读取最近一帧图像
4. 运行 `YOLOv5 -> OCR` 流程
5. 将结构化结果发布到 ROS2 topic，供成员 A 落库和后续白名单比对

这种模式更适合当前项目，因为：

- 巡检任务本来就是到点停车后再识别
- 不要求车在行驶过程中持续高帧率 OCR
- 便于先稳定打通调度与识别接口

## 目录

- ROS2 包：`ros2_ws/src/plate_vision_ros`
- 节点入口：`plate_vision_ros/plate_trigger_node.py`
- 启动文件：`launch/plate_trigger.launch.py`

## 运行依赖

Ubuntu 20.04 / ROS2 Foxy 推荐依赖：

- `python3.8`
- `ros-foxy-cv-bridge`
- `ros-foxy-image-transport`
- `ros-foxy-sensor-msgs`
- `ros-foxy-std-msgs`
- `ros-foxy-std-srvs`
- `opencv-python`
- `torch`
- `paddleocr`

## 最小接线关系

- 订阅图像：`/camera/color/image_raw`
- 触发服务：`/plate_recognizer/run_once`
- 发布结果：`/plate_recognizer/result_json`

结果 JSON 建议至少包含：

- `image_path`
- `bbox`
- `crop_bbox`
- `det_confidence`
- `plate_text`
- `ocr_confidence`
- `status`

## 与成员 A 的衔接建议

成员 A 的 `scheduler` 在到点停车后执行：

1. 等待停车稳定 `1~2` 秒
2. 连续触发 `3` 次 `/plate_recognizer/run_once`
3. 对 3 次结果做择优
4. 将最佳结果送入白名单比对和落库

## 当前状态

- 已提供 ROS2 Foxy 触发式识别节点骨架
- 已给出运行参数和最小 topic/service 设计
- 尚未在真实 Ubuntu20.04 小车环境完成联调

## 下一步建议

1. 在 Ubuntu 20.04 机器上先完成单图命令行推理
2. 确认 Astra 相机 RGB 话题实际名称
3. 在 ROS2 中启动 `plate_trigger_node`
4. 用手工调用服务的方式验证一次识别链路
5. 再由成员 A 接入 `scheduler`
