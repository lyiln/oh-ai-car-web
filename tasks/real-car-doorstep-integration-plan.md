# 上门处置连接真实小车实施计划

状态：**Approved as handoff plan; implementation not started**

前置评审：`tasks/code-review-doorstep-response.md`

安全规则：未通过阶段 0–2，不得让真实车辆自主移动。

## 目标与完成标准

把当前 Web/API MVP 与一辆 iCar 的 ROS2/Nav2、视觉识别和安全停车链路连接，
完成一次“巡检发现登记车辆乱停—物业人工确认—暂停巡检—前往一层门口—
停稳留证—恢复巡检”的受控演示。

完成必须同时满足：

- Web 的权限、状态机、分配恢复和人工/自主控制互锁通过自动化测试。
- ROS 适配器在仿真中通过正常、重复消息、断网、取消、目标不可达和重启恢复。
- 真车先完成静止连接和 Stop/Brake 验证，再完成低速单目标导航，最后才联调
  识别闭环。
- 全程保存配置、ROS topic、Nav2 action、平台审计、截图和录像；任何阶段都
  不以 TCP 写成功、iframe 加载或模拟事件替代物理结果。

## 阶段 0：修复 Web 阻断项（已完成）

1. 按评审报告修复 `/patrol/live` 跨车辆事件隔离，并增加双用户双车辆测试。
2. 固化处置终态：`completed/cancelled/failed` 不可被后续状态事件覆盖。
3. 增加可恢复的分配接口与 Web“重试分配”操作；确认和分配均保持幂等。
4. 为活动处置增加安全取消请求状态，例如 `cancellation_requested`；只有设备
   取消 Nav2 并上报 `stop_confirmed + zeroVelocity=true` 后才进入 `cancelled`。
5. 补充契约文档、集成测试并运行 `npm run typecheck`、`npm test`、
   `npm run build`、后端 PostGIS 集成测试。

阶段门结果：2026-07-12 复审为 `Approved with Notes for stage 1 discovery`；
typecheck、完整 workspace 测试、生产构建和 10 项 PostGIS 集成测试通过。

## 阶段 1：建立真实环境清单但不运动

在 `docs/flows/web-control-real-car-validation.md` 记录：

- 小车编号、IP、TCP 6000、视频 6500、Jetson/Ubuntu/ROS2/Nav2 版本。
- 实际地图文件、`map` frame、Nav2 lifecycle 节点、定位话题、`/cmd_vel`、
  里程计、电量、急停方式和可用相机话题。
- 操作员电脑、平台服务器、小车是否同网段，端口可达性和时间同步状态。
- `Front` 冲突报文的受控静止测试结果；未确认前不得扩大运动范围。

只允许执行：`ping`、TCP 端口探测、ROS graph/topic/type 查看、Nav2 lifecycle
查看、视频 URL 访问和设备凭据验证。此阶段不发送导航目标。

阶段门：急停责任人到位、空旷区域划定、轮子可架空或底盘断驱动测试，且
Stop/Brake/断连停止路径已有实际记录。

## 阶段 2：实现 ROS2 response scheduler

在小车/伴随计算机创建独立 ROS2 节点，使用现有设备凭据：

1. 轮询 `GET /device/v1/response/tasks/next`，按任务 ID 写入本地 SQLite 状态；
   同一任务只启动一次，平台未确认响应前不得运动。
2. 若执行车仍在巡检：保存当前 patrol task、航点序号和恢复目标；调用 Nav2
   cancel，观察 action 结果和 `/cmd_vel` 连续为零后再开始上门。
3. 校验目的地 `mapVersion` 与本机地图一致；检查定位有效、Nav2 active、
   电量不低于 20%、急停未触发、局部代价地图正常。
4. 上报唯一 `navigation_started` 事件，然后发送 `NavigateToPose`，目标使用
   平台给出的 `x/y/yaw` 和 `map` frame。
5. Nav2 成功后连续采样零速度，再上报 `arrived`；采集一张到达照片并先写入
   本地 outbox，上传成功后上报 `arrival_evidence`。
6. 上报 `completed` 后恢复保存的巡检断点。恢复失败只上报失败并等待人工
   接管，不自动无限重试。
7. 收到取消请求时调用 Nav2 cancel，确认零速度后上报停止确认；网络断开时
   不领取新任务，正在运动的任务按本地安全策略停车并等待人工确认。

适配器不得调用 Web TCP gateway 发自主速度指令；自主导航只通过 Nav2，
gateway 保留给人工接管且受平台租约互锁。

阶段门：使用假平台或测试数据库完成事件重放、进程重启、断网 outbox 和
重复领取测试。

## 阶段 3：Gazebo/Nav2 仿真

- 导入与真车一致的地图版本，配置巡检点、禁停 ROI 和一个一层门口目标。
- 验证正常闭环、无证据不触发、低置信度不触发、目标不可达、导航中取消、
  断网、适配器重启和恢复巡检。
- 验证第二辆模拟车在线时优先分配空闲车，离线时回退源车；不得把模拟双车
  写成双真车验证。
- 保存 rosbag、Nav2 action 日志、平台审计、数据库任务时间线和屏幕录像。

阶段门：所有失败场景都能进入确定的安全终态，无任务永久卡在中间状态。

## 阶段 4：真车分级联调

### 4A 静止与架空验证

- 应用数据库 migration 007，启动平台、前端、本机 gateway 和 telemetry agent。
- 轮子架空或底盘断驱动，验证设备凭据、任务读取、事件上报、视频和证据上传。
- 按现有真实车辆验证文档确认 Stop、Brake、断连和进程退出行为。

### 4B 低速单目标导航

- 在空旷封闭区域设置一个 1–2 米目的地，速度/加速度使用 Nav2 安全低值。
- 由安全员持急停，只验证“确认—暂停—目标—到达—零速度”，暂不接视觉。
- 连续成功三次且没有越界、振荡或停止延迟异常后才能进入下一步。

### 4C 视觉与上门闭环

- 使用可控的登记测试车牌和明显禁停 ROI，避免真实住户个人信息。
- 验证边缘识别上传证据、Web 人工确认、AI 模板/云端降级、导航、到达留证、
  物业通知文本和巡检恢复。
- 分别演示 AI 在线与 AI 不可用、单车执行与第二模拟车分配。

阶段门：把每个结果写回真实车辆验证文档；失败项保留原始日志，不用人工
修改数据库伪造成功。

## 配置与接口交接

平台环境变量：`DATABASE_URL`、`SESSION_SECRET`、`PLATFORM_PUBLIC_ORIGIN`、
`PLATFORM_ALLOWED_ORIGINS`；AI 可选 `AI_BASE_URL`、`AI_API_KEY`、`AI_MODEL`。

车端环境变量建议：

```text
PLATFORM_API_URL=http(s)://<platform-host>
DEVICE_CREDENTIAL=<id.secret>
RESPONSE_POLL_SECONDS=2
RESPONSE_OUTBOX_PATH=<writable-path>/response-outbox.sqlite3
MAP_VERSION=<exact-version>
MAP_FRAME=map
CMD_VEL_TOPIC=/cmd_vel
BATTERY_TOPIC=<actual-topic>
CAMERA_TOPIC=<actual-topic>
```

设备接口以 `docs/architecture/patrol-platform-api.md` 为准。任何接口或状态变更
必须同步契约、迁移、测试和本计划，不允许车端猜测字段。

## 证据与回滚

- 每次真车测试前备份数据库并记录当前提交 ID；测试数据使用独立车辆和测试
  住户目的地，结束后只归档，不直接删除审计。
- 出现定位丢失、路径振荡、速度不归零、网络状态不明、地图版本不一致或急停
  不可用时立即终止测试。
- 回滚方式是停止 ROS response scheduler、取消其 systemd/launch 启动项并在
  平台停用目的地；不要通过关闭 Web 安全检查继续运行。
- 真车结论统一写入 `docs/flows/web-control-real-car-validation.md`，课程状态只在
  证据齐全后更新。

## 新对话执行顺序

新对话必须先读 `AGENTS.md`、`NEXT_SESSION.md`、本计划、代码评审报告、
`AI_CONTEXT.md`、`PROTOCOL_STATUS.md` 和真实车辆验证文档。先实施阶段 0，
完成复审后才规划/实现 ROS 适配器；没有实际小车信息时不得猜 IP、ROS topic、
地图或急停方式，应先执行阶段 1 的只读发现。
