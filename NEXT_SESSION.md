# Next Session Handoff

## Active objective

继续“乱停车识别—上门处置”项目。Web 阶段 0 阻断项已经修复并通过回归测试；
阶段 1 的只读发现已完成，但发现 Jetson 缺失 ROS 2 runtime 且没有运行中的
ROS/Nav2 graph。下一步不是实现 scheduler，而是等待批准后执行阶段 1.5 的非运动
运行时恢复与导航架构冻结。当前版本**仍不得直接用于物理车辆自主导航**。

## Read in this order

1. `AGENTS.md`
2. `tasks/code-review-doorstep-response.md`
3. `tasks/real-car-doorstep-integration-plan.md`
4. `AI_CONTEXT.md`
5. `PROTOCOL_STATUS.md`
6. `docs/flows/web-control-real-car-validation.md`
7. `docs/flows/jetson-stage1-readonly-runbook.md`
8. `docs/architecture/jetson-yahboom-x3-environment-baseline.md`
9. `tasks/change-report-doorstep-response.md`

## Start here

先读真实车辆验证文档中的 2026-07-12 发现记录。没有对 Jetson 进行软件安装、
文件修复、启动 ROS 节点或底盘测试的单独批准时，只可继续读取；不得发送导航目标。

## Current evidence and boundaries

- Stage 0 implementation commit: `7ebcabc` (`feat: add safe doorstep response workflow`).
- 生产与 ROS 接入的软件门禁已在当前工作区修复：Nginx `/patrol/live` 代理、
  生产配置 fail-fast、候选车辆健康门禁、migration advisory lock 和 WebSocket Origin。
- typecheck、build、workspace 单元测试、10 项 PostGIS 集成测试和 Docker/Nginx
  认证 WebSocket 冒烟验证已通过。
- migration 008 已增加可恢复分配、`cancellation_requested` 与零速度停止确认。
- ROS response scheduler 尚不存在于本仓库。
- Jetson `10.82.66.12` 的 SSH 只读发现已确认 Ubuntu 20.04.5 / JetPack R35.3.1、
  Yahboom X3 工作区、RPLidar/Orbbec 设备，但 `/opt/ros`、`ros2`、运行图、
  Nav2 lifecycle、TCP 6000 和视频 6500 均不可用；候选地图路径失效，急停未知。
- Nav2 暂停/恢复、到达照片生产和真车零速度均未验证。
- `Front` TCP 报文仍有冲突，必须遵守 `PROTOCOL_STATUS.md`。
- 未跟踪的 `tmp/` 是用户已有内容，不要删除或纳入提交。

## When this handoff is finished

只有阶段 1 真实环境清单完成并确认急停与静止验证条件后，才能把本文件目标
更新为阶段 2 ROS 适配器实现。不要删除历史评审和实施计划。
