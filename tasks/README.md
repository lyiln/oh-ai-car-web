# 实施、评审与交接导航

`tasks/` 记录已经发生的实施、审查和交接，不是产品规格目录。当前工作优先看“当前”
部分；其余变更报告保留为可追溯历史。

## 当前

| 文档 | 作用 |
| --- | --- |
| [`real-car-doorstep-integration-plan.md`](real-car-doorstep-integration-plan.md) | 上门处置接入真实小车的阶段计划；阶段 1 已发现运行时阻断，下一步须获批后执行阶段 1.5。 |
| [`code-review-repository-critical-points.md`](code-review-repository-critical-points.md) | 仓库级部署与安全阻断项；生产/ROS scheduler 前必须处理。 |
| [`code-review-doorstep-response.md`](code-review-doorstep-response.md) | 上门处置 Web 阶段评审与已知外部边界。 |
| [`change-report-doorstep-response.md`](change-report-doorstep-response.md) | migrations 007–008 和 Web 阶段 0 的实现、回归证据。 |
| [`web-business-closure-and-ui-plan.md`](web-business-closure-and-ui-plan.md) | 本次网页业务闭环范围与明确延期的 ROS/真车边界。 |
| [`change-report-web-business-closure-ui.md`](change-report-web-business-closure-ui.md) | 控制台、平台契约和管理端收口记录。 |

## 历史变更记录

- 本机控制与安全边界：[`change-report-web-control-v1.md`](change-report-web-control-v1.md)、[`change-report-gateway-safety-hardening.md`](change-report-gateway-safety-hardening.md)、[`change-report-control-ownership-and-course-readiness.md`](change-report-control-ownership-and-course-readiness.md)。
- 平台与巡检演进：[`vehicle-fleet-platform-mvp-plan.md`](vehicle-fleet-platform-mvp-plan.md)、[`change-report-vehicle-fleet-platform-mvp.md`](change-report-vehicle-fleet-platform-mvp.md)、[`change-report-patrol-inspection.md`](change-report-patrol-inspection.md)、[`change-report-patrol-p1-bugfixes.md`](change-report-patrol-p1-bugfixes.md)、[`change-report-whitelist-import-locking.md`](change-report-whitelist-import-locking.md)、[`change-report-patrol-platform-merge-fixes.md`](change-report-patrol-platform-merge-fixes.md)。
- 2026-07-12 合并与安全修复：[`change-report-super-merge-security-fixes.md`](change-report-super-merge-security-fixes.md)。
- 仓库与课程资料：[`change-report-self-contained-repository.md`](change-report-self-contained-repository.md)、[`change-report-course-delivery-documentation.md`](change-report-course-delivery-documentation.md)。

新增记录命名为 `change-report-<topic>.md`、`code-review-<topic>.md` 或
`<topic>-plan.md`；在写入前先判断它是否属于当前工作，避免把短期诊断当作长期计划。
