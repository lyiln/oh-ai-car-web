# member_d_plate_detection

基于 `ultralytics/yolov5` 的车牌检测与车辆门控工程。

## 当前范围

- 已支持“先检测车辆，再识别车牌”的两阶段流程
- 车牌检测训练主集：`CCPD`
- 已提供本地 Web 测试台，支持图片、视频和实时摄像头输入
- 已提供 ROS2 接入基础

## 最新功能变化

- 视频识别新增更严格的门控策略：
  - 只有先检测到车辆的帧才进入后续阶段
  - 只有车牌框置信度、尺寸、宽高比、完整度都满足条件时才继续 OCR
  - 视频模式默认只对最有希望的 `Top 1` 车牌候选执行 OCR，减少无效耗时
- 视频结果现在只输出“车辆存在且识别出有效车牌文本”的命中帧
- 车牌文本输出新增中国大陆车牌格式白名单：
  - 普通车牌：如 `京A12345`
  - 小型新能源：如 `粤AD12345`
  - 大型新能源：如 `粤A12345D`
  - 不符合大陆车牌规则的 OCR 文本不会作为最终结果输出
- 视频识别 UI 已优化：
  - 支持原始视频预览
  - 支持抽帧策略与耗时统计展示
  - 支持命中帧列表与详情复核视图
  - 支持查看主体车 ROI 与车牌裁剪图

## 核心流程

```text
图片 / 视频帧 / 摄像头画面
        ->
车辆检测（car gate）
        ->
主体车选择与 ROI 裁剪
        ->
车牌检测
        ->
OCR（fast / full 两段式）
        ->
大陆车牌格式校验
        ->
最终输出
```

## 目录结构（核心）

```text
member_d_plate_detection/
├─ configs/
│  ├─ plate_ccpd.yaml
│  └─ plate_ccpd_base1000.yaml
├─ datasets/
├─ demo_input/
├─ demo_output/
├─ docs/
├─ runs/
├─ ros2_ws/
├─ scripts/
│  ├─ ccpd_to_yolo.py
│  ├─ car_detector.py
│  ├─ car_plate_pipeline.py
│  ├─ plate_detector.py
│  ├─ plate_recognizer.py
│  ├─ web_api_server.py
│  ├─ web_api_service.py
│  ├─ web_runtime_inference.py
│  └─ powershell/
│     ├─ prepare_ccpd_small.ps1
│     ├─ run_plate_detector.ps1
│     ├─ run_car_plate_pipeline.ps1
│     ├─ setup_vision_env.ps1
│     ├─ start_plate_test_web.ps1
│     └─ train_plate_detector.ps1
├─ web_test_app/
├─ yolov5/
└─ weights/
```

## 当前重点能力

- 离线图片识别
- 视频抽帧扫描
- 实时摄像头连续抓帧筛选
- 主体车优先识别
- 两段式 OCR 加速
- 大陆车牌格式过滤
- Web 端结果可视化与耗时对比

## Windows 推荐入口

- 环境搭建：`scripts/powershell/setup_vision_env.ps1`
- 小样本数据准备：`scripts/powershell/prepare_ccpd_small.ps1`
- 启动训练：`scripts/powershell/train_plate_detector.ps1`
- 离线检测：`scripts/powershell/run_plate_detector.ps1`
- 两阶段联调：`scripts/powershell/run_car_plate_pipeline.ps1`
- 启动 Web：`scripts/powershell/start_plate_test_web.ps1`

## Web 使用方式

PowerShell 中运行：

```powershell
& "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\scripts\powershell\start_plate_test_web.ps1"
```

默认地址：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8010`

Web 目前支持：

- 上传图片做单张识别
- 上传视频做抽帧扫描
- 浏览器实时摄像头扫描

## 默认模型

- 车辆检测：`weights/yolov5s.pt`
- 车牌检测：`runs/train/plate_ccpd_gpu_v3_continue/weights/best.pt`

## 输出说明

每次 Web 推理都会在 `demo_output/web_runtime/runs/` 下生成独立结果目录，常见内容包括：

- 上传原图 / 视频
- 车辆检测可视化图
- 主体车可视化图与 ROI
- 车牌检测图
- 车牌裁剪图
- `car_plate_results.json`
- `video_scan_results.json`

## 参考文档

- Web 使用说明：`docs/web_test_usage.md`
- 下载参考：`docs/download_reference.md`

## 当前交付物

- 数据转换脚本：`scripts/ccpd_to_yolo.py`
- 检测封装脚本：`scripts/plate_detector.py`
- 车辆检测封装脚本：`scripts/car_detector.py`
- 两阶段总控脚本：`scripts/car_plate_pipeline.py`
- OCR 与格式校验：`scripts/plate_recognizer.py`
- Web 后端：`scripts/web_api_server.py`
- 常驻推理运行时：`scripts/web_runtime_inference.py`
- Web 前端：`web_test_app/`
- PowerShell 启动脚本：`scripts/powershell/`
- 数据配置：`configs/plate_ccpd.yaml`
- 当前训练配置：`configs/plate_ccpd_base1000.yaml`
- 文档模板：`docs/`
