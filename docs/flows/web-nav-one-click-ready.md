# 真车一键导航就绪（网页设初始位 + 车上代理）

目标体验：选车 → **设初始位**（网页）→ **前往模式**（自动请求准备）→ 点地图导航。

对应选择：**1B** 网页设 AMCL 初始位；**2A** 车上 `nav_supervisor` 尽量自动起桥接，Nav2 整栈用可配置命令；配不上则 **2B** 就绪检查提示你手动起导航。

## 架构

```text
Web「前往模式」→ POST /nav/prepare
Web「设初始位」→ POST /nav/initial-pose
        ↓
Jetson nav_supervisor 轮询 /device/v1/nav/state
  → 可选执行 NAV_BRINGUP_CMD（课程 launch）
  → 拉起 pose_agent + goto_scheduler
  → 把初始位发到 ROS /initialpose
  → POST /device/v1/nav/status（ready 灯）
```

## PC 侧

1. `npm run dev:backend`（会跑迁移 015）+ `npm run dev:frontend`
2. 登记车辆、上传与车上一致的底图、签发设备凭据
3. 防火墙放行 `8788`；记下 PC 局域网 IP

## 2026-07-15 现场确认

- ROS 2 Foxy/Nav2 在 Docker 容器 `oh-ai-nav` 中，不在 Jetson 宿主系统中。
- 宿主的 `ros`/`run` 启动的是 `/home/jetson/Rosmaster-App/rosmaster` Python App；它会与 ROS 容器争用串口和摄像头，不能并行运行。
- 当前容器必须使用 `ROS_DOMAIN_ID=30`、`ROS_LOCALHOST_ONLY=1`、`ROBOT_TYPE=x3`、`RPLIDAR_TYPE=a1`。
- `ready` 不只检查 Action server，还检查 AMCL 已形成 `map -> base_footprint`；未设初始位时 Web 不应允许发送目标。
- 详细环境和已完成的悬空轮验证见 [Jetson 现场环境基线](../architecture/jetson-yahboom-x3-environment-baseline.md)。

## Jetson 最省事（推荐）

进容器后**一条命令**（起激光+Nav2，随后立即起代理，使 Web 可在 Action
完全就绪前设置初始位；脚本最终前台守护代理）：

```bash
cd /tmp/edge-agent
bash start_all_nav.sh
```

宿主机也可以：

```bash
bash ~/oh-ai-car-web/edge-agent/scripts/host-start-all.sh <容器名>
```

停止导航后台：`bash /tmp/edge-agent/scripts/stop-yahboom-nav.sh`  
换热点：检查 `agent.env` 里 `PLATFORM_API_URL`，再跑 `start_all_nav.sh`。`agent.env` 还包含设备凭据和 ROS 参数；不要提交真实凭据。

网页仍要：**设初始位** → 前往模式 → 点目标。

---

## Jetson / Docker 侧（按你平时三终端习惯）

你平时流程：

1. 三个终端进入**同一个容器**
2. 终端跑 `n1`、`n2`、以及：

```bash
ros2 launch yahboomcar_nav navigation_dwa_launch.py map:=/root/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps/yahboomcar.yaml
```

Web 对接时推荐两种方式（二选一）。

### 方式 A（推荐先用）：你照旧开三终端，supervisor 只桥接

容器里另开第 4 个终端。课程场景优先用 **env + 一键脚本**（换热点只改 `agent.env` 一行）：

```bash
# 首次：把本仓库 edge-agent 拷进容器后
cd /root/oh-ai-car-web/edge-agent   # 路径按实际
cp agent.env.example agent.env
# 编辑 agent.env：PLATFORM_API_URL=http://<PC局域网IP>:8788
#               DEVICE_CREDENTIAL=<uuid.secret>
# 有工作空间可写 WS_SETUP=/.../install/setup.bash

chmod +x start_nav_agent.sh
bash start_nav_agent.sh
```

等价手工 export（不推荐日常用）：

```bash
export PLATFORM_API_URL=http://<PC局域网IP>:8788
export DEVICE_CREDENTIAL='<uuid.secret>'
export NAV_MODE=nav2
export MAP_VERSION=floor-map-v1        # 与当前 Web 底图版本一致
export NAV_ASSUME_BRINGUP=true         # 告诉 Web：Nav2 你已手动拉起
export EDGE_AGENT_DIR=/path/to/edge-agent
export MAP_YAML=/root/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps/yahboomcar.yaml

cd "$EDGE_AGENT_DIR"
python3 nav_supervisor.py
```

然后 Web：设初始位 → 前往模式 → 点地图。

### 方式 B：点「前往模式」时尝试自动起导航

把 `edge-agent/scripts/yahboom-nav-bringup.sh` 拷进容器，确认 `n1`/`n2` 对应命令：

| 你平时 | 脚本默认（可改） |
|--------|------------------|
| `n1` | `ros2 launch yahboomcar_nav laser_bringup_launch.py` |
| `n2` | `display_nav`（Web 可跳过，`SKIP_DISPLAY=1`） |
| 第 3 个 | `navigation_dwa_launch.py map:=…/yahboomcar.yaml` |

```bash
chmod +x /path/to/edge-agent/scripts/yahboom-nav-bringup.sh
export SKIP_DISPLAY=1
export MAP_YAML=/root/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps/yahboomcar.yaml
export NAV_BRINGUP_CMD="bash /path/to/edge-agent/scripts/yahboom-nav-bringup.sh"
# 不要设 NAV_ASSUME_BRINGUP
export PLATFORM_API_URL=http://<PC局域网IP>:8788
export DEVICE_CREDENTIAL='<uuid.secret>'
export NAV_MODE=nav2
export EDGE_AGENT_DIR=/path/to/edge-agent
python3 /path/to/edge-agent/nav_supervisor.py
```

若 `n1`/`n2` 不是上面默认命令，启动前覆盖：

```bash
export BRINGUP1='你的n1真实命令'
export BRINGUP2='你的n2真实命令'
```

### Web 底图

用车上同一份 `yahboomcar.yaml` 的 `resolution` / `origin`，PNG 由对应
`yahboomcar.pgm` 转换。当前现场基线为 `resolution=0.05`、
`origin=[-10.5,-24.8,0]`、`1088 x 896`，Web/代理版本标签为
`floor-map-v1`。

## 浏览器操作顺序

1. `/map` 选中真车，底图已显示  
2. 确认右侧 **车上代理在线**（supervisor 心跳 < 15s）  
3. **设初始位**：在图上点真实车位附近（蓝色「初」+ 朝向）；必要时多点几次直到激光在 RViz/车端对齐、Web 三角合理  
4. **前往模式**：会调用 prepare；等 **导航就绪** 变绿  
5. 在地图上点目标 → 橙十字 → 真车 Nav2 前往  

未就绪时点前往会被拦截，并显示 `detail`（例如未设 `NAV_BRINGUP_CMD`、Nav2 action 未起来）。

## 就绪含义

| 字段 | 含义 |
|------|------|
| supervisorOnline | `nav_supervisor` 在心跳 |
| poseOk / gotoOk | 位姿桥、前往调度子进程在跑 |
| nav2Ok | `NavigateToPose` action 可连 |
| bringupOk | bringup 命令成功或 `NAV_ASSUME_BRINGUP` |
| ready | 代理在线、pose/goto/bringup 正常、Nav2 Action 可用，且已建立 `map -> base_footprint` |

## 安全

- 首次着地仍建议架空验证链路  
- 初始位不准不要发远目标  
- 急停责任人在场  
- 详见 [patrol-stage-d-real-car.md](patrol-stage-d-real-car.md)

## 与纯模拟

本机可用 `NAV_MODE=sim` 跑 supervisor（不启 ROS initialpose）；真车必须 `nav2` + 真实 `/initialpose`。
