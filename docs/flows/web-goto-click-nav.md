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

## 真车当前能力边界

当前 Web 已支持在 FloorMap 上设初始位，不再要求只能通过 RViz 操作。完整顺序是：

1. 加载与车端 `yaml/pgm` 坐标一致的 Web 底图（分辨率、原点、地图版本必须匹配）。
2. 在 FloorMap 用“设初始位”点选车辆的大致真实位置和朝向。
3. 车端 supervisor 向 `/initialpose` 发布；AMCL 用雷达扫描与既有地图匹配，细化并持续跟踪位姿。
4. 等 `map -> base_footprint` 和 `NavigateToPose` 都就绪。
5. 切到“前往模式”点目标，车端调用 Nav2 `NavigateToPose`。

因此：**对已经保存并正确登记的地图，可以“人工给初值 → AMCL 自动校准/跟踪 → 点终点导航”**。当前还不能在完全不知道初始位置时，仅凭一次雷达扫描自动识别车辆处于地图的哪个位置。

如果“雷达扫描后的图”指刚用 SLAM 新建的地图，当前也不会自动把它同步到 FloorMap。必须先保存对应 `yaml + pgm/png`，把 `resolution`、`origin` 和版本登记到 Web，并切换到定位/导航模式。实时建图、地图上传/版本注册、建图到导航的模式切换、全局重定位仍是后续能力。

车端运行方式见 [真车一键导航就绪](web-nav-one-click-ready.md) 和 [Jetson 现场环境基线](../architecture/jetson-yahboom-x3-environment-baseline.md)。

```bash
export PLATFORM_API_URL=https://<platform>
export DEVICE_CREDENTIAL=<id.secret>
export NAV_MODE=nav2
export MAP_VERSION=<与底图一致>
python3 edge-agent/pose_agent.py   # 可选：单独上报 /amcl_pose
python3 edge-agent/goto_scheduler.py
```

`goto_scheduler` 在 `NAV_MODE=nav2` 时调用与巡航相同的 `NavigateToPose`。2026-07-15 已在车轮悬空或驱动禁用条件下验证短目标和结果回传；轮子着地前仍须完成 [patrol-stage-d-real-car.md](patrol-stage-d-real-car.md) D0–D1。

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
