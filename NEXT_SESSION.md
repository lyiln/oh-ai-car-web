# Next Session Handoff

## Active objective

Web 支持「设初始位」+「前往模式」请求车上准备：`nav_supervisor.py` 拉起
pose/goto 桥接，可选 `NAV_BRINGUP_CMD` 起 Nav2；见
`docs/flows/web-nav-one-click-ready.md`。单点前往见 `web-goto-click-nav.md`。

真车轮子着地仍须阶段 D 门禁。上门 `response_scheduler` 仍未实现。

**安全/验证备忘（来自 main 收口）：** 网页控制台已按角色/车辆隔离地图航点、AI 白名单与证据读取；认证端点有限流，migration 016 含 OTP 五次失败失效。目标环境若尚未应用 migration 011–016，部署前须补跑集成测试并按流程迁移。Jetson 仍缺宿主 ROS runtime；**当前版本仍不得直接用于物理车辆自主导航**。

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

- One-click prepare + Web initial pose are in-tree; Stage D hardware acceptance is **not** claimed.
- Full Nav2 auto-launch depends on operator-provided `NAV_BRINGUP_CMD`; otherwise assume-bringup + checklist.
- 生产与 ROS 接入的软件门禁已在当前工作区修复：Nginx `/patrol/live` 代理、生产配置 fail-fast、候选车辆健康门禁、migration advisory lock 和 WebSocket Origin。
- migration 008 已增加可恢复分配、`cancellation_requested` 与零速度停止确认。
- ROS response scheduler 尚不存在于本仓库。
- Nav2 暂停/恢复、到达照片生产和真车零速度均未验证。
- `Front` TCP 报文仍有冲突，必须遵守 `PROTOCOL_STATUS.md`。
- 未跟踪的 `tmp/` 是用户已有内容，不要删除或纳入提交。
- 2026-07-14 Web 安全收口：地图航点、AI 白名单和证据读取按角色/车辆授权隔离；认证限流与 migration 016 OTP 失效已有测试证据。

## When this handoff is finished

只有阶段 1 真实环境清单完成并确认急停与静止验证条件后，才能把本文件目标
更新为阶段 2 ROS 适配器实现。不要删除历史评审和实施计划。
