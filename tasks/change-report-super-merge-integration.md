# Super 分支合并变更报告

## 范围

将 `origin/super`（YOLO 识别、GPS 遥测、设备管理、地图定位和本机视频抓帧）合并到
`main`，同时保留当前分支的生产安全门禁、全局白名单、巡检规则快照和租约控制边界。

## 数据库决策

- `011-patrol-event-details` 使用远端内容：事件 `details`、`waypoint_id` 和路线 `code`。
- 当前分支的巡检规则快照顺延为幂等的 `012-patrol-rule-snapshots`。
- 保留 PostgreSQL advisory lock 与逐迁移事务；不得通过修改既有
  `schema_migrations` 记录替代迁移。

## 控制安全决策

- Probe 必须验证平台租约，且目标必须与租约车辆完全一致。
- TCP 意外断开后不重连、不重发运动命令。
- 控制台显示设备档案地址，不提供临时地址覆盖。
- 视频抓帧只允许已连接车辆；从视频页面提取的流 URL 也必须保持同一 host/port。

## 验证

- `npm run typecheck`：通过。
- `npm test`：通过（shared 5、gateway 17、frontend 26、backend 20）。
- `npm run build`：通过。
- `python3 edge-agent/tests/test_plate_adapter.py`：通过。
- `python3 edge-agent/tests/test_platform_hook_mapping.py`：通过，3 项因缺少外部 YOLO 权重/仓库而跳过。
- PostGIS 集成测试未执行：当前环境没有可用 Testcontainers 容器运行时，16 项测试跳过后失败。

## 未验证边界

- 未部署 migration 011/012，未修改任何外部数据库。
- 未运行 Jetson SSH、Docker 或部署脚本。
- Fake TCP、视频抓帧和单元测试不证明真实车辆协议、摄像头流或 YOLO 识别准确度。
