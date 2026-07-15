# Next Session Handoff

## Active objective

Web 支持「设初始位」+「前往模式」请求车上准备：`nav_supervisor.py` 拉起
pose/goto 桥接，可选 `NAV_BRINGUP_CMD` 起 Nav2；见
`docs/flows/web-nav-one-click-ready.md`。单点前往见
`docs/flows/web-goto-click-nav.md`，现场架构见
`docs/architecture/jetson-yahboom-x3-environment-baseline.md`。

2026-07-15 已在 `10.82.66.179` 完成 ROS 容器、激光、里程计、AMCL、Nav2
Action 和 Web 单点前往的悬空轮/禁用驱动验证。真车轮子着地仍须阶段 D 门禁。
上门 `response_scheduler` 仍未实现。

**安全/验证备忘（来自 main 收口）：** 网页控制台已按角色/车辆隔离地图航点、AI 白名单与证据读取；认证端点有限流，migration 016 含 OTP 五次失败失效。目标环境若尚未应用 migration 011–016，部署前须补跑集成测试并按流程迁移。Jetson 宿主没有 ROS runtime，但 Docker `oh-ai-nav` 中的 ROS 2 Foxy/Nav2 已运行并通过悬空轮链路验证；**这仍不授权轮子着地后的物理车辆自主导航**。

## Read in this order

1. `AGENTS.md`
2. `docs/flows/web-nav-one-click-ready.md`
3. `docs/flows/web-goto-click-nav.md`
4. `docs/flows/patrol-stage-d-real-car.md`
5. `PROTOCOL_STATUS.md`

## Start here

1. PC：backend/frontend；选车；上传底图；签发凭据。
2. Jetson：`nav_supervisor.py`（配置 `NAV_BRINGUP_CMD` 或 `NAV_ASSUME_BRINGUP=true`）。
3. `/map`：设初始位 → 前往模式等「导航就绪」→ 点地图。
4. 多点巡航仍用标点 + `sim:patrol` / `patrol_scheduler`。

### Web local stack

For local browser development, run these commands in three terminals:

```sh
npm run dev:backend
npm run dev:frontend
PLATFORM_API_URL=http://127.0.0.1:8788 npm run dev:gateway
```

Open `http://127.0.0.1:5173`. This stack is local Web-only and does not start
Jetson Docker, ROS nodes, the vendor App, or a vehicle-control process. The member
C ROS2 workspace is maintained in the sibling project `../oh-ai-car-ros2`.

## Current evidence and boundaries

- One-click prepare + Web initial pose are in-tree；`oh-ai-nav` 已验证自动 bringup。Stage D 地面硬件验收仍 **未完成**。
- 现场必须保持宿主 Rosmaster-App 与 ROS 容器互斥；`agent.env` 的真实凭据不得写入文档或提交。
- 本机 `8787` 网关只服务 Rosmaster-App 的 TCP `6000` 手动控制；FloorMap 导航走 Web 后端 → 车端代理 → Nav2。当前 ROS 运行态下 `6000` 拒绝连接是预期现象，不要为此并行启动 Rosmaster-App。
- FloorMap 当前支持“已登记地图 + 人工初始位 + AMCL 自动细化/跟踪 + 点终点导航”，不支持“新扫描图自动同步 + 无初值全局定位”。
- 生产与 ROS 接入的软件门禁已在当前工作区修复：Nginx `/patrol/live` 代理、生产配置 fail-fast、候选车辆健康门禁、migration advisory lock 和 WebSocket Origin。
- migration 008 已增加可恢复分配、`cancellation_requested` 与零速度停止确认。
- ROS response scheduler 尚不存在于本仓库。
- Nav2 暂停/恢复、到达照片生产和真车零速度均未验证。
- `Front` TCP 报文仍有冲突，必须遵守 `PROTOCOL_STATUS.md`。
- 未跟踪的 `tmp/` 是用户已有内容，不要删除或纳入提交。
- 2026-07-14 Web 安全收口：地图航点、AI 白名单和证据读取按角色/车辆授权隔离；认证限流与 migration 016 OTP 失效已有测试证据。

## When this handoff is finished

下一步是轮子着地前的 Stage D 门禁和短距离地面验证；不要把悬空轮结果扩写为
路径规划、避障、定位精度或停车距离已验收。不要删除历史评审和实施计划。
