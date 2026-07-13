# Web 业务闭环与控制台优化计划

## 已批准并实施

- 平台控制统一使用登录、租约和本地网关；移除公开旧控制入口。
- 控制台采用对齐十字方向区，并支持方向键按下移动、松开/失焦停止。
- 修复告警、设备状态、报告预览下载、路线 YAML 导入、规则任务快照和管理员页面。

## 延期项：不在本次处理

- ROS/Nav2 patrol scheduler 与上门处置 scheduler。
- Jetson 运行时恢复、导航目标下发、到达照片、零速度真车验证。
- `Front` TCP 报文冲突的物理车辆确认。

这些项继续受 `NEXT_SESSION.md`、`PROTOCOL_STATUS.md` 与
`tasks/real-car-doorstep-integration-plan.md` 的门禁约束。网页 API、模拟测试或
Fake TCP 结果不构成真车闭环证据。

## 收口后的下一步

先在具备 Docker/Testcontainers runtime 的环境补跑后端集成测试；通过后再按部署流程
应用 migration 011，并在不连接真实车辆的前提下完成人工浏览器验收。具体执行顺序和
真车边界以 `NEXT_SESSION.md` 为准。
