# Patrol platform merge-fix change report

## Source plan

实施 `/tmp/oh-ai-car-web-merge-review.md` 中的阻断修复方案：恢复设备观测链路、按车辆授权运营数据、将白名单绑定当前设备、拒绝空白名单启动，并完成 PostgreSQL/PostGIS 集成验证。

## Changed files

- `backend/src/app.ts`: 恢复 `observation` 设备事件、分类、30 分钟去重和 ROI 相交处理。
- `backend/src/routes/patrol-platform.ts`: 观测查询/报告统计、违规/审核/报告/工作台的车辆范围授权、白名单 `deviceId` 契约和空版本检查。
- `backend/tests/integration/platform.test.ts`: 覆盖观测分类与去重、空白名单、白名单设备边界；修复 PostGIS 初始化重启引起的数据库就绪竞争。
- `frontend/src/pages/whitelist/WhitelistPage.tsx`、`frontend/src/services/opsClient.ts`、`frontend/src/services/api.ts`、`frontend/src/pages/patrol/PatrolTaskPage.tsx`: 当前设备白名单调用和类型收紧。
- `AI_CONTEXT.md`、`docs/architecture/patrol-platform-api.md`: OTP 未启用和新 API/授权契约。

## Validation

- `npm run typecheck`
- `npm test`（34 tests passed）
- `npm run typecheck:integration --workspace=@oh-ai-car-web/backend`
- `npm run test:integration --workspace=@oh-ai-car-web/backend`（6 tests passed）
- `npm run build`

## Remaining risk

本地验证已完成；仍应按团队流程进行人工代码审查，并在部署环境确认设备端发送的观测事件符合已记录的 API 契约。
