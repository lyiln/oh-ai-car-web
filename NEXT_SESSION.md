# Next Session Handoff

## Active objective

完成网页控制台收口后的运行验证与交接。先在具备 Docker/Testcontainers 的环境补跑
平台集成测试，再按部署流程应用 migration 011；随后进行浏览器人工验收。阶段 1 的
只读发现已完成，但 Jetson 仍缺失 ROS 2 runtime 且没有运行中的 ROS/Nav2 graph；
ROS/Nav2 恢复与导航架构冻结仍需单独批准。当前版本**仍不得直接用于物理车辆自主导航**。

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
10. `tasks/web-business-closure-and-ui-plan.md`
11. `tasks/change-report-web-business-closure-ui.md`

## Start here

按以下顺序处理网页收口后的下一步任务：

1. 在具备 Docker/Testcontainers runtime 的环境执行
   `npm run test:integration --workspace=@oh-ai-car-web/backend`，记录完整结果；重点覆盖
   migration 011、路线 YAML 导入和规则快照。
2. 通过集成测试后，遵循既有数据库部署流程在目标环境应用 migration 011
   `011-patrol-rule-snapshots`；确认 `patrol_tasks` 快照字段和
   `patrol_routes` 唯一索引已生效。不得在此工作区假定迁移已部署。
3. 用真实平台服务进行浏览器人工验收：登录、管理员路线导入、规则保存、巡检任务
   快照、告警/报告预览下载，以及租约控制的按键与失焦停止。验收中不得连接真实车辆。
4. 只有获得单独批准后，才可回到阶段 1.5：在 Jetson 恢复 ROS 运行时并冻结导航
   架构。没有对 Jetson 软件安装、ROS 节点启动或底盘测试的批准时，只可读取；不得
   发送导航目标。

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
- 2026-07-13 已完成网页控制台和平台业务收口：控制入口统一由租约约束，路线与识别规则可配置并按任务快照执行。该改动**不包含** ROS/Nav2 scheduler、Jetson 恢复或真实车辆动作；自动巡检和上门处置的真车边界不变。
- 本次 workspace 单元测试、typecheck 和 build 已通过；PostGIS 集成测试因当前环境
  没有 Docker/Testcontainers runtime 而跳过 15 项，不能作为 migration 011 或部署验证证据。

## When this handoff is finished

只有阶段 1 真实环境清单完成并确认急停与静止验证条件后，才能把本文件目标
更新为阶段 2 ROS 适配器实现。不要删除历史评审和实施计划。
