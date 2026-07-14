# 车牌测试 Web 使用说明

## 1. 功能说明
这个小型 Web 页面用于本地测试当前两阶段识别流程：
- 先检测图片里是否有车辆
- 若检测到车辆，再继续识别车牌号

## 2. 默认模型
- 车辆检测：`weights/yolov5s.pt`
- 车牌检测：`runs/train/plate_ccpd_gpu_v3_continue/weights/best.pt`

## 3. 一键启动
PowerShell 中运行：

```powershell
& "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\scripts\powershell\start_plate_test_web.ps1"
```

脚本会做三件事：
- 启动 FastAPI 后端
- 启动 React 前端
- 自动打开浏览器页面

默认地址：
- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:8010`

## 4. 手动启动
### 4.1 启动后端

```powershell
& "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\vision_env\Scripts\python.exe" "C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\scripts\web_api_server.py"
```

### 4.2 启动前端

```powershell
npx vite --host 127.0.0.1 --port 5173
```

运行目录：

```powershell
C:\Users\jfkyx\Desktop\YOLOv5 plate\member_d_plate_detection\web_test_app
```

如需指定推理设备，可在启动后端前设置环境变量：

```powershell
$env:PLATE_WEB_DEVICE = "0"
```

不设置时会沿用流水线默认行为，让程序自动选择可用设备。

## 5. 输出位置
每次 Web 推理都会在这里生成独立结果目录：

```text
demo_output\web_runtime\runs\run_xxxxxxxx
```

其中会包含：
- 上传原图
- 车辆检测结果图
- 车牌检测结果图
- 车牌裁剪图
- `car_plate_results.json`

## 6. 当前限制
- 首版仅支持单张图片上传
- 主要用于本地调试和演示，不是正式部署版
- 车辆门控当前仍使用 `yolov5s.pt`，因此整体召回率主要受第一阶段影响
