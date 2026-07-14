# Web 关键安全问题修复记录

日期：2026-07-14

## 来源

用户批准的“Web 项目关键安全问题修复方案”。

## 已实现

- 地图航点按管理员或 `vehicle_members` 过滤；越权路线返回 403。
- AI 顾问仅向管理员注册全局白名单工具，底层查询再次校验角色。
- 本地证据下载必须关联到巡检事件、观测、违规或上门任务，并按车辆授权；未关联或越权统一返回 404。
- 登录、OTP 申请和 OTP 验证加入按规范化用户名的路由限流及 429/Retry-After 响应。
- migration `016-auth-otp-attempt-limit` 增加 `auth_otps.failed_attempts`；OTP 第五次失败原子消费，并发成功验证只允许一次。
- Nodemailer 从 6.10.1 升级至 9.0.3；新增与 Fastify 5 兼容的 `@fastify/rate-limit` 11.1.0。
- Compose 的受控 Nginx 覆盖转发客户端 IP，backend 仅在 `PLATFORM_TRUST_PROXY=true` 时信任该单跳代理；本地直连默认不信任转发头。
- 认证端点超限先标记请求，再由错误处理器在返回 429 前等待写入 `throttled` 审计；写入故障不改变 429 响应。
- 历史违规缺少直接车辆字段时，证据授权按任务、事件所属任务回退解析车辆；不新增数据库迁移。

## 验证

- `npm test`：通过（shared 5、gateway 17、frontend 30、backend 53）。
- `npm run typecheck`：通过。
- `npm run build`：通过；仅保留既有前端 chunk 大小提示。
- `npm run typecheck:integration --workspace=@oh-ai-car-web/backend`：通过。
- `npm audit --json` 与 `npm audit --omit=dev --json`：均为 0 个漏洞。
- `npm run test:integration --workspace=@oh-ai-car-web/backend`：通过（PostGIS 20/20），覆盖 migration 016、车辆级地图/证据授权、OTP 五次失败失效、并发单次消费与认证限流。
- `npm run test:deploy-live`：通过；Docker Compose 完整构建并启动 Web、backend 和 PostGIS，前端 HTML、登录、车辆创建及认证/未认证 WebSocket 冒烟验证成功，临时容器和卷已清理。

## 部署与风险

- 未对目标数据库执行迁移或部署；migration 016 已在临时 PostGIS 集成环境验证通过，仍需随正常部署流程应用到目标环境。
- 路由限流使用单 backend 进程内存存储，符合当前单实例 Docker Compose；若扩展为多实例，需要切换到共享 Redis/custom store。
- 未改变 TCP 编码、真实车辆控制、ROS/Nav2 或巡检状态机。
