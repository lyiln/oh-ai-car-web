# car_detector_integration_plan.md

## 目标

在当前 `member_d_plate_detection` 工程中，新增“先检测汽车，再识别车牌”的两阶段流程：

1. `car_detector.py` 负责判断画面里是否有车
2. `car_plate_pipeline.py` 只把有车的图片送入现有 `plate_pipeline.py`
3. 保持现有车牌检测与 OCR 逻辑不拆仓库、不推翻重做

## 当前推荐方案

### 第一阶段：先跑通，不急着重新训练

先直接复用官方 YOLOv5 的通用目标检测能力，使用 COCO 预训练权重做“车辆门控”：

- 官方 YOLOv5 项目：<https://github.com/ultralytics/yolov5>
- YOLOv5 在 COCO 上提供可直接推理的预训练权重，适合先做 `car / bus / truck` 过滤

这样做的优点是：

- 不需要你现在立刻补车辆数据集
- 可以最快验证“先车后牌”流程是否合理
- 后面再把 `--car-weights` 换成你自己训练的车辆模型即可

### 第二阶段：再决定是否微调车辆模型

如果你后面发现：

- 车漏检较多
- 你的相机视角和 COCO 差异大
- 小车前方车辆比例、距离、遮挡和公开数据差别明显

那就再单独训练一个车辆检测权重，接到 `car_detector.py` 上。

## 推荐的开源项目与数据集

### 1. 首选基础工程：Ultralytics YOLOv5

- 链接：<https://github.com/ultralytics/yolov5>
- 适合作为原因：
  - 你当前仓库已经内置了一份 YOLOv5
  - `detect.py / train.py / val.py` 现成可复用
  - 可以直接使用官方预训练权重做车辆初版门控

### 2. 首选大数据集：BDD100K

- 数据集说明：<https://doc.edgefirst.ai/latest/datasets/bdd100k/>
- 官方下载入口说明页中给出规模：
  - `train 70000`
  - `val 10000`
  - `test 20000`
  - 共 `100000` 张图，`10` 个类别
- 推荐原因：
  - 场景多样，比较接近真实道路环境
  - 适合后续训练更稳的车辆检测器
  - 对 `car / bus / truck` 这类类别支持比较自然

### 3. 视角更接近监控摄像头时可选：UA-DETRAC

- 项目示例：<https://github.com/dermawanw/yolov5-ua-detrac>
- 项目说明中给出的数据集特点：
  - `100` 个视频序列
  - `140000+` 帧
  - `4` 个车辆类别：`car / bus / van / others`
- 推荐原因：
  - 更偏交通监控视角
  - 如果你的摄像头固定、面向车道，这类数据比通用道路集更贴近

### 4. 只适合小规模验证：Vehicles OpenImages

- 示例项目：<https://github.com/JDede1/vehicle-detection-using-yolov5>
- 该项目 README 给出的数据规模：
  - `627` 张图片
  - `1194` 个标注
  - 类别包括 `Car / Truck / Bus / Motorcycle / Ambulance`
- 结论：
  - 可以用来快速熟悉训练流程
  - 不建议作为你最终部署模型的主数据集，规模偏小

### 5. 联合 `car + licence` 小数据集

- 数据集示例：<https://universe.roboflow.com/socif/car-and-licence-detection-v2-yolov5-finetune>
- 页面信息：
  - `149` 张图
  - `2` 个类别：`car / licence`
- 结论：
  - 只适合做 very small demo 或标注格式参考
  - 不适合作为正式模型主训练集

## 我给你的落地建议

### 现在就做

先采用下面这条路线：

1. 用官方 YOLOv5 预训练权重做车辆门控
2. 默认检测 COCO 类别中的：
   - `2 = car`
   - `5 = bus`
   - `7 = truck`
3. 有车再调用现有车牌检测与 OCR

这是当前最稳、最快、工程改动最小的方案。

### 后面再升级

如果第一版验证通过，再分两条路选一条：

- 路线 A：继续用 COCO 预训练车辆检测，不再训练
  - 适合先把小车演示链路做通
- 路线 B：基于 BDD100K 或 UA-DETRAC 微调一个车辆检测器
  - 适合后面做答辩、部署和稳定性优化

## 这次已经落到仓库里的文件

### 新增脚本

- `scripts/car_detector.py`
  - 车辆检测包装器
  - 默认过滤 COCO 中的 `car / bus / truck`

- `scripts/car_plate_pipeline.py`
  - 两阶段总控脚本
  - 先车后牌
  - 对目录输入会只把“检测到车”的图片送去车牌流程

### 结果文件

`car_plate_pipeline.py` 会输出：

- `car_detector/detections.json`
- `plate_pipeline/pipeline_results.json`
- 顶层总结果：`car_plate_results.json`

## 你下一步最建议做什么

### 路线 1：最快验证

准备一个车辆权重给 `--car-weights`：

- 如果本地已有 `yolov5s.pt`，先直接拿来做车辆门控
- 然后跑 `car_plate_pipeline.py` 看你的现场图片是否能先筛出“有车”样本

### 路线 2：更正式

开始准备车辆训练数据：

1. 先下载 BDD100K 或 UA-DETRAC
2. 只保留你需要的车辆类别
3. 转成 YOLO 标注
4. 训练你自己的 `best_car_detector.pt`
5. 再把它接回 `car_plate_pipeline.py`

## 我对你这个项目的最终推荐

当前阶段最合适的是：

- 同一仓库维护
- 车和牌分两个检测模块
- 在总控脚本里做串联
- 先用通用车辆权重跑通，再考虑车辆专用训练

这比“直接重训一个 `car + plate` 联合模型”更稳，也更容易排错。
