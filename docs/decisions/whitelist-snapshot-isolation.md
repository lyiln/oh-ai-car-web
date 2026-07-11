# 决策记录：白名单版本快照隔离（FR-002）

**日期**：2026-07-11
**状态**：已实施
**关联**：`specs/003-patrol-inspection/spec.md` FR-002、migration005、migration006

## 背景

FR-002 要求巡检任务"快照其路线和白名单版本"，以确保分类结果不受任务启动后的白名单变更影响。

原始实现将 `patrol_tasks.whitelist_id` 指向活跃白名单的 ID，而 `POST /api/whitelist/import` 对同一 `whitelist_id` 执行 `ON CONFLICT DO UPDATE`，导致：

- 任务启动后导入新条目或修改已有条目，会立即影响正在运行的任务的 `plate_observations` 分类查询
- 违反"版本快照"语义，无法复现历史巡检的分类依据

## 决策

白名单写入与巡检启动以车辆行为互斥边界；在 `POST /api/patrol/start` 的加锁事务中，为每次任务创建**不可变快照**：

1. `whitelist_imports` 使用 `is_snapshot boolean NOT NULL DEFAULT false` 区分活跃版本和任务快照。
2. 管理端单条新增、批量导入与巡检启动均先执行 `SELECT ... FROM vehicles ... FOR UPDATE`，同一车辆的这些操作不能并发穿插。
3. 批量导入在同一事务中写入全部已通过请求校验的条目；数据库异常会回滚整批有效行。
4. 启动任务在持锁事务内读取活跃版本、确认至少一条条目、创建快照头并批量复制条目。
5. `patrol_tasks.whitelist_id` 引用快照行，而非活跃行。

`006-whitelist-live-version-locking` 会将每车历史上多余的活跃行标记为快照，并建立“每车最多一条活跃白名单”的部分唯一索引，作为应用层锁之外的数据库防线。

活跃白名单（`is_snapshot=false`）继续用于管理操作和 UI 展示。快照行对 UI 透明（`GET /api/whitelist` 过滤 `is_snapshot=false`）。

## 备选方案

| 方案 | 理由 |
|------|------|
| 任务启动后锁定活跃白名单，禁止导入 | 用户体验差，且跨任务冲突复杂 |
| 引用版本号而非行 ID | 需要更复杂的版本控制逻辑，且不支持条目内容变更 |
| 每次导入创建新 whitelist_imports 行 | 打破了现有 `platformWhitelist()` 单一活跃白名单语义 |

## 权衡

- **优点**：快照写入在事务内原子完成，分类结果可复现，活跃白名单继续可维护
- **缺点**：每次任务启动复制一份条目（存储开销与白名单大小成正比）；快照条目复制使用 `gen_random_uuid()`，与其他地方的 Node.js `randomUUID()` 风格不一致（功能等效，PG 13+）

## 实施

- `migration005`：`ALTER TABLE whitelist_imports ADD COLUMN IF NOT EXISTS is_snapshot boolean NOT NULL DEFAULT false`
- `migration006`：迁移历史重复活跃版本并新增 `whitelist_imports_one_live_per_vehicle_idx`
- `platformWhitelist()`、`POST /api/whitelist` 和 `POST /api/whitelist/import`：使用同一车辆锁和同一事务
- `POST /api/patrol/start`：在车辆锁事务内读取、校验和复制活跃白名单

## 验证

集成测试 `'creates patrol_events and reviews for pending-review observations, and whitelist snapshot is immutable'`：
任务启动后对活跃白名单执行 upsert，高置信度观测仍通过快照分类为 `registered_private`（非 `visitor`）。

集成测试 `'serializes a blocked whitelist import with patrol snapshot creation'`：导入持有车辆锁并被条目锁阻塞时，巡检启动只能等待；导入提交后，任务快照同时包含新增条目及被更新条目的最终内容。
