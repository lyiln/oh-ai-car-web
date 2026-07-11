# 巡牌通 · PatrolPlate 平台 API 契约

品牌：**巡牌通 · PatrolPlate**。登录页见现有 `/api/auth/*`。本文描述管理端业务 API（migration 003–007）。

## 认证

所有 `/api/*`（除 `/device/v1/*`、`/internal/*`）需已登录会话 Cookie `oh_ai_session`，且请求 Origin 受信任。

## 设备 `/api/devices`

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/devices` | 设备列表（映射 `vehicles`） |
| POST | `/api/devices` | 管理员创建 |
| PUT | `/api/devices/:id` | 管理员更新 |
| DELETE | `/api/devices/:id` | 软删除（archived） |
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
| GET | `/api/patrol/tasks/:id/events` | 识别事件 |
| GET | `/api/patrol/tasks/:id/report` | 报告（自动生成占位） |
| GET | `/api/patrol/routes` | 路线；空时种子 `route_morning_a` |

## 地图 `/api/map`

| 方法 | 路径 |
|------|------|
| GET | `/api/map` |
| GET | `/api/map/waypoints` |
| GET/POST | `/api/map/zones` |
| PUT/DELETE | `/api/map/zones/:id` |

禁停区使用 PostGIS `geometry(Polygon,4326)`，API 返回坐标环。

## 违规与审核

| 方法 | 路径 |
|------|------|
| GET | `/api/violations` |
| GET | `/api/violations/:event_id` |
| GET | `/api/reviews/pending` |
| POST | `/api/reviews/:event_id/resolve` |

## 白名单 / 报告 / 设置

| 方法 | 路径 |
|------|------|
| GET/POST | `/api/whitelist` |
| POST | `/api/whitelist/import` |
| GET | `/api/reports` · `/api/reports/:id` |
| GET/PUT | `/api/settings` |

## WebSocket

| 路径 | 事件 |
|------|------|
| `/ws` | 兼容：`vehicle.position` |
| `/patrol/live` | `pose_update`、`device_status`、`patrol_status`、`patrol_event`、`violation_alert` |

客户端发送 `{ "type": "subscribe", "vehicleId": "<uuid>" }`。

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

## 数据库迁移

| 版本 | 内容 |
|------|------|
| 003 | vehicles.bridge_url / last_seen_at / last_patrol_at |
| 004 | patrol_routes / waypoints / patrol_tasks / patrol_events |
| 005 | map_metadata / map_zones |
| 006 | violations / reviews |
| 007 | whitelist_entries / patrol_reports / platform_settings |

## 演示注意

1. 重启 backend 以应用 migration 003–007。
2. 先在白名单页添加至少一条车牌，否则「开始巡检」返回 409。
3. 控制台遥控仍经本机 gateway（`:8787`）+ lease，不暴露 raw TCP。
