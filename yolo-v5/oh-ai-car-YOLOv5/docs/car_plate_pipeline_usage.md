# car_plate_pipeline_usage.md

## 功能

`scripts/car_plate_pipeline.py` 用于执行两阶段流程：

1. 先做车辆检测
2. 只有检测到车的图片才进入车牌检测与 OCR
3. 最终输出整合后的 `car_plate_results.json`

## 推荐权重组合

### 当前默认联调组合

- 车辆检测权重：`weights\yolov5s.pt`
- 车牌检测权重：`weights\best_plate_detector.pt`
- 车辆类别：`2=car, 5=bus, 7=truck`

说明：

- `yolov5s.pt` 仍然是当前更稳的默认门控选择
- 在当前混合小评估集上，它的优化后结果仍优于刚训练出的 `BDD100K mini` 首轮权重
- 当前小型混合评估集上，车辆门控推荐参数为：
  - `--imgsz 640`
  - `--car-conf-thres 0.15`

### 已接通的 BDD100K mini 联调组合

- 车辆检测权重：`weights\car_bdd100k_mini_v1_best.pt`
- 车辆类别：`0=car, 1=bus, 2=truck`

说明：

- 这套组合已经验证过可以正常接入“先车后牌”流程
- 但它当前更适合作为继续训练的中间版本，不建议直接替换默认稳定入口

## 单次运行示例

```powershell
python "c:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\scripts\car_plate_pipeline.py" --yolov5-dir "c:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\yolov5" --car-weights "c:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\weights\yolov5s.pt" --plate-weights "c:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\weights\best_plate_detector.pt" --source "c:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\demo_input\first_batch" --project "c:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\demo_output" --name "car_plate_demo" --car-classes 2 5 7 --car-class-names car bus truck --device cpu --save-csv
```

## 推荐 PowerShell 入口

```powershell
& "c:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\scripts\powershell\run_car_plate_pipeline.ps1"
```

## 输出文件

以 `demo_output\car_plate_demo` 为例：

- 车辆检测结果目录：`car_detector\`
- 车辆检测 JSON：`car_detector\detections.json`
- 车牌检测结果目录：`plate_pipeline\`
- 车牌 OCR JSON：`plate_pipeline\pipeline_results.json`
- 总结果 JSON：`car_plate_results.json`

## 总结果字段说明

`car_plate_results.json` 里每张图都会有一条记录，核心字段包括：

- `car_detected`
- `car_detection_count`
- `plate_detected`
- `plate_detection_count`
- `best_plate_result`
- `status`

其中 `status` 目前有三种：

- `no_car_detected`
- `car_found_but_no_plate`
- `plate_found`

## 已完成的实测

当前仓库里已经做过一次真实测试：

- 输入目录：`demo_input\first_batch`
- 车辆权重：`weights\yolov5s.pt`
- 车牌权重：`weights\best_plate_detector.pt`
- 输出目录：`demo_output\car_plate_demo_test`

测试摘要：

- 总图片数：`10`
- 检测到车的图片：`6`
- 进入车牌识别并成功出结果的图片：`6`

## 混合小评估集优化结果

新增的混合评估集位置：

- `datasets\car_eval_mixed\ground_truth_has_car.csv`

组成方式：

- 正样本 `10` 张：`first_batch` 原图
- 负样本 `10` 张：`plate_crops` 裁剪图

基线参数：

- `imgsz=640`
- `car_conf_thres=0.25`

基线结果：

- Accuracy: `0.8000`
- Precision: `1.0000`
- Recall: `0.6000`
- F1: `0.7500`

优化后参数：

- `imgsz=640`
- `car_conf_thres=0.15`

优化后结果：

- Accuracy: `0.9000`
- Precision: `1.0000`
- Recall: `0.8000`
- F1: `0.8889`

## BDD100K mini 首轮联调结果

- 联调权重：`weights\car_bdd100k_mini_v1_best.pt`
- 测试输出：`demo_output\car_plate_demo_bddmini`
- `first_batch` 结果：`10` 张里车辆放行 `7` 张，车牌识别成功 `7` 张
- 混合小评估集最佳快速结果：
  - `conf_thres=0.10`
  - Accuracy: `0.8500`
  - Precision: `0.8889`
  - Recall: `0.8000`
  - F1: `0.8421`

## 下一步最建议你做的事

### 如果你现在想先演示

直接继续用：

- `yolov5s.pt` 做车辆门控
- `best_plate_detector.pt` 做车牌检测

### 如果你现在想提升稳定性

后面重点做这三件事：

1. 准备你自己的车辆数据集
2. 训练 `best_car_detector.pt`
3. 同时把车辆类别编号和类别名一起接回流程
