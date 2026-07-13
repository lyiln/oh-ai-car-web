# environment.md

## 目标环境

- 操作系统：Windows
- Python 虚拟环境名：`vision_env`
- 主训练框架：`ultralytics/yolov5`
- 当前阶段任务：单类别车牌检测

## 建议记录项

当前已确认的版本信息：

- Python 版本：`3.13.3`
- torch 版本：`2.11.0+cu128`
- torchvision 版本：`0.26.0+cu128`
- CUDA 是否可用：`True`
- CUDA 版本：`12.8`
- OpenCV 版本：`4.11.0`
- GPU：`NVIDIA GeForce RTX 4060 Laptop GPU`

## PowerShell 原子化命令模板

```powershell
mkdir "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection"
python -m venv --system-site-packages "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\vision_env"
"c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\vision_env\Scripts\Activate.ps1"
python -m pip install --upgrade pip
pip install --upgrade --force-reinstall --no-cache-dir torch torchvision --index-url https://download.pytorch.org/whl/cu128
pip install -r "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\yolov5\requirements.txt"
python "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\yolov5\detect.py" --help
```

## 推荐脚本入口

```powershell
& "c:\Users\jfkyx\Desktop\YOLOv5\member_d_plate_detection\scripts\powershell\setup_vision_env.ps1"
```

## 自检结果

- `python` 可运行：已通过
- `import torch` 成功：已通过
- `import cv2` 成功：已通过
- `detect.py --help` 成功：已通过
