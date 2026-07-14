# train_log.md

## 第一轮训练建议

- 模型：`yolov5n.pt`
- epochs：`20`
- batch-size：`4`
- imgsz：`640`
- 类别数：`1`
- 训练设备：`device 0 (GPU)`

## PowerShell 命令模板

```powershell
$env:YOLOv5_AUTOINSTALL='False'
python "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\yolov5\train.py" --img 640 --batch 4 --epochs 20 --data "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\configs\plate_ccpd.yaml" --weights "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\weights\yolov5n.pt" --device 0 --workers 2 --project "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\runs\train" --name "plate_ccpd_gpu_v1"
```

## 推荐脚本入口

```powershell
& "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\scripts\powershell\train_plate_detector.ps1"
```

## 当前正式训练默认参数

- run name：`plate_ccpd_gpu_v1`
- device：`0`
- workers：`2`

## 训练记录

- 开始时间：
- 结束时间：
- 训练设备：
- 是否正常生成 `runs/train/...`：
- 是否产出 `best.pt`：
- 观察到的主要问题：

## 第二轮优化可选项

- 增加训练轮数到 `50`
- 将模型切换到 `yolov5s.pt`
- 增加小目标样本
- 提高输入尺寸到 `960`
