# 上门处置代码评审报告

日期：2026-07-12

评审对象：当前未提交的“乱停车识别—上门处置”实现

结论：**Approved with Notes for stage 1 discovery**

## 复审结论（2026-07-12）

阶段 0 的阻断项已修复：`publishPatrol` 按车辆订阅隔离；`failed` 只允许从
活动状态进入；确认后无车可分配会保留 `confirmed` 并支持幂等重试；活动取消
进入 `cancellation_requested`，必须由设备零速度确认。相关单元和 PostGIS
集成回归测试通过。

该结论只批准进入真车计划的阶段 1“只读环境发现”，不代表 ROS 适配器、
Nav2 或真车运动已验证。

## 已解决的阻断项

### P1：实时事件未按车辆隔离

原实现的 `RealtimeHub.publishPatrol()` 向所有 `/patrol/live` 订阅者广播消息，
没有检查订阅时保存的 `vehicleId`；新增 `violation_alert` 后会造成跨车辆信息
暴露。当前实现已改为严格匹配 `vehicleId` 后发送。

处理结果：所有 `publishPatrol` 消息必须含 `vehicleId`，Hub 仅发送给匹配
车辆的订阅者；新增 Hub 车辆隔离单元测试。

证据：`backend/src/app.ts` 的 `RealtimeHub.publishPatrol()`；
`backend/src/routes/response-platform.ts` 的 `response_status`、
`assignment_changed`、`response_event` 和 `violation_alert` 发布点。

### P1：终态可以被 `failed` 覆盖

原设备事件处理把 `failed.from` 动态设置为数据库当前状态，终态可能被改写。
当前实现已限定允许来源并由集成测试覆盖完成、取消后的迟到事件。

处理结果：`failed` 只允许从 `assigned`、`navigating`、`arrived` 进入；
完成和取消后的迟到失败事件由集成测试确认返回 409。

证据：`backend/src/routes/response-platform.ts` 的设备事件 `transitions`。

### P1：确认成功但分配失败后无法恢复

原确认接口先提交 `confirmed` 再分配，无安全车辆时没有恢复入口。当前实现
保留可恢复状态，并提供幂等重试接口和 Web 操作。

处理结果：保留 `confirmed` 作为可恢复状态，新增幂等
`POST /api/response-tasks/:id/assign` 和 Web“重试分配”；集成测试覆盖控制租约
导致无车、租约释放后重新分配成功。

证据：`backend/src/routes/response-platform.ts` 的 `confirm` 路由和
`assignVehicle()`。

## 重要非阻断项

- 白名单 API/前端没有维护 `destination_id`；当前主要依赖 `building` 匹配
  `resident_key=''` 的公共入口，尚不能可靠支持同楼栋多个住户入口。
- 源巡检车作为单车降级时，Web API 不会暂停巡检；必须由外部 ROS 调度器
  实现“保存断点—取消当前 Nav2 目标—确认零速度—执行上门—恢复巡检”。
- 源车在分配规则中豁免在线、电量和地图检查。真车适配器必须至少检查设备
  心跳、电量、地图版本和 Nav2 lifecycle 状态后才接受任务。
- 当前取消接口不处理 `navigating/arrived`。真车方案必须新增设备侧安全取消
  协议，不能用 Web 数据库改状态代替 Nav2 cancel 和零速度确认。
- `GET /device/v1/response/tasks/next` 是读取已分配任务而非领取状态变更；需要
  明确轮询与重复读取语义，设备端只按任务 ID 幂等启动一次。

## 已有证据

- `npm run typecheck` 与生产构建通过。
- workspace 单元测试通过。
- PostGIS 集成测试 10 项通过，其中包含上门任务确认、领取、到达、留证、
  完成及事件幂等流程。
- 上述测试没有覆盖跨车辆 WebSocket 隔离、终态失败覆盖、分配失败恢复、
  ROS/Nav2 或真实车辆行为。

## 评审后的下一步

严格按 `tasks/real-car-doorstep-integration-plan.md` 执行阶段 1，只做网络、ROS
graph、Nav2 lifecycle、地图和急停能力发现。阶段 2–3 完成前不让真车自主移动。
