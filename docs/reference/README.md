# 参考证据导航

本目录保存外部 OpenHarmony/ROS 资料的只读摘录和分析。它们可用于追溯协议证据，
但不得成为本仓库的运行时导入、构建依赖或必需本地路径。

| 类别 | 内容 |
| --- | --- |
| [`architecture/`](architecture/) | 原项目结构和实现边界分析。 |
| [`protocol/`](protocol/) | TCP 编码与 ROS API 原始证据；与当前实现冲突时以 [`../../PROTOCOL_STATUS.md`](../../PROTOCOL_STATUS.md) 为安全入口。 |
| [`planning/`](planning/) | 早期任务拆分的保留快照。 |
| [`source-provenance.md`](source-provenance.md) | 参考资料来源与使用边界。 |

任何真车观察都应写入 [`../flows/web-control-real-car-validation.md`](../flows/web-control-real-car-validation.md)，
不要直接改写这里的历史证据。
