# Jetson GPS 接入手册（Yahboom Orin Nano）

本文说明如何把 Jetson 小车的 GPS（或 mock GPS）接到本仓库平台轨迹链路。

## 架构

```text
Jetson Docker (ROS2 Foxy)
  GPS 串口驱动 或 mock_gps_publisher.py
       ↓  /gps/fix  (sensor_msgs/NavSatFix)
  edge-agent/telemetry_agent.py
       ↓  HTTPS POST /device/v1/telemetry
开发机 Fastify :8788 → telemetry_points → 前端地图
```

## 已在本机验证过的环境

| 项 | 值 |
|----|-----|
| Jetson | `10.82.66.179` / 用户 `jetson` |
| 开发机 LAN | `10.82.66.59` |
| 后端 | `HOST=0.0.0.0` 监听 `8788`（Jetson 才能访问） |
| 车辆 | `code=jetson-01`，TCP 主机 `10.82.66.179` |
| ROS | Docker 镜像 `yahboomtechnology/ros-foxy:5.0.1` |

## 硬件探测结论（2026-07-13）

串口扫描**未发现 NMEA**（`$GPGGA` / `$GPRMC` 等）：

| 设备 | 识别 | 说明 |
|------|------|------|
| `/dev/ttyUSB0` | Silicon Labs CP2102 | 无可读 NMEA |
| `/dev/ttyUSB1` (`myserial`) | QinHeng HL-340 | 底盘二进制协议（非 GPS） |
| `/dev/ttyUSB2` | QinHeng HL-340 | 无数据 |

因此当前用 **`mock_gps_publisher.py`** 发布校园附近 WGS-84 坐标，验证整条平台链路。接上真实 GPS 模块后，按下文「真实 GPS」切换即可。

## 一键步骤

### 1. 开发机：后端对外监听

`.env` 中设置：

```env
HOST=0.0.0.0
```

然后：

```bash
npm run dev:backend
```

确认 Jetson 能访问：

```bash
# 在 Jetson 上
curl -s -o /dev/null -w "%{http_code}" http://10.82.66.59:8788/api/auth/me
# 期望 401（服务可达）
```

Windows 防火墙需放行入站 TCP `8788`。

### 2. 创建车辆并轮换设备凭据

```bash
python scripts/platform-setup-jetson-gps.py admin <admin-password>
```

会写入（已 gitignore）：`scripts/.local-jetson-gps.json`，含 `vehicleId`、`deviceCredential`、`platformApiUrl`。

### 3. 探测串口（可选）

```bash
# 在 Jetson 上
bash scripts/jetson-gps-probe.sh
```

### 4. 部署并启动（mock GPS）

在开发机（需设置 `JETSON_SSH_PASSWORD`）：

```powershell
$env:JETSON_SSH_PASSWORD='***'
python scripts/jetson-start-mock-gps.py
```

该脚本会：

1. 上传 `edge-agent/` 到 `/home/jetson/oh-ai-car-edge`
2. 启动容器 `oh-ai-gps`（`--net=host`，挂载 edge 目录）
3. 运行 `mock_gps_publisher.py` + `telemetry_agent.py`

手动等价命令（已 SSH 到 Jetson）：

```bash
docker rm -f oh-ai-gps
docker run -d --name oh-ai-gps --net=host \
  -v /home/jetson/oh-ai-car-edge:/root/oh-ai-car-edge \
  yahboomtechnology/ros-foxy:5.0.1 \
  bash /root/oh-ai-car-edge/run-inside.sh
```

`run-inside.sh` / `.env.runtime` 由部署脚本生成。也可：

```bash
source /opt/ros/foxy/setup.bash
export PLATFORM_API_URL=http://10.82.66.59:8788
export DEVICE_CREDENTIAL=<uuid.secret>
export GPS_TOPIC=/gps/fix
export MOCK_GPS=1
bash /root/oh-ai-car-edge/start-telemetry.sh
```

### 5. 验证

```bash
# 轨迹
curl "http://127.0.0.1:8788/api/vehicles/<vehicleId>/track" \
  -H "Origin: http://127.0.0.1:5173" -b "oh_ai_session=..."

# 最新点
curl "http://127.0.0.1:8788/api/devices/<vehicleId>/pose" ...
```

前端：

```bash
npm run dev:frontend
```

打开 `http://127.0.0.1:5173`，登录后进入 **控制台** 或 **地图**（勾选「巡逻轨迹」），选择 `Jetson巡检车`。

本地 Vite 已代理 `/_AMapService`（见 `frontend/vite.config.ts`），需配置 `VITE_AMAP_KEY` 与 `AMAP_SECURITY_JS_CODE`。

## 真实 GPS（有 NMEA 时）

1. 用 `scripts/jetson-gps-probe.sh` 确认端口与波特率。
2. 在 Foxy 容器内安装/启动驱动，例如：

```bash
apt-get update && apt-get install -y ros-foxy-nmea-navsat-driver
ros2 run nmea_navsat_driver nmea_serial_driver --ros-args \
  -p port:=/dev/ttyUSB0 \
  -p baud:=9600 \
  -p frame_id:=gps
```

3. 将 `.env.runtime` 中 `MOCK_GPS=0`，只跑 `telemetry_agent.py`：

```bash
export MOCK_GPS=0
bash start-telemetry.sh
```

4. 确认：

```bash
ros2 topic echo /gps/fix
```

## 相关文件

| 文件 | 用途 |
|------|------|
| [`edge-agent/telemetry_agent.py`](../../edge-agent/telemetry_agent.py) | 订阅 `/gps/fix` 并上报 |
| [`edge-agent/mock_gps_publisher.py`](../../edge-agent/mock_gps_publisher.py) | 无硬件时的 NavSatFix 模拟 |
| [`edge-agent/start-telemetry.sh`](../../edge-agent/start-telemetry.sh) | 容器内启动脚本 |
| [`scripts/platform-setup-jetson-gps.py`](../../scripts/platform-setup-jetson-gps.py) | 建车 + 凭据 |
| [`scripts/jetson-start-mock-gps.py`](../../scripts/jetson-start-mock-gps.py) | SSH 部署 mock 链路 |
| [`scripts/jetson-gps-probe.sh`](../../scripts/jetson-gps-probe.sh) | 串口/话题探测 |
| [`scripts/jetson-serial-nmea-probe.py`](../../scripts/jetson-serial-nmea-probe.py) | 远程 NMEA 扫描 |

## 故障排查

| 现象 | 处理 |
|------|------|
| Jetson `curl` 平台失败 | 检查 `HOST=0.0.0.0`、防火墙、IP |
| `docker cp` 报 USB mount 错误 | 旧容器坏掉，用新容器 `oh-ai-gps` 并挂载目录 |
| outbox 有数据但不上传 | 检查 `DEVICE_CREDENTIAL`；看 `agent.log` |
| 地图无轨迹 | 确认 `track` API 有点；检查高德 Key / `/_AMapService` |
| 无 `/gps/fix` | 先跑 mock；有硬件则装 NMEA 驱动 |

## 安全

- 不要把 `DEVICE_CREDENTIAL`、SSH 密码提交到 Git
- `scripts/.local-jetson-gps.json` 已在 `.gitignore`
- 实验结束后建议修改 Jetson 密码：`passwd`

## 与乱停车定位的关系

遥测点也会用于违停坐标回填：当 observation 未携带 GPS 时，平台在违规时刻 ±60s 内取最近 `telemetry_points`。完整说明见 [illegal-parking-localization.md](../flows/illegal-parking-localization.md)。
