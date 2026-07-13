# 巡牌通 · PatrolPlate 平台 API 契约

品牌：**巡牌通 · PatrolPlate**。登录页见现有 `/api/auth/*`。本文描述管理端业务 API（migration 003–010）。

## 认证

所有 `/api/*`（除 `/device/v1/*`、`/internal/*`）需已登录会话 Cookie `oh_ai_session`，且请求 Origin 受信任。密码登录适用于活跃账号；邮箱 OTP 仅对已绑定邮箱的管理员可用。验证码只在后端生成、哈希存储并经 SMTP 投递，API 不返回验证码或收件地址。

## 设备 `/api/devices`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/devices` | 设备列表（映射 `vehicles`）；可选 `?q=` 按名称/编号/IP/备注模糊搜索 |
| POST | `/api/devices` | 管理员创建 |
| PUT | `/api/devices/:id` | 管理员更新（名称、IP、端口、Bridge、备注；编号不可改） |
| DELETE | `/api/devices/:id` | 软删除（archived）；仅管理员 |
| POST | `/api/devices/:id/connect` | 申请 control lease |
| GET | `/api/devices/:id/status` | 在线/租约状态 |
| GET | `/api/devices/:id/pose` | 最新 GPS 点 |

兼容：原有 `/api/vehicles*` 仍可用。

## 工作台

| 方法 | 路径 |
|------|------|
| GET | `/api/dashboard/summary` |

返回：`onlineDevices`、`todayPatrols`、`pendingReviews`、`violations`、`recentTasks`、`todayAlerts`。

## 巡检 `/api/patrol`

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/patrol/start` | 启动任务；白名单为空时 409 |
| POST | `/api/patrol/stop` | 停止任务 |
| GET | `/api/patrol/status` | 当前状态 |
| GET | `/api/patrol/tasks` | 任务列表 |
| GET | `/api/patrol/tasks/:id` | 任务详情 |
| GET | `/api/patrol/tasks/:id/events` | 生命周期事件与去重后的车牌观测 |
| GET | `/api/patrol/tasks/:id/report` | 任务结束后生成 FR-007 报告（HTML + CSV，含任务元数据、证据表和物业跟进清单） |
| GET | `/api/patrol/routes` | 路线；空时种子 `route_morning_a` |

## 地图 `/api/map`

| 方法 | 路径 |
|------|------|
| GET | `/api/map` |
| GET | `/api/map/waypoints` |
| GET/POST | `/api/map/zones` |
| PUT/DELETE | `/api/map/zones/:id` |

禁停区使用 PostGIS `geometry(Polygon,4326)`，API 返回坐标环。

设备侧使用 `/device/v1/patrol/tasks/:id/events` 发送 `observation`。观测必须属于
任务快照路线中的航点；低于 0.75 的置信度进入待复核，其余车牌使用任务快照的白名单分类；
同一任务、航点、车牌和 30 分钟窗口会合并计数，禁停 ROI 相交独立记录。

**白名单快照隔离（FR-002）**：白名单是小区全局数据，只有管理员可读取、导入或修改。首次创建与写入在事务级 advisory lock 下串行；批量导入的有效行在一个事务中提交。任务启动在持锁事务内将当前全局 live 白名单复制为不可变快照（`whitelist_imports.is_snapshot=true`）。因此任务只会看到完整的导入前或导入后版本，后续导入只影响下一次巡检，不影响正在运行任务的分类。

**待复核流程（FR-005）**：置信度 < 0.75 的首次观测（去重后计数为 1）除写入 `plate_observations` 外，还以事务方式同步写入 `patrol_events`（event_type='observation'）和 `reviews`（reason='low_confidence'，status='pending'），确保 `GET /api/reviews/pending` 立即可见。

## 违规与审核

| 方法 | 路径 |
|------|------|
| GET | `/api/violations` |
| GET | `/api/violations/:event_id` |
| GET | `/api/reviews/pending` |
| POST | `/api/reviews/:event_id/resolve` |

管理员可访问所有车辆；操作员只能读取或处理 `vehicle_members` 授权车辆的违规、审核、报告和工作台统计。无权的单条违规或报告返回 404。审核中只有管理员可选择 `whitelist`，该操作才会写入全局白名单；操作员仍可处理其授权车辆的其他审核结果。

违规列表与详情额外返回：

- `longitude` / `latitude`：优先观测直传，否则用巡检车在 `occurred_at` ±60s 内最近遥测点回填
- `coordinateSource`：`observation` | `telemetry` | `none`
- `ownerName` / `building` / `parkingSpot` / `confidence`：来自任务白名单快照与观测

详见 [乱停车违停定位说明](../flows/illegal-parking-localization.md)。

违规列表与详情额外返回：

- `longitude` / `latitude`：优先观测直传，否则用巡检车在 `occurred_at` ±60s 内最近遥测点回填
- `coordinateSource`：`observation` | `telemetry` | `none`
- `ownerName` / `building` / `parkingSpot` / `confidence`：来自任务白名单快照与观测

详见 [乱停车违停定位说明](../flows/illegal-parking-localization.md)。

## 白名单 / 报告 / 设置

| 方法 | 路径 |
|------|------|
| GET | `/api/whitelist?q=:query`（管理员） |
| GET/PUT/DELETE | `/api/whitelist/:id`（管理员） |
| POST | `/api/whitelist`（管理员） |
| POST | `/api/whitelist/import`（管理员） |
| GET | `/api/reports` · `/api/reports/:id` |
| GET/PUT | `/api/settings` |

## 乱停车上门处置

- 管理员通过 `GET/POST /api/resident-destinations` 和 `PUT /api/resident-destinations/:id` 维护楼栋一层公共门口的 Nav2 `x/y/yaw` 与地图版本。
- 带证据的禁停 observation 只有在置信度不低于 0.75、命中登记私家车且存在启用目的地时，才创建 `pending_review` 处置候选。
- 操作员通过 `POST /api/response-tasks/:id/confirm` 人工确认；后端生成 AI 或模板建议并尝试选择安全可用车辆。没有车辆时任务保留为 `confirmed`，可通过幂等的 `POST /api/response-tasks/:id/assign` 重试。`GET /api/response-tasks` 返回有权限车辆的处置看板。
- 设备通过 `GET /device/v1/response/tasks/next` 读取已分配或待安全取消的任务，并向 `POST /device/v1/response/tasks/:id/events` 上报 `navigation_started`、`arrived`、`arrival_evidence`、`completed`、`failed` 或 `stop_confirmed`。每个事件必须携带设备生成的 `eventId`；到达与完成要求 `zeroVelocity=true`，完成前必须已有到达证据。
- `POST /api/response-tasks/:id/cancel` 对未分配任务直接取消；活动任务进入 `cancellation_requested`。只有设备上报 `stop_confirmed` 且 `zeroVelocity=true` 后才进入不可变的 `cancelled`。`completed`、`cancelled` 和 `failed` 终态拒绝新的非重复状态事件。
- 活动处置任务与人工控制租约、其他处置任务及新巡检任务互斥。该接口不会直接发送速度命令，也不能证明真实车辆已停止。

## WebSocket

| 路径 | 事件 |
|------|------|
| `/ws` | 兼容：`vehicle.position` |
| `/patrol/live` | `pose_update`、`device_status`、`patrol_status`、`patrol_event`、`violation_alert`、`response_status`、`assignment_changed`、`response_event` |

客户端发送 `{ "type": "subscribe", "vehicleId": "<uuid>" }`。两个 WebSocket
入口均要求已认证 Cookie 和配置在 `PLATFORM_PUBLIC_ORIGIN` 或
`PLATFORM_ALLOWED_ORIGINS` 中的 Origin；不受信或缺失 Origin 会以 1008 关闭。

## 前端路由

| 路由 | 页面 |
|------|------|
| `/login` | 登录 |
| `/dashboard` | 工作台 |
| `/fleet` | 设备管理 |
| `/console` | 控制台（需已选设备） |
| `/patrol/tasks` | 巡检任务 |
| `/patrol/records` | 巡逻记录 |
| `/patrol/records/:id` | 记录详情 |
| `/map` | 全局地图 |
| `/violations` | 违规车辆 |
| `/reviews` | 待审核 |
| `/whitelist` | 白名单 |
| `/reports` | 报告中心 |
| `/settings` | 系统设置 |
| `/connect` · `/remote` | 遗留本机控制台 |

当前设备 ID 存于 `localStorage` 键 `patrol:selectedDeviceId`。

白名单类型仅支持 `private` 和 `visitor`。创建、导入和查询均针对小区全局 live 白名单并过滤快照行；支持 `parkingSpot` 和可选 `validUntil`。巡检启动会验证全局 live 白名单至少包含一条记录，并原子性创建不可变快照供任务引用。

## 授权说明

`reviews`、`violations`、`reports`、`dashboard` 等端点使用 `$N::uuid IS NULL OR EXISTS (... AND vm.user_id=$N)` 模式：管理员传 `NULL`（全量访问），操作员传自身 user_id（仅限授权车辆）。

## 数据库迁移

| 版本 | 内容 |
|------|------|
| 001 | users / vehicles / telemetry / leases / audit / schema_migrations |
| 002-patrol-inspection | patrol_routes / waypoints / whitelist_imports / whitelist_entries / patrol_tasks / patrol_events / plate_observations |
| 003-patrol-stop-confirmation | cancellation_requested 状态 / stop_requested_at / stop_confirmed_at |
| 004-platform-operations | users.email / auth_otps / vehicles.bridge_url / map_metadata / map_zones / violations / reviews / patrol_reports / platform_settings；patrol_events 新增 plate / waypoint / confidence / evidence_url / review_status / occurred_at 列 |
| 005-patrol-snapshot-reviews | whitelist_imports.is_snapshot（白名单快照隔离）；patrol_events.event_type 约束扩展为包含 'observation' |
| 006-whitelist-live-version-locking | 历史重复活跃白名单转为快照；每车唯一活跃白名单索引；导入与快照的车辆锁语义 |
| 007-doorstep-response | 住户目的地、上门处置任务与设备幂等事件 |
| 008-doorstep-response-safety | 可恢复分配、安全取消状态、零速度停止确认与活动车辆互斥 |
| 009-global-whitelist | 兼容旧版扁平白名单，将 live 数据迁移为全局版本并保留任务快照 |
| 010-whitelist-entry-fields | 白名单车位和有效期字段 |

## 演示注意

1. 重启 backend 以应用 migration 003–006。
2. 先在白名单页添加至少一条车牌，否则「开始巡检」返回 409。
3. 控制台遥控仍经本机 gateway（`:8787`）+ lease，不暴露 raw TCP。
