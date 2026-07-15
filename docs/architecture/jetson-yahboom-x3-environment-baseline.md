# Jetson Yahboom X3 现场环境基线

最后现场确认：2026-07-15。本文用于后续对话快速恢复上下文；IP 和设备枚举会随网络、USB 重插变化，操作前必须复查。本文不记录 SSH 密码或设备凭据。

## 当前连接与运行架构

| 项目 | 已确认状态 |
| --- | --- |
| Jetson SSH | `jetson@10.82.66.179`（2026-07-15 当前局域网地址，不应写死进代码） |
| 宿主快捷命令 | `ros` 进入 `/home/jetson/Rosmaster-App/rosmaster`；`run` 执行该目录的 `start_app.sh` |
| 宿主 Rosmaster-App | 是 Yahboom 的 Python 控车/视频 App，不是 ROS；使用 TCP `6000`、视频 `6500`，并占用串口和摄像头 |
| ROS 2 / Nav2 | 宿主没有 `/opt/ros` 和 `ros2`；ROS 2 Foxy/Nav2 位于 Docker 镜像 `yahboomtechnology/ros-foxy:5.0.1` |
| 当前 ROS 容器 | 持久容器 `oh-ai-nav`，host network，restart policy `unless-stopped` |
| 设备映射 | 当前 `/dev/myserial -> ttyUSB1`，`/dev/rplidar -> ttyUSB0`；USB 重插后必须复查 |
| 并发约束 | Rosmaster-App 与 ROS 容器争用 `/dev/ttyUSB1`、`/dev/video0`，不得同时运行；当前为 ROS/Nav2 链路，宿主 `run` 已停止 |

`agent.env` 是车端代理的运行配置，不是 ROS 安装文件。它保存平台 API 地址、设备凭据、导航模式、地图版本和 ROS 参数。真实 `DEVICE_CREDENTIAL` 属于密钥，不得提交或复制到文档；换局域网后通常需要更新 `PLATFORM_API_URL`。

本机 `127.0.0.1:8787` 网关属于另一条厂商 TCP 手动控制链路：浏览器经网关连接车端 Rosmaster-App 的 `6000` 端口。当前为 ROS/Nav2 运行态，Rosmaster-App 已停止，因此车端 `10.82.66.179:6000` 拒绝连接是预期现象。FloorMap 点终点不经过该网关，而是走 Web 后端 → 车端代理 → Nav2；不要为了消除网关连接错误而同时启动 Rosmaster-App。

## 已验证配置

```text
ROS_DOMAIN_ID=30
ROS_LOCALHOST_ONLY=1
ROBOT_TYPE=x3
RPLIDAR_TYPE=a1
NAV_MODE=nav2
MAP_VERSION=floor-map-v1
MAP_YAML=/root/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps/yahboomcar.yaml
```

`floor-map-v1` 是 Web/代理使用的版本标签；车端没有同名 YAML，ROS 仍加载
`yahboomcar.yaml` 和 `yahboomcar.pgm`。2026-07-15 已按 Web 元数据把车端 YAML
统一为 `resolution: 0.05`、`origin: [-10.5, -24.8, 0]`、图像尺寸
`1088 x 896`。修改前文件保存在同目录 `yahboomcar.yaml.before-web-origin`。

2026-07-15 平台在 PC `http://10.82.66.56:8788`，车辆代码为 `jetson-01`。这是现场值，不是稳定默认值。旧地址 `10.54.232.179` 和旧车辆记录 `jets02` 不代表当前小车。

`ROS_LOCALHOST_ONLY=1` 是当前单容器架构的必要稳定配置。使用 `0` 时，Jetson 多网卡上的 Fast DDS 后加入节点发现不稳定，曾出现驱动已运行但 `/odom_raw`、TF 或 Action 客户端收不到数据。ROS 启动后也应给 DDS 约 10–20 秒完成发现；3 秒诊断可能误报无发布者。

## 启动链路

`edge-agent/start_all_nav.sh` 当前按以下顺序启动：

1. `ros2 launch yahboomcar_nav laser_bringup_launch.py`
2. `ros2 launch yahboomcar_nav navigation_dwa_launch.py map:=<MAP_YAML>`
3. 在等待 `NavigateToPose` 前启动 `nav_supervisor.py`，由它拉起
   `pose_agent.py` 和 `goto_scheduler.py`，使 Web 可以先发布 AMCL 初始位。

不能先等待 Action server、再启动 supervisor：干净启动时 AMCL 需要初始位才能
建立 `map` TF，而 Web 初始位又依赖 supervisor，错误顺序会形成启动死锁。

导航进程以独立进程组启动，停止脚本会终止整个进程组，避免残留节点继续占用设备。车端代理通过设备凭据轮询平台任务；因此必须配置平台 API 地址与设备凭据，ROS 本身并不认识 Web 平台中的车辆、目标或任务状态。

## 现场运行证据

在 `oh-ai-nav` 中已观察到：

- `/vel_raw`、`/odom_raw`、`/odom` 约 25 Hz；`/scan` 约 8.5 Hz。
- `odom -> base_footprint` 和 `map -> base_footprint` TF 链可用。
- `/navigate_to_pose` Action server 存在。
- Web 导航就绪现在要求 supervisor、pose、goto、bringup、Nav2 Action 均正常，并且当前 supervisor 生命周期内已经取得有效 `map -> base_footprint`。

2026-07-15 在“车轮悬空或驱动禁用、现场人员和急停可用”的条件下发送了测试目标：

- 约 0.15 m 目标落在容差内，Nav2 直接成功，没有有效运动输出。
- 约 0.4 m 目标产生非零速度，峰值约 0.22 m/s，随后归零，Nav2 返回成功。
- 修复 Action 客户端初始化顺序后，最终目标的平台状态完整经过 `queued -> navigating -> arrived`，Action 终态为 `SUCCEEDED`。

这证明 Web → 平台 → 车端代理 → Nav2 → 底盘速度输出 → 结果回传链路在悬空/禁用驱动条件下成立；**不等于轮子着地后的路径规划、避障、定位精度和停车距离已通过验收**。

## 已修复的关键问题

1. 补齐 `ROBOT_TYPE=x3`、`RPLIDAR_TYPE=a1`，否则 Yahboom bringup 无法正确选型。
2. 将单容器 ROS 通信固定为 `ROS_LOCALHOST_ONLY=1`，恢复 odom、TF 和 Action 的稳定发现。
3. Web 只有在 Nav2 Action 与 `map -> base_footprint` 都可用时才允许发目标；未就绪由后端返回 409。
4. Web 可提交初始位，supervisor 会向 `/initialpose` 连续发布三次。
5. `goto_scheduler`/`patrol_scheduler` 先创建 ActionClient 和订阅，再启动 Executor，规避 Foxy wait-set 不刷新的问题；并按 goal UUID 监听状态作为结果兜底。

## 每次现场操作前复查

1. SSH IP、PC 平台 IP 和 `agent.env` 的 `PLATFORM_API_URL`。
2. `/dev/myserial`、`/dev/rplidar` 指向及容器设备映射。
3. 宿主 Rosmaster-App 已停止，避免串口/视频冲突。
4. `oh-ai-nav`、ROS topic、TF、`/navigate_to_pose` 和平台导航状态。
5. 地面测试前完成急停、空旷场地、低速/短距离和现场观察门禁。
