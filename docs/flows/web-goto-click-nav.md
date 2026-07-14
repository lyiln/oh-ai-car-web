# Web 单点前往（对齐 RViz 2D Goal Pose）

把课程手册里 Nav2 **单点导航**复现到浏览器：地图「前往模式」点一下 → 平台存目标 → 车端/`sim:goto` 调 `NavigateToPose`（或假导航）→ 红点（三角车标）移动。

多点巡航仍用「标点模式」+ `/patrol/tasks`，见 [patrol-stage-c-sim.md](patrol-stage-c-sim.md)。

## 本机演示（不碰真车）

1. `npm run dev:backend`、`npm run dev:frontend`
2. 登录 → 设备管理选中车辆 → `/map` 上传底图（可选但推荐）
3. 管理员签发设备凭据：`POST /api/vehicles/<id>/device-credentials`
4. 启动仿真执行器：

```powershell
cd e:\小学期\oh-ai-car-web
npm run sim:goto -- <uuid.secret> http://127.0.0.1:8788
```

5. 打开 `/map` → **前往模式** → 在图上点目标  
6. 应看到橙色十字目标；三角车标向目标移动；右侧「前往目标」变为 `arrived`

取消：点 **取消前往**。

## 真车（Nav2，需阶段 D 门禁）

车上仍按手册启动 `navigation_dwa/teb`，并用 RViz **2D Pose Estimate** 设初始位姿（Web 不做这一步）。

```bash
export PLATFORM_API_URL=https://<platform>
export DEVICE_CREDENTIAL=<id.secret>
export NAV_MODE=nav2
export MAP_VERSION=<与底图一致>
python3 edge-agent/pose_agent.py   # 可选：单独上报 /amcl_pose
python3 edge-agent/goto_scheduler.py
```

`goto_scheduler` 在 `NAV_MODE=nav2` 时调用与巡航相同的 `NavigateToPose`。轮子着地前须完成 [patrol-stage-d-real-car.md](patrol-stage-d-real-car.md) D0–D1。

## API 摘要

| 调用方 | 路径 |
|--------|------|
| 浏览器 | `POST /api/vehicles/:id/goto` `{x,y,yaw?}` |
| 浏览器 | `POST /api/vehicles/:id/goto/cancel` |
| 浏览器 | `GET /api/vehicles/:id/goto/active` |
| 设备 | `GET /device/v1/goto/next` |
| 设备 | `GET /device/v1/goto/:id` |
| 设备 | `POST /device/v1/goto/:id/events` `arrived` / `failed` / `stop_confirmed` |

与活跃巡检、上门任务、手动控制租约互斥（409）。
