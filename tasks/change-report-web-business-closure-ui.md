# Web 业务闭环与控制台优化变更记录

## 来源

用户批准的“Web 端业务闭环与控制台优化计划”。

## 变更

- 删除公开 `/connect`、`/remote` 和未路由旧控制台；gateway 必须配置平台地址以验证租约。
- 方向控制改为显式十字布局，支持键盘控制与停止保护。
- 修复工作台告警契约、设备在线/巡检状态、报告 HTML/CSV 预览下载和登录页假数据。
- 管理员可导入 YAML 路线、配置任务规则快照、管理用户并查看审计日志。

## 未包含

未部署或实现 ROS/Nav2 scheduler，未触发任何真实车辆控制或导航动作。

## 验证

- 已通过 `npm test`、`npm run typecheck` 与 `npm run build`。
- `npm run test:integration --workspace=@oh-ai-car-web/backend` 未能执行：当前环境没有可用 Docker/Testcontainers runtime，15 项 PostGIS 集成测试被跳过；上线前必须在具备 Docker 的环境补跑。

## 后续任务

1. 在 Docker/Testcontainers 可用的环境补跑后端集成测试，并覆盖 migration 011、路线
   YAML 导入和规则快照的持久化/隔离。
2. 集成测试通过后，按目标环境的数据库发布流程应用
   `011-patrol-rule-snapshots`；核验规则快照字段与路线唯一索引。
3. 使用真实平台服务进行浏览器人工验收：登录、管理员配置、巡检、报告和租约控制的
   键盘/失焦停止。该验收不得连接或驱动真实车辆。
4. ROS/Nav2 scheduler、Jetson 恢复和物理车辆验证仍是独立审批事项，详见
   `NEXT_SESSION.md` 与 `tasks/real-car-doorstep-integration-plan.md`。
