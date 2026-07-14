# 阶段 C：巡航调度仿真闭环

本手册在**本机**验证「Web 下发巡检 → 调度器领任务 → 逐航点 → 完成 / 中途停止」。  
使用假导航（`npm run sim:patrol` 或 `NAV_MODE=sim`），**不依赖 ROS / Gazebo / 真车**。

> sim 通过 ≠ 真车通过。真车见 [patrol-stage-d-real-car.md](patrol-stage-d-real-car.md)。

## 前置

1. 后端与前端已启动（`npm run dev:backend`、`npm run dev:frontend`）。
2. 已注册车辆并选中；已上传楼道底图（可选，便于看位姿）。
3. 白名单至少 1 条（否则「开始巡检」会 409）。
4. 已保存含 3–8 航点的巡航路线（地图页标点或设置页 YAML 导入）。

## 生成设备凭据

管理员调用（浏览器已登录后，用 Cookie 或临时脚本）：

```http
POST /api/vehicles/<vehicleId>/device-credentials
Origin: http://127.0.0.1:5173
```

响应中的 `credential.token`（形如 `uuid.secret`）只显示一次，请保存。

## 启动仿真调度器

```powershell
cd e:\小学期\oh-ai-car-web
npm run sim:patrol -- <uuid.secret> http://127.0.0.1:8788
```

或 Python（与车上同路径）：

```powershell
$env:PLATFORM_API_URL="http://127.0.0.1:8788"
$env:DEVICE_CREDENTIAL="<uuid.secret>"
$env:NAV_MODE="sim"
python edge-agent/patrol_scheduler.py
```

## 路径 A：正常完成

1. 打开 http://127.0.0.1:5173/patrol/tasks
2. 选择设备与路线 → **开始巡检**
3. 调度器日志应出现 `claimed task`、逐航点 `waypoint reached`、`completed`
4. Web 任务状态应变为已完成；若地图页订阅了位姿，可见小车沿航点移动

## 路径 B：中途停止

1. 启动巡检后，在调度器仍在「navigating / dwell」时点 **停止巡检**
2. 任务进入 `cancellation_requested`
3. 调度器应上报 `stop_confirmed`（`zeroVelocity: true`）
4. 任务终态为 `stopped`（不是一直卡在 cancellation_requested）

## 记录模板

| 项 | 结果 | 备注 |
|----|------|------|
| 领任务 queued→running | 通过 / 失败 | |
| 全部航点 waypoint 事件 | 通过 / 失败 | |
| status completed | 通过 / 失败 | |
| 中途停止→stopped | 通过 / 失败 | |
| 位姿 pose_update（可选） | 通过 / 失败 / 未测 | |

## 相关代码

- `scripts/sim-patrol-loop.mjs`、`edge-agent/patrol_scheduler.py`、`edge-agent/nav_backend.py`
- `GET /device/v1/patrol/tasks/next`、`GET /device/v1/patrol/tasks/:id`、`POST .../events`
