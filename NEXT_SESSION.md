# Next Session Handoff

## Active objective

Web 支持「设初始位」+「前往模式」请求车上准备：`nav_supervisor.py` 拉起
pose/goto 桥接，可选 `NAV_BRINGUP_CMD` 起 Nav2；见
`docs/flows/web-nav-one-click-ready.md`。单点前往见 `web-goto-click-nav.md`。

真车轮子着地仍须阶段 D 门禁。上门 `response_scheduler` 仍未实现。

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

## Current evidence and boundaries

- One-click prepare + Web initial pose are in-tree; Stage D hardware acceptance is **not** claimed.
- Full Nav2 auto-launch depends on operator-provided `NAV_BRINGUP_CMD`; otherwise assume-bringup + checklist.
- `Front` TCP packet conflict remains unresolved (`PROTOCOL_STATUS.md`).
