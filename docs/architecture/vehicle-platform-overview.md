# 智能小车 Web 平台：项目与后端导览

这份文档用于快速理解仓库当前实现的“本机控车 v1 + 车辆管理平台 MVP + 巡检任务闭环”。先读本页，再按需进入[部署说明](../deployment/vehicle-platform.md)、[平台规格](../../specs/002-vehicle-fleet-platform/spec.md)、[巡检规格](../../specs/003-patrol-inspection/spec.md)和[变更记录](../../tasks/change-report-patrol-inspection.md)。

## 先看全貌

项目有两条可独立使用、但可组合的链路：

```text
兼容 v1：浏览器 ─WebSocket→ 本机 Node 网关 ─TCP→ 小车

平台模式：浏览器 ─HTTP/WS→ Nginx ─→ Fastify 后端 ─→ PostgreSQL/PostGIS
                         │                 ↑
                         └── ROS2 边缘代理 ┘
                                      /gps/fix

平台控车：浏览器 ─租约令牌→ 本机 Node 网关 ─TCP→ 小车

巡检模式：浏览器 ─任务→ Fastify ─设备凭据→ patrol_scheduler ─Nav2→ 小车
                                      ↑
                           航点、识别、状态事件
```

- `frontend/` 是 React/Vite 页面。默认仍渲染原来的本机控制台；只有在构建时设置 `VITE_PLATFORM_ENABLED=true` 才显示平台登录、车辆、地图、巡检和审计界面。
- `gateway/` 必须运行在操作员电脑上，仍只监听 `127.0.0.1:8787`。它是浏览器高层指令与小车 TCP 指令之间唯一的边界，浏览器不能发送原始 TCP 报文。
- `backend/` 是平台后端，默认监听 `127.0.0.1:8788`。它不直接连小车；职责是账号、车辆档案、授权、控制租约、GPS 轨迹和审计。
- `edge-agent/` 运行在小车或其伴随计算机，订阅 ROS2 `/gps/fix`，将 GPS 数据批量上报到后端。
- Docker Compose 部署时，Nginx 对外提供页面和 API，PostgreSQL/PostGIS 保存平台数据。本机网关不放进容器，也绝不对公网开放。

## 后端负责什么

Fastify 应用入口是 `backend/src/app.ts`；启动时 `backend/src/index.ts` 会执行迁移、按环境变量创建首个管理员，并启动过期数据清理。

| 能力 | 后端行为 | 主要数据 |
| --- | --- | --- |
| 登录与角色 | 管理员创建账号；所有活跃账号可使用 Argon2 密码登录，已绑定邮箱的管理员还可通过后端 SMTP 接收一次性验证码；签名 Cookie 保存 8 小时会话 | `users`、`auth_otps` |
| 车辆档案 | 保存车辆名称、编号、TCP 主机/端口、视频端口及成员授权 | `vehicles`、`vehicle_members` |
| 控制权 | 每辆车同一时刻只允许一个有效租约；租约有效期 60 秒，页面每 20 秒续期 | `control_leases` |
| GPS | 设备令牌验证后批量写入 WGS-84 轨迹点；同车同采集时间重复上报会忽略 | `device_credentials`、`telemetry_points` |
| 实时更新 | GPS 成功写入后向已授权的 `/ws` 订阅者推送 `vehicle.position` | 内存订阅表 |
| 巡检任务 | 路线 YAML、全局白名单 CSV、单车单活动任务、调度事件、车牌证据与 HTML 报告 | `patrol_*`、`whitelist_*`、`plate_observations` |
| 审计与保留 | 记录登录、车辆、设备令牌、租约操作；每 6 小时清理 90 天前轨迹和 1 年前审计 | `audit_logs` |

数据库 DDL 位于 `backend/src/db/schema.ts`。虽然数据库启用了 PostGIS 扩展，MVP 当前按经纬度字段和时间索引查询轨迹，尚未使用空间几何列。

平台只接受 `PLATFORM_PUBLIC_ORIGIN` 和 `PLATFORM_ALLOWED_ORIGINS` 中的浏览器 Origin。带 Cookie 的 `POST`、`PATCH`、`PUT`、`DELETE` 请求会再次校验 Origin；GPS 设备上报和本机网关租约校验则分别使用设备凭据和租约令牌，不依赖浏览器 Cookie。

## 后端 API 索引

前端和网关使用以下接口；除设备和内部校验接口外，均通过登录 Cookie 鉴权。

| 接口 | 调用者 | 用途 |
| --- | --- | --- |
| `POST /api/auth/login`、`POST /api/auth/logout`、`GET /api/auth/me` | 浏览器 | 创建、清除和读取登录会话 |
| `GET/POST/PATCH /api/users...` | 管理员 | 列出、创建、启停账号 |
| `GET/POST/PATCH /api/vehicles...` | 管理员/操作员 | 查询已授权车辆；管理员创建和更新档案 |
| `PUT /api/vehicles/:id/members` | 管理员 | 用用户 ID 列表整体覆盖车辆成员授权 |
| `POST /api/vehicles/:id/device-credentials` | 管理员 | 轮换设备令牌；返回值只在本次调用中展示 |
| `POST /api/vehicles/:id/control-lease` | 操作员 | 获取或延长自己的控制租约与网关令牌 |
| `POST/DELETE /api/control-leases/:id...` | 操作员 | 续约或主动释放控制权 |
| `GET /api/vehicles/:id/track` | 已授权用户 | 按 `from`/`to` 时间范围查询轨迹；省略时为最近 24 小时 |
| `GET /api/audit-logs` | 管理员 | 读取最近 200 条审计记录 |
| `GET/POST/PUT/DELETE /api/whitelist...`、`POST /api/whitelist/import` | 管理员 | 维护所有巡检车共享的全局白名单；任务启动时复制为不可变快照 |
| `POST /device/v1/telemetry` | 边缘代理 | 使用 `Authorization: Bearer <credential>` 批量上报点位 |
| `/api/vehicles/:id/patrol-routes` | 管理员/已授权用户 | 管理员导入路线 YAML；已授权用户读取路线与航点 |
| `/api/vehicles/:id/patrol-tasks...` | 已授权用户 | 创建、启动、停止、查看任务与下载 HTML 报告；启动前须安全断开本机网关并释放有效人工控制租约 |
| `/device/v1/patrol/tasks/next`、`.../events` | 巡检调度器 | 凭车辆设备令据领取任务，上报航点、状态与识别记录 |
| `POST /internal/control-lease/verify` | 本机网关 | 验证租约令牌、车辆和当前连接目标 |
| `GET /ws` | 已授权浏览器 | 建连后发送 `{"type":"subscribe","vehicleId":"..."}`，接收实时位置 |

管理员接口已经由后端提供；当前 MVP 页面主要展示用户、车辆和审计信息，批量成员授权、账号创建和设备令牌轮换可先通过上述管理员 API 完成。

## 巡检任务与识别链路

1. 管理员导入导航组维护的 YAML 路线。每条路线有 3-8 个固定航点、8-10 秒停留时间和可选的相机画面禁停 ROI；历史路线不被改写。
2. 管理员导入小区全局白名单（车牌、车主、楼栋、车位、类型和可选有效期）。所有巡检车使用同一份 live 白名单；创建任务时固定复制为不可变快照。
3. 操作员启动草稿任务前，后端在同一车辆锁定事务中检查有效人工控制租约；如存在则返回 409，任务保持 `draft`，操作员必须安全断开本机网关并释放租约。检查通过后任务才进入 `queued`；小车端 `patrol_scheduler` 使用已有设备凭据领取任务后进入 `running`，并按 Nav2 航点顺序导航。
4. 调度器上报航点到达和识别事件。置信度低于 0.75 或无有效车牌为待复核；其余记录按白名单判为登记私家车、访客或疑似外来。相同任务、车牌、航点和 30 分钟窗口内的记录会合并。
5. 禁停只按固定航点的相机 ROI 与车辆检测框相交判定，不把未标定的 GPS 当作禁停围栏。任务详情与 HTML 报告保留识别证据和处置统计。

操作员停止任务时，后台进入 `cancellation_requested`，并继续阻止人工平台连接。调度器必须轮询活动任务、取消 Nav2 目标并确认零速度，再回传 `stop_confirmed`；后台才写入 `stopped`，页面才允许人工连接。现有本机 TCP 网关不会替代此 ROS 侧停车确认；即使协议确认已实现，真车使用前仍必须完成实测。

## 一次“平台控车”如何发生

1. 操作员登录平台，后端在 HttpOnly Cookie 中保存签名会话。
2. 前端只读取该操作员被授权的车辆档案，得到已保存的 TCP 和视频配置。
3. 操作员点击连接。前端请求 `POST /api/vehicles/:id/control-lease`，后端在事务中拒绝其他用户的有效租约，或签发/延长自己的 60 秒租约。
4. 前端先以车辆 ID、租约令牌与保存的连接配置请求 probe；网关只探测与租约完全一致的目标，且 probe 不占用控制会话。
5. 前端仅在 probe 可达后把相同配置提交给本机 `ws://127.0.0.1:8787/control` 网关。网关必须设置 `PLATFORM_API_URL` 并调用后端 `/internal/control-lease/verify`；只有令牌、用户、车辆、未过期租约及连接配置完全一致，且该车没有活动或待确认停止的巡检任务时，网关才允许 TCP 连接。
6. 前端每 20 秒续约，并把新令牌以 `leaseRefresh` 更新给网关。更新失败或租约到期时，网关沿用既有安全路径：先尝试发送 Stop，再关闭 TCP。TCP 意外断开时，网关不会自动重连或重发运动命令，操作员必须重新连接。

这套机制不会改变当前已知但尚未真车确认的小车 TCP 编码。有关协议风险请始终查看 [PROTOCOL_STATUS.md](../../PROTOCOL_STATUS.md)。

## GPS 与高德地图链路

1. `edge-agent/telemetry_agent.py` 接收 `sensor_msgs/NavSatFix`。无效经纬度会被丢弃；高度和定位协方差会作为可选字段上报。
2. 边缘代理先写入本地 SQLite outbox，再以设备 Bearer 凭据调用 `POST /device/v1/telemetry`；网络失败时保留队列，恢复后按采集时间补传。
3. 后端写入轨迹并推送最新点。前端进入车辆地图时先查询最近 24 小时历史数据，再订阅实时位置事件。
4. GPS 原始数据以 WGS-84 保存；前端在显示前调用高德 `AMap.convertFrom(..., 'gps')` 转为 GCJ-02。转换失败时不绘制可能错位的轨迹。
5. 高德的 `securityJsCode` 不进入前端包，由 Nginx `/_AMapService` 代理附加；Web Key 作为受域名限制的前端构建参数提供。

全局运营地图还会绘制禁停区、航点、违规点及选中车辆轨迹。浏览器定位不可用时回退到配置的默认中心；动态车牌和航点标签通过 DOM `textContent` 创建，不插入动态 HTML。

速度、航向、电量和工作模式在 API 中是可选字段。当前 ROS2 `NavSatFix` 代理实际提供坐标、高度和由协方差计算的精度；其他字段需要未来接入相应 ROS2 话题后才会有值。

## 本地开发和部署顺序

### 只运行原本机控制台

```sh
npm install
npm run dev:gateway
npm run dev:frontend
```

此模式不需要后端、数据库或 GPS，行为与 v1 一致。

### 开发平台界面和 API

1. 启动一个可用的 PostgreSQL/PostGIS 实例，并设置 `DATABASE_URL`、`SESSION_SECRET`、`BOOTSTRAP_ADMIN_USERNAME`、`BOOTSTRAP_ADMIN_PASSWORD`。
2. 在一个终端运行 `npm run dev:backend`；首次启动会迁移数据库。
3. 以 `VITE_PLATFORM_ENABLED=true npm run dev:frontend` 启动前端。Vite 已将 `/api` 和 `/ws` 代理到 `127.0.0.1:8788`。
4. 在操作员机器上，以 `PLATFORM_API_URL=http://127.0.0.1:8788 npm run dev:gateway` 启动本机网关。
5. 配置高德 Key 和 ROS2 边缘代理后，才可以看到真实底图与实时轨迹。

面向统一服务器的 Docker 配置、环境变量与 ROS2 命令见[部署说明](../deployment/vehicle-platform.md)。生产环境必须使用 HTTPS、强随机密钥、`COOKIE_SECURE=true` 和外部备份策略。

## 当前边界与尚未验证项

- 已通过 TypeScript 构建和自动化测试的是代码逻辑；尚未启动 Docker Compose、验证真实 PostgreSQL/AMap/ROS2 或连接真实小车。
- 后端包含 `npm run test:integration --workspace=@oh-ai-car-web/backend` 的 PostGIS 集成测试。PostgreSQL 镜像初始化会短暂启动一次再退出；测试等待第二次就绪日志后执行，已验证路线、任务领取、ROI、白名单分类、30 分钟去重、停止确认、双向租约互锁和并发启动。
- 巡检车的 Nav2、OCR、停止确认和真车安全接管仍需独立实测并记录。
- 巡检看板目前通过刷新读取任务事件和识别记录，尚未把这些事件推送到浏览器 WebSocket；它不能作为实时进度已验证的证据。
- 浏览器加载视频页面不代表小车视频流健康；TCP 写成功也不代表小车已执行指令。
- 平台不做公网 TCP 转发、SLAM 局部坐标到经纬度标定、电子围栏或告警中心。
- 课程状态文档不因本平台代码而自动变为“已验证”。真车实验仍必须按[真实车辆验证流程](../flows/web-control-real-car-validation.md)留存证据。
