# 产品规格导航

`specs/` 保存需求、数据模型、契约、研究和任务分解；它们描述产品范围，不能替代
`tasks/` 中的实际交付状态。

| 规格 | 覆盖范围 | 主要入口 |
| --- | --- | --- |
| [`001-web-control-gateway/`](001-web-control-gateway/) | 本机 WebSocket 控制、TCP 编码与安全边界 | [`spec.md`](001-web-control-gateway/spec.md)、[`quickstart.md`](001-web-control-gateway/quickstart.md)、[`contracts/websocket-control-api.md`](001-web-control-gateway/contracts/websocket-control-api.md) |
| [`002-vehicle-fleet-platform/`](002-vehicle-fleet-platform/) | 车辆管理、轨迹、账号、租约与平台 MVP | [`spec.md`](002-vehicle-fleet-platform/spec.md)、[`data-model.md`](002-vehicle-fleet-platform/data-model.md) |
| [`003-patrol-inspection/`](003-patrol-inspection/) | 巡检、白名单、识别、审核与上门处置 API | [`spec.md`](003-patrol-inspection/spec.md)、[`contracts/patrol-api.md`](003-patrol-inspection/contracts/patrol-api.md)、[`quickstart.md`](003-patrol-inspection/quickstart.md) |

新功能应在对应规格目录补齐需求和契约；若没有适用规格，先建立新的编号目录，避免把
需求散落到变更报告或课程材料中。
