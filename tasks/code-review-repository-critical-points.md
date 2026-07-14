# 仓库关键点全面审查

日期：2026-07-12

范围：`backend/`、`gateway/`、`frontend/`、`edge-agent/`、部署配置、数据库迁移与现有自动化测试。未连接真实小车、Neon 或外部 AI 服务。

初始结论：**Blocked for production deployment and ROS response-scheduler rollout**。

## 修复复审（2026-07-12）

五项软件门禁已在当前工作区完成修复并通过类型检查、workspace 测试、生产构建、
10 项 PostGIS 集成测试及 Docker/Nginx 认证 WebSocket 冒烟验证。结论更新为：
**Approved with Notes for production configuration review and stage 1 discovery**。

这不批准 ROS response scheduler、Nav2 自主导航或真实车辆运动。生产发布仍必须
实际配置 HTTPS、强会话密钥和安全 Cookie；真车仍必须完成阶段 1–4 的独立证据。

## 已解决 P1：生产反向代理遗漏上门处置实时通道

`frontend/src/services/responseClient.ts` 使用 `/patrol/live` 建立 WebSocket，
但 `deploy/nginx.conf` 仅代理 `/ws`，没有将 `/patrol/live` 升级并转发给
backend。Docker/Nginx 部署下，该请求会落入静态站点路由，导致上门处置状态、
车辆分配和取消状态不能实时刷新。

处理结果：已增加专用 `/patrol/live` WebSocket 代理和 `npm run test:deploy-live`。
该脚本在独立 Compose 项目中登录、订阅授权车辆并确认未认证连接以 1008 关闭。

## 已解决 P1：生产会话安全依赖人工环境变量，代码未强制失败

`backend/src/config.ts` 在未设置 `SESSION_SECRET` 时使用固定开发默认值，
并允许 `COOKIE_SECURE=false`；生产环境只强制 `PLATFORM_PUBLIC_ORIGIN`。
虽然 Compose 和部署文档要求配置强随机密钥与 HTTPS，这些配置遗漏时服务仍可
启动并签发可预测或可经明文传输的会话。

处理结果：生产模式拒绝默认或短于 32 字符的会话密钥、非安全 Cookie 和缺失
public origin；拒绝路径已由单元测试覆盖。

## 已解决 P1：单车降级分配绕过可用性门禁

`backend/src/routes/response-platform.ts` 的 `assignVehicle()` 对源巡检车
使用 `v.id=$1 OR ...`，从而绕过地图版本、在线心跳和电量不低于 20% 的筛选。
人工确认后可将离线、低电量或地图不匹配的源车标为 `assigned`。当前没有 ROS
scheduler，因此不会自动移动；但部署 scheduler 后会造成任务卡住或把不安全车
推入执行链路。

处理结果：源车仅可绕过“当前巡检仍活动”条件；地图版本、两分钟在线状态和
实际电量不低于 20% 对所有候选车辆均强制执行。集成测试覆盖低电量、地图不匹配、
离线源车保留 `confirmed`，以及健康备用车的分配。

## 已解决 P2：迁移不适合多副本并发启动

`backend/src/db/index.ts` 以“查询版本—执行 SQL—插入版本”的非事务序列运行
migration。两个 backend 副本同时首次启动时可能同时执行 `ALTER TABLE` 或
`CREATE INDEX`，而版本行的 `ON CONFLICT` 只能防止最后的记录冲突。

处理结果：migration 使用同一 PostgreSQL 会话的 advisory lock；每个 migration SQL
和版本记录在同一事务中完成。集成启动同时调用两个 migrator，确认八个版本均只记录一次。

## 已解决 P2：WebSocket 未复用 HTTP 的 Origin 策略

`/ws` 与 `/patrol/live` 现在在认证前复用受信 Origin 集合；不受信或缺失 Origin
以 policy code 1008 关闭。两个入口的受信、不受信及缺失 Origin 握手均有测试覆盖。

## 验证与覆盖缺口

- 已验证：类型检查、workspace 单元测试、生产构建、10 项临时 PostGIS 集成测试、
  Nginx `/patrol/live` 认证握手、生产配置拒绝路径、并发 migration、WebSocket Origin。
- 缺失：edge-agent outbox、ROS/Nav2 取消与零速度、真实 TCP/视频/急停。
- 未实现：ROS response scheduler、Nav2 巡检暂停/恢复、到达照片生产和真车验证。

## 建议处置顺序

1. 在生产环境实际配置 HTTPS、32 字符以上独立会话密钥和 `COOKIE_SECURE=true`。
2. 执行阶段 1 真车只读发现；不发送导航或速度指令。
3. 阶段 2 前补齐 edge-agent outbox 和 ROS/Nav2 取消、零速度与恢复巡检验证。
