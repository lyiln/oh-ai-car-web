# 乱停车违停定位说明

违停位置在本平台中表示**巡检车发现违停时的 WGS-84 坐标**（代理“违停发生点”），不是被拍车辆的独立 GPS。当前硬件无法给违停目标车单独定位。

## 坐标来源优先级

1. **观测直传（`coordinateSource: observation`）**
   设备在 `POST /device/v1/patrol/tasks/:id/events` 的 `observation` 事件中携带 `longitude` / `latitude`（与当前 `/gps/fix` 同步）。平台写入 `plate_observations`，查询违规时直接使用。

2. **遥测回填（`coordinateSource: telemetry`）**
   若观测未带坐标，`GET /api/violations` 会在违规发生时刻前后 **±60 秒**内，取同车 `telemetry_points` 中时间最近的一点作为坐标。依赖边缘侧 `edge-agent` 持续上报 `POST /device/v1/telemetry`。

3. **暂无（`coordinateSource: none`）**
   观测无坐标且窗口内无遥测时，地图不绘制标记；列表与抽屉仍展示航点名、禁停区、白名单车主信息。

## 设备侧建议

正式 patrol scheduler 发送 observation 时应附带当前 GPS：

```json
{
  "type": "observation",
  "waypointId": "...",
  "occurredAt": "2026-07-11T06:00:02.000Z",
  "plate": "G12345",
  "confidence": 0.94,
  "vehicleBox": [0.2, 0.2, 0.2, 0.2],
  "evidenceImageUrl": "https://...",
  "longitude": 116.401111,
  "latitude": 39.910222
}
```

未附带时平台用遥测回填兜底，但直传更准确、不依赖时间窗口对齐。

## 车辆信息

违规详情额外返回任务白名单快照中的：

- `ownerName` / `building` / `parkingSpot`（登记车位文本，用于对比“应在哪停”，不是地图坐标）
- `confidence`

前端：

- 地图页抽屉展示坐标、来源与车主信息，支持「定位到此」
- 违规列表页展示坐标列，并通过 `/map?violationId=<id>` 深链打开地图并居中

## 相关实现

- 观测去重保留坐标：`backend/src/app.ts`
- 违规查询回填：`backend/src/routes/patrol-platform.ts`（`GET /api/violations`）
- 真实设备的 ROS/GPS 运行时恢复：按 `NEXT_SESSION.md` 的阶段 1.5 门禁单独审批
