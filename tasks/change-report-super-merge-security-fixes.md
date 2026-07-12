# `super` 合并与安全修复记录

## 范围与提交顺序

`main` 从 `7ebcabc` 以 fast-forward 合入 `4417923`（`origin/super`），随后回放本地 WIP（`50f6631`），并应用安全与一致性修复（`0e9b339`）。本记录只描述 Web 平台代码；不代表 ROS/Nav2 或真实车辆已验证。

## 合并带来的能力

### 运营地图与定位

- 新增全局地图，显示禁停区、航点、违规点和选中设备轨迹，可在地图上绘制、编辑及删除禁停区。
- 增加高德浏览器定位；定位失败或插件不可用时使用配置的默认中心，默认缩放级别为 18。
- 违规列表为每条违规最多选择一个观测坐标，避免上门处置关联多个 observation 时重复返回。

### 小区级白名单与管理页面

- 白名单从按车辆维护改为全小区 live 版本，巡检启动时复制为不可变快照，因此后续导入不会改变已启动任务的分类。
- 前端增加车主、楼栋、车位、车辆类型、有效期、模糊搜索、编辑和 CSV 导入能力。
- 旧库的 per-vehicle live 数据在 migration 009 中按同一车牌的最新记录合并到全局版本；migration 010 补齐车位和有效期字段。

### 邮箱登录与运维验证

- 恢复登录页的邮箱验证码入口，并新增隔离 Compose 部署级 WebSocket 冒烟脚本。
- WIP 同时带回生产配置 fail-fast、数据库迁移 advisory lock、WebSocket Origin 限制及上门处置的既有安全门禁。

## 合并后的修复

### OTP 与部署配置

- 移除浏览器端 EmailJS 和任何将验证码返回给客户端的路径。
- 验证码只在后端生成和 Argon2 哈希存储，经 SMTP 发送；仅已绑定邮箱的管理员能使用 OTP。未知账号、操作员和未绑定邮箱得到同一成功响应，避免泄露账号状态。
- Compose 显式传入 `BOOTSTRAP_ADMIN_EMAIL`、OTP 参数和全部 `SMTP_*` 参数；生产环境缺少 SMTP 配置会拒绝启动。

### 白名单权限、并发与迁移兼容

- 白名单列表、详情、导入和 CRUD 全部要求管理员；操作员审核时不能选择 `whitelist`，但仍可处理其车辆授权范围内的其他结果。
- 首次写入全局白名单使用事务级 PostgreSQL advisory lock，避免并发创建导致事务中止。
- upsert 返回实际记录 UUID，编辑请求可以明确清空可选字段。
- migration 009 对旧版扁平表通过 JSONB 读取可选列，兼容 `owner`/`owner_name`、`slot`/`parking_spot`、`expires_at`/`valid_until` 等旧字段组合，避免缺列中止迁移。

### 地图输出安全

- 地图车牌与航点标签使用 DOM 节点和 `textContent` 构造，不把动态文本拼入 HTML，避免标记内容注入。

## 验证记录

- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run typecheck:integration --workspace=@oh-ai-car-web/backend`
- `npm run test:integration --workspace=@oh-ai-car-web/backend`：包含 SMTP mock、管理员 OTP 边界、白名单权限/并发、快照不变性和旧扁平表迁移场景。
- `docker compose config --quiet`（占位配置）
- `npm run test:deploy-live`：隔离 Compose 项目验证后端、Nginx、认证和 `/patrol/live`；临时容器与卷会在结束时清理。

## 仍需在部署环境验证

- 使用受控 SMTP 帐号向真实管理员邮箱投递一次验证码；本地测试不会连接真实邮件服务。
- 数据库迁移应先在可恢复的预发布库运行并备份生产库。
- 地图、ROS/Nav2、OCR 与任何物理车辆动作仍须遵循既有真车验证流程，不能由上述自动化测试替代。
