# Patrol Inspection P1 Bug Fixes Change Report

## 来源

修复巡检平台 3 个 P1 阻塞问题及审查发现的附带 bug，通过代码审查后提交。

## 变更文件

- `backend/src/db/schema.ts` — 新增 `migration005`
- `backend/src/db/index.ts` — 注册 `migration005`
- `backend/src/app.ts` — P1-2 修复（事务化 observation/event/review 写入）
- `backend/src/routes/patrol-platform.ts` — P1-1 + P1-3 修复，`::uuid` 类型修复
- `backend/tests/integration/platform.test.ts` — 新增集成测试场景
- `docs/architecture/patrol-platform-api.md` — 更新 API 契约
- `docs/decisions/whitelist-snapshot-isolation.md` — 新增架构决策记录
- `migration006` / `POST /api/whitelist/import` / `POST /api/patrol/start` — 补齐导入与启动之间的同车事务锁，防止快照读取部分导入批次

## P1-1：白名单版本快照（FR-002）

**问题**：任务保存的 `whitelist_id` 指向可变的活跃白名单；`POST /api/whitelist/import` 对同一版本执行 upsert，导致巡检开始后的白名单变更影响后续分类。

**修复**：
- `migration005` 在 `whitelist_imports` 新增 `is_snapshot boolean NOT NULL DEFAULT false`
- `platformWhitelist()` 和 `GET /api/whitelist` 均加 `AND is_snapshot=false` 过滤，快照行对 UI 透明
- `POST /api/patrol/start` 在加锁事务内创建快照（`is_snapshot=true`）并批量复制条目，任务引用不可变快照
- `migration006` 约束每辆车仅有一个活跃白名单；单条新增、批量导入和任务启动使用同一车辆锁，导入有效行一次提交

**语义**：活跃白名单继续由管理员维护；每个任务携带任务开始时的冻结副本，后续导入不影响已运行任务的分类。

## P1-2：低置信度观测未入审核队列（FR-005）

**问题**：设备上报 `observation` 事件只写 `plate_observations`，不创建 `patrol_events` 和 `reviews`，导致 `GET /api/reviews/pending` 永远看不到待复核项。

**修复**：
- `migration005` 修改 `patrol_events_event_type_check` 约束，加入 `'observation'`
- 将三张表的写入包进 `db.transaction()`，保证原子一致（审查要求）
- 当 `classification === 'pending_review'` 且为首次出现（`observation_count === 1`）时，同步插入：
  - `patrol_events`（event_type='observation', waypoint_id, waypoint name, plate, confidence, review_status='pending'）
  - `reviews`（reason='low_confidence', status='pending'）

## P1-3：任务报告不符合 FR-007

**问题**：报告 HTML 仅为 `<pre>JSON.stringify(stats)</pre>`，不含任务元数据、证据链接和物业跟进清单。

**修复**：`GET /api/patrol/tasks/:id/report` 生成包含以下内容的完整报告：
- **HTML**：任务元数据表、统计摘要表、观测证据表（含证据/标注图片链接）、物业跟进清单（`suspected_external` + `no_parking` 项）
- **CSV**：元数据节 + 统计节 + 逐行观测数据
- `stats` JSON 键名不变，已有断言无需修改

## 附带修复：`uuid = text` 类型不匹配

`patrol-platform.ts` 中 10 处查询使用 `$N::text IS NULL OR EXISTS (... AND vm.user_id=$N)` 模式，`::text` 强制类型使得后续 `uuid = text` 比较报错 `operator does not exist`。全部改为 `::uuid IS NULL OR EXISTS (...)`，修复非管理员用户访问 reviews、violations、dashboard 等端点的潜在报错。

## 验证

- `npm run typecheck` — 全工作区零错误
- `npm test` — **34/34 测试通过**
- `npm run test:integration --workspace=@oh-ai-car-web/backend` — **9/9 集成测试通过**，含新增场景：
  - 低置信度观测产生 `patrol_events(event_type='observation')` + `reviews(reason='low_confidence')`
  - 高置信度观测在白名单被活跃 upsert 后仍通过快照分类（`registered_private` 不变）
  - 审核队列对非管理员操作员可见
  - 导入被条目锁阻塞时，巡检启动等待导入事务完成且快照含完整导入内容
  - 两个首次白名单写入并发时，每车仍只有一个活跃白名单

## 已知遗留项（非阻塞）

- 低置信度观测被后续高置信度观测覆盖后，已创建的 review 不会自动清除，仍出现在队列中（pre-existing 设计缺口，需单独处理）
- CSV 字段尚未转义特殊字符（逗号/换行），生产环境前建议补充
- 快照条目复制使用 `gen_random_uuid()`（PostgreSQL 内置），其余地方用 Node.js `randomUUID()`，风格不一致，功能等效（PG 13+）
