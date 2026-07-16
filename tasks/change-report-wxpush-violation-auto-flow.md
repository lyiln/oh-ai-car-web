# 微信通知与违规识别全链路变更报告

## 来源与分支

- 来源：用户批准的“微信通知与违规识别全链路改造”计划。
- 分支：`feat/wxpush-violation-auto-flow`，基线 `main@a0c9ea1`。
- 用户原有 `.gitignore` 修改保持不变；本次未提交、未推送、未部署。

## 行为变化

- 巡检调度器独占任务领取，并通过共享 SQLite 发布当前停留航点；视觉进程只在该窗口上传证据和 observation。
- 高置信度识别按“禁停区内任何车、区外仅非白名单车”自动生成违规；低置信度只进入审核。
- 控制台实时来源自动提交并由后端按 30 分钟窗口幂等；本地图片和视频继续手动提交。
- 登记私家车禁停生成 `notification_only` 任务，人工确认后发送 WxPusher，不再派车；失败可刷新 UID 后重试。
- 历史上门任务、设备接口和数据保留，仅用于存量任务安全收口。
- 设备侧违规幂等键包含航点；并发重复写入通过事务锁收敛，控制台重复帧会累计观测次数并保留更高置信度证据。
- 调度器启动或领取新任务时清理旧任务/航点共享状态，避免视觉结果关联到异常退出前的航点。
- 前端实时来源仅自动提交；“添加到违规车辆”按钮只保留在本地图片和本地视频。

## 数据与接口

- migration 024：`response_tasks.notification_only`、可空目的地，以及违规来源、观测关联和幂等字段。
- `POST /api/response-tasks/:id/confirm` 对通知任务执行确认和发送。
- 新增 `POST /api/response-tasks/:id/retry-push`。

## 验证

- `npm run typecheck`：通过。
- `npm test`：通过（shared 5、gateway 20、frontend 37、backend 60）。
- `npm run test:integration --workspace=@oh-ai-car-web/backend`：PostGIS 集成测试 26 项通过。
- `npm run build`：通过；Vite 仅保留既有的大 chunk 警告。
- `npm run typecheck:integration --workspace=@oh-ai-car-web/backend`：通过。
- `python3 edge-agent/tests/test_patrol_shared_state.py`：3 项通过。
- `python3 edge-agent/tests/test_plate_adapter.py`：2 项通过。
- `node --check scripts/seed-wxpush-demo.mjs`：快速截图数据脚本语法检查通过。

## 快速截图

- `npm run demo:wxpush` 生成待确认演示记录。
- `npm run demo:wxpush -- --sent` 生成“已推送”截图态，不会真实发送微信。
- 操作说明见 `docs/flows/wxpush-screenshot-demo.md`。

## 剩余边界

- 自动化测试和模拟链路不构成真实车辆或真实住户微信送达证明。
- 真实 WxPusher 验证需要测试 App Token 与测试 UID，不得把凭据写入仓库。
