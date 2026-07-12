# 文档导航

本目录保存面向使用、部署、课程交付和历史证据的项目文档。产品需求在
[`../specs/README.md`](../specs/README.md)，实施计划、评审和变更记录在
[`../tasks/README.md`](../tasks/README.md)；三类资料各自负责，不互相替代。

## 当前工作入口

| 目的 | 先读文档 |
| --- | --- |
| 日常开发与安全规则 | [`../AGENTS.md`](../AGENTS.md)、[`../AI_CONTEXT.md`](../AI_CONTEXT.md) |
| 恢复当前工作 | [`../NEXT_SESSION.md`](../NEXT_SESSION.md)（仅在存在活跃交接时） |
| 上门处置与真实小车 | [`../tasks/real-car-doorstep-integration-plan.md`](../tasks/real-car-doorstep-integration-plan.md)、[`flows/web-control-real-car-validation.md`](flows/web-control-real-car-validation.md)、[`flows/jetson-stage1-readonly-runbook.md`](flows/jetson-stage1-readonly-runbook.md) |
| 协议冲突 | [`../PROTOCOL_STATUS.md`](../PROTOCOL_STATUS.md)、[`decisions/protocol-length-discrepancy.md`](decisions/protocol-length-discrepancy.md) |
| 课程交付 | [`../课程状态.md`](../课程状态.md)、[`course/课程文档索引.md`](course/课程文档索引.md) |

## 按用途查找

| 类别 | 内容 |
| --- | --- |
| [`architecture/`](architecture/) | Web 控制边界、平台导览和 API 契约。小车接入前先读 [`architecture/jetson-yahboom-x3-environment-baseline.md`](architecture/jetson-yahboom-x3-environment-baseline.md)。 |
| [`deployment/`](deployment/) | 平台环境变量、Compose 与边缘代理部署。 |
| [`flows/`](flows/) | 可执行的验证记录；当前真实小车验证尚未完成。 |
| [`decisions/`](decisions/) | 已记录的技术决策与协议证据结论。 |
| [`course/`](course/) | 五人小组课程要求、证据矩阵、答辩与提交物。 |
| [`reference/`](reference/README.md) | 外部源码和原始资料的只读证据，不是运行依赖。 |

## 维护规则

- 行为、接口或安全边界变更：同步更新 `architecture/`、相关 `specs/` 与 `tasks/` 记录。
- 真车原始观察先写入 `flows/web-control-real-car-validation.md`；供本机开发使用的已验证接口摘要可同步到 `architecture/` 基线文档。Fake TCP 或 iframe 加载不能替代实测。
- 已完成的实施与评审：保留在 `tasks/`，由索引标记为历史记录，不删除或改写证据。
