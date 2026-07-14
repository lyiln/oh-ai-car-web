# OH AI Car Web

面向 OH AI 小车的浏览器控制台和仅限本机访问的 TCP 网关。

> **协议警告：** 真实小车的报文格式尚未确认。连接车辆前请先阅读
> [PROTOCOL_STATUS.md](PROTOCOL_STATUS.md)。

进行协作开发前，请先阅读 [AGENTS.md](AGENTS.md) 和
[AI_CONTEXT.md](AI_CONTEXT.md)。

## 文档导航

请通过[文档地图](docs/README.md)查找开发指南、架构、部署、课程交付和参考证据。
产品需求见 [specs/README.md](specs/README.md)，当前计划、评审和历史变更记录见
[tasks/README.md](tasks/README.md)。

课程交付状态和证据要求记录在[课程状态.md](课程状态.md)，小组执行方案和任务书映射见
[docs/course/课程文档索引.md](docs/course/课程文档索引.md)。

本仓库包含已实现的车辆管理和轨迹平台 MVP。请先阅读中文的[项目与后端指南](docs/architecture/vehicle-platform-overview.md)，
再阅读[部署指南](docs/deployment/vehicle-platform.md)。对应的批准计划和变更记录分别见
[tasks/vehicle-fleet-platform-mvp-plan.md](tasks/vehicle-fleet-platform-mvp-plan.md) 和
[tasks/change-report-vehicle-fleet-platform-mvp.md](tasks/change-report-vehicle-fleet-platform-mvp.md)。

仓库还内置了 `YOLOv5/oh-ai-car-YOLOv5` 中的关键车牌识别代码，因此默认无需额外的
兄弟目录即可运行本地车牌 API 和边缘代理。

## 本地开发

```sh
npm install
npm run dev:backend
npm run dev:frontend
PLATFORM_API_URL=http://127.0.0.1:8788 npm run dev:gateway
# 使用控制台“车牌识别工作台”时，还需在第四个终端运行：
npm run dev:plate-api
```

基础控制在三个终端中分别运行前述前三个命令即可；车牌识别工作台需要第四个终端的
YOLO 服务。后端监听
`http://127.0.0.1:8788`（真车联调须对局域网监听，例如 `HOST=0.0.0.0`），网关监听
`http://127.0.0.1:8787`，其 WebSocket 地址为
`ws://127.0.0.1:8787/control`；YOLO 服务监听 `http://127.0.0.1:8010`；Vite 开发界面使用
`http://127.0.0.1:5173`。`dev:plate-api` 在 macOS/Linux 使用 `python3`，在 Windows 使用
`python`；还需先按[YOLO 集成说明](docs/integration/yolo-plate-recognition.md)安装 Python 依赖及模型权重。

后端启动时会读取 `.env`，并对其中配置的 `DATABASE_URL` 执行仓库迁移；本地运行时请使用
已获批准的开发数据库。

网关要求设置 `PLATFORM_API_URL`，并在连接小车前验证平台控制租约；未取得租约时不会开放
直接控制模式。

提交评审前请运行 `npm test`、`npm run typecheck` 和 `npm run build`。

## 真车网页前往（点选导航）怎么跑

详细说明见 [docs/flows/web-nav-one-click-ready.md](docs/flows/web-nav-one-click-ready.md)
与 [docs/flows/web-goto-click-nav.md](docs/flows/web-goto-click-nav.md)。

### 1. 电脑

```sh
npm install
npm run dev:backend    # 建议 HOST=0.0.0.0，端口 8788；防火墙放行 8788
npm run dev:frontend
```

1. 浏览器打开 `http://127.0.0.1:5173` 并登录  
2. 设备管理：车辆 Host = **当前车局域网 IP**  
3. `/map`：上传与车上一致的底图（如 `yahboomcar.yaml` + 对应 pgm 转的 PNG）  
4. 签发设备凭据（浏览器 Console 调 `POST /api/vehicles/:id/device-credentials`），得到 `uuid.secret`  
5. `ipconfig` / `ip addr` 记下电脑局域网 IP（不要用 `127.0.0.1` 填到车上）

### 2. 车上（必须与 Nav2 同一 Docker 容器）

Jetson 宿主机通常没有 `/opt/ros`，代理不能只在宿主机跑。把本仓库 `edge-agent/` 拷进容器，推荐路径 `/tmp/edge-agent`：

```bash
# 宿主机：先保证 ~/oh-ai-car-web/edge-agent 存在（git clone / scp）
tar -C ~/oh-ai-car-web -cf - edge-agent | docker exec -i <容器名或ID> tar -C /tmp -xf -
```

容器内配置（`agent.env` **不要提交**，仓库只有示例）：

```bash
docker exec -it <容器名或ID> bash
cd /tmp/edge-agent
cp agent.env.example agent.env
# 编辑 agent.env：
#   PLATFORM_API_URL=http://<电脑局域网IP>:8788
#   DEVICE_CREDENTIAL=<刚才签发的整串>
#   EDGE_AGENT_DIR=/tmp/edge-agent
#   MAP_VERSION=yahboomcar
#   NAV_ASSUME_BRINGUP=true   # 若 Nav2 已手动拉起
sed -i 's/\r$//' start_all_nav.sh start_nav_agent.sh scripts/*.sh agent.env
```

启动（二选一）：

```bash
# A. 已手动起好激光 + navigation_dwa：只挂网页代理
bash start_nav_agent.sh

# B. 一键：后台起激光+Nav2，前台跑代理（默认不开 RViz，减轻卡顿）
bash start_all_nav.sh
```

宿主机一键同步并启动：

```bash
bash edge-agent/scripts/host-start-all.sh <容器名或ID>
```

停止导航后台：`bash /tmp/edge-agent/scripts/stop-yahboom-nav.sh`  
换热点：只改 `agent.env` 的 `PLATFORM_API_URL`，并更新网页设备 Host。

### 3. 网页操作

1. 打开全局地图，确认「车上代理在线」；真车还需 Nav2 `/navigate_to_pose` 就绪后显示「导航就绪」  
2. **清除轨迹**（若有历史绿线）  
3. **设初始位**：点位置并拖出朝向（勿只单击）  
4. **前往模式** → 点地图目标  

联调时建议 RViz 只观察、不要同时发 Goal，避免双控导致原地旋转恢复。

### 4. 他人拉取后最小检查

```sh
npm install
npm run typecheck
npm test
npm run build
```

真车联调另需：同一 Wi‑Fi、后端可达、容器内 `agent.env`、Nav2 与代理同容器。

真实小车验证必须人工执行。连接车辆前请阅读当前的[真实车辆接入计划](tasks/real-car-doorstep-integration-plan.md)
和[验证记录](docs/flows/web-control-real-car-validation.md)。

成员 C 的 ROS2 雷达包位于本 Web 仓库之外的兄弟工程[独立 ROS2 工作区](../oh-ai-car-ros2/README.md)。
启动 Web 项目不会启动 Jetson Docker、ROS 节点、厂商上位机 App 或任何车辆控制进程。

## Spec Kit 工作流

本仓库通过 `.specify/` 跟踪自身的 Spec Kit 工作流，并将 Codex 技能放在
`.agents/skills/`。安装 Spec Kit CLI 后，可在本目录运行 `specify check` 检查配置。
新需求和计划应放在 `specs/` 下；本仓库不要求兄弟 OpenHarmony 工程参与构建。
