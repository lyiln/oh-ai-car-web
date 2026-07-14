# bdd100k_vehicle_training.md

## 目标

把当前“先检测车，再识别车牌”的车辆门控，从 `COCO` 通用预训练权重推进到 **BDD100K 大型车辆数据集训练**。

当前主线选择：

- 主数据集：`BDD100K`
- 当前训练类别：`car / bus / truck`
- 当前训练框架：仓库内已有的 `YOLOv5 train.py`

## 为什么先选 BDD100K

相比当前的小样本评估集，BDD100K 更适合作为正式训练主集：

- 数据量更大
- 场景更多
- 白天、夜晚、天气和道路类型更多样
- 比单纯的裁剪负样本更接近真实部署画面

当前不把 `UA-DETRAC` 作为主线，只是因为：

- 它更偏固定监控视角
- 适合后面如果你的摄像头视角更像“路口监控”时再切换

## 推荐下载内容

下载 BDD100K 时，只需要先拿目标检测相关部分：

1. `100K Images`
2. `Detection 2020 Labels`

下载后目标目录建议整理成：

```text
member_d_plate_detection/
└─ datasets/
   └─ bdd100k/
      ├─ images/
      │  └─ 100k/
      │     ├─ train/
      │     └─ val/
      └─ labels/
         └─ det_20/
            ├─ det_train.json
            └─ det_val.json
```

脚本也兼容旧一些的标注命名方式：

- `labels/bdd100k_labels_images_train.json`
- `labels/bdd100k_labels_images_val.json`

## 这次已加到仓库里的文件

### 数据转换

- `scripts/bdd100k_to_yolo_vehicle.py`

作用：

- 读取 BDD100K 的检测 JSON
- 只保留 `car / bus / truck`
- 在原数据根目录下生成 YOLO 标签
- 输出转换摘要 JSON

生成后的标签目录会是：

```text
datasets/bdd100k/
└─ labels/
   └─ 100k/
      ├─ train/
      └─ val/
```

这样可以直接配合 YOLOv5 的目录约定使用，不需要再复制一遍图片。

### 训练配置

- `configs/car_bdd100k_vehicle.yaml`

当前类别配置：

- `0 = car`
- `1 = bus`
- `2 = truck`

### PowerShell 入口

- `scripts/powershell/prepare_bdd100k_vehicle.ps1`
- `scripts/powershell/train_car_detector_bdd100k.ps1`

## 建议执行顺序

### 第一步：准备数据

先把 BDD100K 数据放到：

```text
C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\datasets\bdd100k
```

### 第二步：生成 YOLO 标签

```powershell
& "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\scripts\powershell\prepare_bdd100k_vehicle.ps1"
```

如果你只想先做小规模冒烟测试：

```powershell
& "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\scripts\powershell\prepare_bdd100k_vehicle.ps1" -MaxImagesPerSplit 200
```

### 第三步：开始训练车辆检测器

```powershell
& "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\scripts\powershell\train_car_detector_bdd100k.ps1"
```

## 当前推荐训练参数

第一轮先用这组参数：

- 权重：`weights/yolov5s.pt`
- 图片尺寸：`640`
- batch：`8`
- epochs：`50`
- workers：`2`
- run name：`car_bdd100k_vehicle_v1`

## 训练完成后如何接回当前流程

训练完成后，你最终会得到类似：

```text
runs/train/car_bdd100k_vehicle_v1/weights/best.pt
```

下一步只要把这个权重替换进：

- `scripts/car_detector.py`
- `scripts/car_plate_pipeline.py`
- `scripts/powershell/run_car_plate_pipeline.ps1`

里的 `--car-weights` 参数即可。

注意：

- 如果你接回的是 `BDD100K` 训练出来的自定义车辆权重，类别编号不再是 `COCO` 的 `2 / 5 / 7`
- 当前这套配置使用的是：
  - `--car-classes 0 1 2`
  - `--car-class-names car bus truck`

## 当前阶段最务实的推进建议

建议你按下面这个节奏做：

1. 先下载 BDD100K
2. 先跑一次 `-MaxImagesPerSplit 200` 的小规模转换检查
3. 确认标签目录正常生成
4. 再跑全量转换
5. 再启动正式训练

这样能减少大数据集第一次接入时的排错成本。
