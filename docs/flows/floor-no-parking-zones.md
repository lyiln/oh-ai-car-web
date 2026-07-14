# 楼道禁停区（控制台识别）

在 **`/map` 楼道底图**上框选米制多边形；控制台识别并「添加到违规」时，用该车最近 10 秒 `pose_points` 做点在多边形内判定。

## 怎么用

1. 管理员登录 → `/map` → 选车 → **绘制禁停区** → 单击加点（≥3）→ 双击或「完成禁停区」
2. 车上跑位姿代理（`start_nav_agent` / pose），地图出现红三角
3. `/map` 前往到车前附近 → 控制台微调 → 识别车牌 → 看面板「禁停区：是/否」→ 提交违规

命中禁停区时 `violation_type=no_parking`；否则仍为 `suspected_external`（白名单仍会拦截）。

## API

- `GET/POST /api/vehicles/:id/floor-zones`
- `GET /api/vehicles/:id/floor-zones/check`
- `DELETE /api/vehicles/:id/floor-zones/:zoneId`
- `POST /api/violations/from-console-scan` 返回 `noParking: { inNoParking, pose, zone, reason }`
