# member_d_plate_detection

基于 `ultralytics/yolov5` 的车牌检测与车辆门控工程。

## 当前范围

- 已支持“先检测车辆，再识别车牌”的两阶段流程
- 车牌检测训练主集：`CCPD`
- 车辆检测大型训练主集：`BDD100K`
- 当前以离线图片检测为主，已提供 ROS2 接入基础

## 目录结构

```text
member_d_plate_detection/
├─ configs/
│  ├─ plate_ccpd.yaml
│  └─ car_bdd100k_vehicle.yaml
├─ datasets/
├─ demo_input/
├─ demo_output/
├─ docs/
├─ runs/
├─ scripts/
│  ├─ ccpd_to_yolo.py
│  ├─ bdd100k_to_yolo_vehicle.py
│  ├─ car_detector.py
│  ├─ car_plate_pipeline.py
│  ├─ plate_detector.py
│  └─ powershell/
│     ├─ prepare_ccpd_small.ps1
│     ├─ prepare_bdd100k_vehicle.ps1
│     ├─ run_plate_detector.ps1
│     ├─ run_car_plate_pipeline.ps1
│     ├─ setup_vision_env.ps1
│     ├─ train_plate_detector.ps1
│     └─ train_car_detector_bdd100k.ps1
└─ weights/
```

## 第一阶段建议执行顺序

1. 创建并激活 `vision_env`
2. 克隆 `ultralytics/yolov5`
3. 安装依赖并验证 `python detect.py --help`
4. 下载 `CCPD2019`，第一轮只用 `CCPD-Base`
5. 用 `scripts/ccpd_to_yolo.py` 抽样并生成 YOLO 标签
6. 使用 `configs/plate_ccpd.yaml` 跑第一次训练
7. 用 `scripts/plate_detector.py` 跑验证图并导出结果
8. 下载 `BDD100K`
9. 用 `scripts/bdd100k_to_yolo_vehicle.py` 生成车辆 YOLO 标签
10. 使用 `configs/car_bdd100k_vehicle.yaml` 训练车辆检测器
11. 用 `scripts/car_plate_pipeline.py` 联调“先车后牌”流程

## Windows 推荐入口

- 环境搭建：`scripts/powershell/setup_vision_env.ps1`
- 小样本数据准备：`scripts/powershell/prepare_ccpd_small.ps1`
- 大型车辆数据准备：`scripts/powershell/prepare_bdd100k_vehicle.ps1`
- 启动训练：`scripts/powershell/train_plate_detector.ps1`
- 车辆训练：`scripts/powershell/train_car_detector_bdd100k.ps1`
- 离线检测：`scripts/powershell/run_plate_detector.ps1`
- 两阶段联调：`scripts/powershell/run_car_plate_pipeline.ps1`

## 下载参考

- 仓库与数据入口整理见：`docs/download_reference.md`

## 当前交付物

- 数据转换脚本：`scripts/ccpd_to_yolo.py`
- BDD100K 转换脚本：`scripts/bdd100k_to_yolo_vehicle.py`
- 检测封装脚本：`scripts/plate_detector.py`
- 车辆检测封装脚本：`scripts/car_detector.py`
- 两阶段总控脚本：`scripts/car_plate_pipeline.py`
- PowerShell 启动脚本：`scripts/powershell/`
- 数据配置：`configs/plate_ccpd.yaml`
- 车辆数据配置：`configs/car_bdd100k_vehicle.yaml`
- 文档模板：`docs/`
