# 阶段 D：真车巡航分级联调

本手册用于**现场**启用 `NAV_MODE=nav2` 的 `patrol_scheduler`。  
仓库已交付调度器代码与本检查清单；**未在本开发环境完成真车验收**，不得将文档勾选为「已通过」除非现场有证据。

安全规则：未完成 D0–D1 前，不得轮子着地发送导航目标。急停责任人必须在场。遵守 `PROTOCOL_STATUS.md` 与 `AGENTS.md`。

## D0 — 环境门禁（检查清单）

在批准安装/启动 ROS 之前，仅允许只读发现（见 `jetson-stage1-readonly-runbook.md`）。

| 检查项 | 状态 | 证据位置 |
|--------|------|----------|
| 急停责任人到位、空旷或架空区域划定 | 待做 | |
| Jetson 上 ROS 2 CLI 可用（`/opt/ros`、`ros2`） | 待做 | |
| Nav2 lifecycle / `NavigateToPose` 可查询 | 待做 | |
| 本机地图 YAML/PGM 可加载，`MAP_VERSION` 与平台路线一致 | 待做 | |
| `/amcl_pose`（或约定定位话题）有输出 | 待做 | |
| 平台 API 从小车网段可达；设备凭据已签发 | 待做 | |

全部通过前，**不得进入 D2/D3**。

## D1 — 架空或断驱动（只验证链路）

目标：确认调度器能领任务、报事件、处理取消；**底盘不得产生真实地面运动**（轮子架空或驱动断开）。

```bash
export PLATFORM_API_URL=https://<platform-host>
export DEVICE_CREDENTIAL=<id.secret>
export NAV_MODE=nav2
export MAP_VERSION=<与平台路线相同>
export MAP_FRAME=map
export CMD_VEL_TOPIC=/cmd_vel
python3 edge-agent/patrol_scheduler.py
```

可同时运行 `pose_agent.py` 向 Web 上报位姿。

| 检查项 | 状态 | 备注 |
|--------|------|------|
| 领任务并收到航点列表 | 待做 | |
| 每个航点上报 `waypoint` 或取消路径走通 | 待做 | |
| Web 停止 → `stop_confirmed` → `stopped` | 待做 | |
| 未观察到意外地面运动 | 待做 | |

将观察写入 `web-control-real-car-validation.md`。

## D2 — 低速单航点（×3）

- 空旷封闭区域；Nav2 速度/加速度设为安全低值。
- 路线仅 **1 个有效短距离目标**（或临时导入 3 点中只验证第一段，按现场约定）。
- 安全员持急停；连续成功 **3 次** 且无越界/振荡/停止延迟异常后，才可进入 D3。

| 次数 | 结果 | 日志/录像 |
|------|------|-----------|
| 1 | 待做 | |
| 2 | 待做 | |
| 3 | 待做 | |

## D3 — 多航点巡航

- 使用平台已保存的 3–8 航点楼道路线。
- 验证完整 `completed` 与一次中途 `stopped`。
- 结果写入 `web-control-real-car-validation.md`；失败保留原始日志，**禁止改库伪造成功**。

## 明确非目标（本阶段）

- 上门处置 `response_scheduler`（另见 `tasks/real-car-doorstep-integration-plan.md`）
- 解决 `Front` TCP 报文冲突（`PROTOCOL_STATUS.md`）
- 将 sim 结果记为真车证据
