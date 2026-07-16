# YOLOv5 车牌识别集成

将 [oh-ai-car-YOLOv5](https://github.com/JMshepherd227/oh-ai-car-YOLOv5) 的检测/OCR 结果接入本平台 **observation** 流水线（违停识别 → 审核 → 违规告警）。

## 架构

```text
相机 / 视频源
    → YOLOv5/oh-ai-car-YOLOv5 (YOLOv5 车辆门控 + 车牌检测 + PaddleOCR)
    → edge-agent/plate_vision_agent.py
    → POST /device/v1/evidence  (JPEG → 主机 data/evidence/)
    → POST /device/v1/patrol/tasks/:id/events  { type: "observation", evidenceImageUrl: "/api/evidence/..." }
    → plate_observations → violations / reviews / 地图
    → 登记私家车禁停候选 → 人工确认 → WxPusher
```

平台后端**不包含**推理代码；与 GPS 遥测一样，推理在 Jetson 边缘侧完成。

## 1. 放置 YOLO 模型仓库

当前仓库已内置主用路径：

```text
YOLOv5/oh-ai-car-YOLOv5/
├─ yolov5/                 # Ultralytics YOLOv5
├─ weights/
│  ├─ car_bdd100k_mini_v1_best.pt
│  └─ best_plate_detector_v2.pt
├─ scripts/web_runtime_inference.py
└─ platform_hook.py        # 由 setup 脚本或示例文件生成
```

同时仍兼容自动发现你本机现有的外部仓库路径：

```text
../YOLOv5/oh-ai-car-YOLOv5/
```

也就是本项目旁边的：

```text
c:\Users\jfkyx\Desktop\小车web\YOLOv5\oh-ai-car-YOLOv5
```

如需覆盖自动发现结果，显式设置 `YOLO_REPO_PATH` 即可。

仓库为私有时，需先接受 GitHub 邀请：

[https://github.com/JMshepherd227/oh-ai-car-YOLOv5/invitations](https://github.com/JMshepherd227/oh-ai-car-YOLOv5/invitations)

如需重新克隆或修复目录，也可以在本仓库根目录执行：

```bash
npm run setup:yolo
```

克隆目标：`YOLOv5/oh-ai-car-YOLOv5/`。兼容旧路径 `yolo-v5/oh-ai-car-YOLOv5/` 与 `vendor/oh-ai-car-YOLOv5/`。

## 2. 对接方式

### 方式 A（推荐）：`platform_hook.py`

仓库根目录的 `platform_hook.py` 导出 `create_detector()`，内部复用 `scripts/web_runtime_inference.py` 的 **WebInferenceRuntime**（进程内两阶段推理，避免每帧 subprocess）。

参考本仓库 `[edge-agent/platform_hook.example.py](../../edge-agent/platform_hook.example.py)`；`setup-yolo-plate.py` 会在缺失时自动复制。

### 方式 B：仅权重回退

无 hook 时，适配器会尝试 `yolov5/detect.py` subprocess 或 `torch.hub` 加载 `weights/best_plate_detector_v2.pt`。此模式通常**无 OCR 文本**，需设 `PLATE_ALLOW_BBOX_ONLY=1` 才能上报人工审核。

## 3. 边缘依赖

```bash
pip install -r edge-agent/requirements-plate.txt
# Jetson 上按官方说明单独安装 CUDA 版 PyTorch / PaddlePaddle
# 参考：YOLOv5/oh-ai-car-YOLOv5/scripts/ubuntu/setup_plate_runtime.sh
```

## 4. 环境变量（Jetson / 开发机）


| 变量                            | 说明                                                                          |
| ----------------------------- | --------------------------------------------------------------------------- |
| `PLATFORM_API_URL`            | 平台 API，如 `http://10.82.66.59:8788`                                          |
| `DEVICE_CREDENTIAL`           | 设备凭据 `uuid.secret`                                                          |
| `YOLO_REPO_PATH`              | 默认 `YOLOv5/oh-ai-car-YOLOv5`（其次 `yolo-v5/...`、`vendor/...`）                 |
| `YOLO_DEVICE`                 | `0` / `cpu`，空为自动                                                            |
| `YOLO_CAR_WEIGHTS`            | 默认 `weights/car_bdd100k_mini_v1_best.pt`                                    |
| `YOLO_PLATE_WEIGHTS`          | 默认 `weights/best_plate_detector_v2.pt`                                      |
| `YOLO_OCR_MIN_SCORE`          | OCR 通过阈值，默认 `0.75`                                                          |
| `YOLO_PIPELINE_MODE`          | `two_stage`（默认）                                                             |
| `PLATE_VIDEO_SOURCE`          | `0` 摄像头，或 RTSP/文件路径                                                         |
| `PLATE_DETECTOR_MODE`         | `auto` / `mock` / `subprocess`                                              |
| `PLATE_MIN_CONFIDENCE`        | 上报阈值，默认 `0.45`（平台分类阈值 0.75）                                                 |
| `EVIDENCE_UPLOAD_TO_PLATFORM` | 默认 `1`：把 JPEG 上传到主机 `POST /device/v1/evidence`，Web 用 `/api/evidence/...` 展示 |
| `EVIDENCE_STORAGE_DIR`        | 主机侧存储目录，默认 `backend/data/evidence`（相对后端 cwd）                                |
| `EVIDENCE_KEEP_LOCAL`         | 默认 `1`：上传后仍在边缘保留本地副本（调试）                                                    |
| `EVIDENCE_PUBLIC_BASE_URL`    | 仅当 `EVIDENCE_UPLOAD_TO_PLATFORM=0` 时使用；Jetson 本机证据 HTTP 前缀                  |
| `EVIDENCE_HOST`               | 本地证据服务监听；上传到主机时可不开启 `EVIDENCE_SERVE`                                        |
| `PLATE_VISION_TASK_ID`        | 可选，固定任务 ID（调试）                                                              |
| `PLATE_VISION_WAYPOINT_ID`    | 可选，固定航点 ID（调试）                                                              |
| `STATE_PATH`                  | 与 `patrol_scheduler.py` 共用的 SQLite 状态文件；视觉只在调度器写入当前停留航点时上报                      |


### 主机 Web 可视化（管理员）

1. 后端对外监听（Jetson 可访问）：`.env` 中 `HOST=0.0.0.0`，`PLATFORM_API_URL=http://<PC-IP>:8788`
2. 边缘 `plate_vision_agent` 识别后上传原图/标注图到主机
3. 登录 Web → **待人工审核** / **违规车辆**：看截图，点图可放大，再确认/误报

## 5. 启动

```bash
cd edge-agent
export PLATFORM_API_URL=http://127.0.0.1:8788
export DEVICE_CREDENTIAL=<from scripts/.local-jetson-gps.json>
export PLATE_VIDEO_SOURCE=0
bash start-plate-vision.sh
```

**前提：**

1. `patrol_scheduler.py` 已领取平台上的巡逻任务，并与视觉进程使用相同 `STATE_PATH`
2. 相机可用；调试可用图片路径作 `PLATE_VIDEO_SOURCE`
3. 可选：GPS 遥测 agent 运行中（用于坐标；无 GPS 时平台用 ±60s 遥测回填）

## 6. 平台侧验证

1. 前端 **违规列表** / **地图** / **审核队列** 出现新记录；私家车禁停还会出现在 **微信通知** 页
2. 集成测试参考：`backend/tests/integration/platform.test.ts`（含中文车牌 observation）

本地 mock 测试（无需 GPU）：

```bash
python edge-agent/tests/test_plate_adapter.py
```

有权重时的 hook 映射测试：

```bash
python edge-agent/tests/test_platform_hook_mapping.py
```

## 7. 控制台前端识别（本机）

控制台「视频预览」下方保留完整的 **车牌识别工作台**；视频卡片底部的“车牌识别”按钮会滚动到该工作台。识别链路通过：

1. Gateway `GET /api/video/snapshot` 代理拉取小车视频帧（解决 iframe 跨域无法读像素）
2. 前端 `POST /plate-api/api/infer` → 本机 YOLO FastAPI `:8010`

```text
ConsolePage
  → /gateway-api/api/video/snapshot  → gateway :8787 → 小车 :6500
  → /plate-api/api/infer             → web_api_server :8010 (YOLOv5 + PaddleOCR)
```

### 启动四进程

使用控制台车牌识别工作台时，以下四个进程都必须运行；仅遥控或查看平台时，YOLO 的第四个进程不是必需项。

```bash
npm run dev:backend
npm run dev:frontend
# PowerShell:
$env:PLATFORM_API_URL="http://127.0.0.1:8788"; npm run dev:gateway
npm run dev:plate-api
# `npm run dev:plate-api` 在 macOS/Linux 调用 python3，在 Windows 调用 python。
```

依赖：`pip install fastapi uvicorn`，以及 YOLO 仓库所需的 torch / paddleocr / ultralytics。

控制台操作：

1. 连接小车并确认视频 iframe 正常
2. 进入控制台下方的「车牌识别工作台」
3. 可选模式：
  - `实时快照`：对当前小车视频帧执行识别
  - `本地图片`：上传单张图片测试两阶段流程
  - `本地视频`：上传视频并查看抽帧统计、命中帧列表、详情复核、主体车 ROI 与车牌裁剪图
  - `浏览器摄像头`：直接用浏览器摄像头做连续抓帧识别

这些本地/Fake TCP 验证不构成真实车辆或模型精度验证；真实车辆操作仍须遵循 `PROTOCOL_STATUS.md`。

相关文件：


| 文件                                                                                                           | 作用                   |
| ------------------------------------------------------------------------------------------------------------ | -------------------- |
| `[frontend/src/components/plate/PlateScanPanel.tsx](../../frontend/src/components/plate/PlateScanPanel.tsx)` | 控制台识别 UI             |
| `[frontend/src/services/plateClient.ts](../../frontend/src/services/plateClient.ts)`                         | snapshot + infer 客户端 |
| `[gateway/src/http/video-snapshot.ts](../../gateway/src/http/video-snapshot.ts)`                             | 视频帧代理                |
| `[scripts/start-plate-web-api.py](../../scripts/start-plate-web-api.py)`                                     | 启动 :8010             |


## 8. 与 TCP 遥控的关系

- 车牌识别走 **HTTPS device API**（边缘）或本机 plate-api（控制台），与 TCP `:6000` 遥控独立
- 巡逻任务运行时，平台会阻止人工租约控车（409），由车辆侧 scheduler 协调
- 控制台识别需要已连接并持有控制租约（与遥控按钮同一 `disabled` 条件）

## 相关文件


| 文件                                                                                       | 作用                        |
| ---------------------------------------------------------------------------------------- | ------------------------- |
| `[edge-agent/plate_vision_agent.py](../../edge-agent/plate_vision_agent.py)`             | 主循环：采帧 → 推理 → 上报          |
| `[edge-agent/yolo_plate_adapter.py](../../edge-agent/yolo_plate_adapter.py)`             | 加载 YOLO 仓库 / hook         |
| `[edge-agent/platform_hook.example.py](../../edge-agent/platform_hook.example.py)`       | hook 模板（复制到 YOLO 仓库根）     |
| `[edge-agent/platform_client.py](../../edge-agent/platform_client.py)`                   | Device API 客户端            |
| `[backend/src/app.ts](../../backend/src/app.ts)`                                         | observation 入库与分类（支持中文车牌） |
| `[docs/flows/illegal-parking-localization.md](../flows/illegal-parking-localization.md)` | 坐标与车主信息                   |
