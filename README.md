# OH AI Car Web

Browser control console and localhost-only TCP gateway for the OH AI car.

> **Protocol warning:** The real-car packet format has not been confirmed.
> Read [PROTOCOL_STATUS.md](PROTOCOL_STATUS.md) before connecting a vehicle.

For agent-assisted work, start with [AGENTS.md](AGENTS.md) and
[AI_CONTEXT.md](AI_CONTEXT.md).

## Documentation

Use the [documentation map](docs/README.md) to choose current guides,
architecture, deployment, course delivery, or reference evidence. Product
requirements are indexed at [specs/README.md](specs/README.md); active plans,
reviews, and historical change reports are indexed at [tasks/README.md](tasks/README.md).

Course-level delivery status and evidence requirements are tracked in
[课程状态.md](课程状态.md); the group execution and taskbook mapping
are indexed at [docs/course/课程文档索引.md](docs/course/课程文档索引.md).

The repository contains the implemented vehicle management and trajectory
platform MVP. Start with the Chinese [project and backend guide](docs/architecture/vehicle-platform-overview.md), then use the
[deployment guide](docs/deployment/vehicle-platform.md). Its approved plan and
change record remain in [tasks/vehicle-fleet-platform-mvp-plan.md](tasks/vehicle-fleet-platform-mvp-plan.md)
and [tasks/change-report-vehicle-fleet-platform-mvp.md](tasks/change-report-vehicle-fleet-platform-mvp.md).

## Development

```sh
npm install
npm run dev:backend
npm run dev:frontend
PLATFORM_API_URL=http://127.0.0.1:8788 npm run dev:gateway
```

- Frontend: `http://127.0.0.1:5173`
- Backend API: `http://127.0.0.1:8788`（真车联调须对局域网监听，例如 `HOST=0.0.0.0`）
- Gateway: `http://127.0.0.1:8787`，WebSocket `ws://127.0.0.1:8787/control`

The gateway requires `PLATFORM_API_URL` and validates a platform control lease
before it connects to a car; unleased direct-control mode is no longer exposed.

Run `npm test`, `npm run typecheck`, and `npm run build` before a review.

Real-car validation is manual. Read the active [real-car integration plan](tasks/real-car-doorstep-integration-plan.md)
and [validation record](docs/flows/web-control-real-car-validation.md) before connecting to a vehicle.

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

## Spec Kit

This repository tracks its own `.specify/` workflow and Codex skills under
`.agents/skills/`. With the Spec Kit CLI installed, run `specify check` from
this directory to verify the local setup. New requirements and plans belong
under `specs/`; no sibling OpenHarmony checkout is required.
