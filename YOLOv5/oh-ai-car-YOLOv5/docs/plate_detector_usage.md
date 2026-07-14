# plate_detector_usage.md

## 功能

`scripts/plate_detector.py` 用于封装 YOLOv5 图片检测流程，支持：

- 单张图片检测
- 文件夹批量检测
- 保存结果图
- 导出 `bbox` 和 `confidence`
- 导出 `json`
- 可选导出 `csv`

## 单张图片示例

```powershell
python "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\scripts\plate_detector.py" --yolov5-dir "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\yolov5" --weights "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\weights\best_plate_detector.pt" --source "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\demo_input\test.jpg" --project "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\demo_output" --name "single_demo" --save-csv
```

## 文件夹示例

```powershell
python "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\scripts\plate_detector.py" --yolov5-dir "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\yolov5" --weights "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\weights\best_plate_detector.pt" --source "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\demo_input" --project "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\demo_output" --name "batch_demo" --save-csv
```

## 推荐 PowerShell 入口

```powershell
& "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\scripts\powershell\run_plate_detector.ps1"
```

## 输出文件

以 `demo_output\batch_demo` 为例：

- 检测结果图：YOLOv5 自动保存
- 标签文本：`labels\*.txt`
- JSON 结果：`detections.json`
- CSV 结果：`detections.csv`
