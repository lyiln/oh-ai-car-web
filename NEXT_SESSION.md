# Next Session Handoff

## Active objective

继续“乱停车识别—上门处置”项目。Web 阶段 0 阻断项已经修复并通过回归测试；
下一步执行真实小车计划的阶段 1，只读发现 ROS2/Nav2 和硬件环境。当前版本
**仍不得直接用于物理车辆自主导航**。

## Read in this order

1. `AGENTS.md`
2. `tasks/code-review-doorstep-response.md`
3. `tasks/real-car-doorstep-integration-plan.md`
4. `AI_CONTEXT.md`
5. `PROTOCOL_STATUS.md`
6. `docs/flows/web-control-real-car-validation.md`
7. `tasks/change-report-doorstep-response.md`

## Start here

执行 `tasks/real-car-doorstep-integration-plan.md` 的阶段 1。只允许收集实际
小车 IP、端口、ROS graph/topic/type、Nav2 lifecycle、地图版本、相机、电量、
`/cmd_vel` 和急停方式；把结果写入真实车辆验证文档。没有现场设备信息时不要
猜测，也不要发送导航目标。

## Current evidence and boundaries

- Typecheck、build、workspace 单元测试和 10 项 PostGIS 集成测试已通过。
- migration 008 已增加可恢复分配、`cancellation_requested` 与零速度停止确认。
- ROS response scheduler 尚不存在于本仓库。
- Nav2 暂停/恢复、到达照片生产和真车零速度均未验证。
- `Front` TCP 报文仍有冲突，必须遵守 `PROTOCOL_STATUS.md`。
- 未跟踪的 `tmp/` 是用户已有内容，不要删除或纳入提交。

## When this handoff is finished

只有阶段 1 真实环境清单完成并确认急停与静止验证条件后，才能把本文件目标
更新为阶段 2 ROS 适配器实现。不要删除历史评审和实施计划。
