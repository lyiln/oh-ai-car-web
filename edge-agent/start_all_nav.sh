#!/usr/bin/env bash
# 课程一键：在同一 Docker 容器内后台拉起激光+Nav2，前台跑网页代理。
#
# 用法（已 docker exec 进容器后）:
#   cd /tmp/edge-agent
#   bash start_all_nav.sh
#
# 换热点：只改 agent.env 的 PLATFORM_API_URL，再重新跑本脚本。
# 停掉导航后台: bash scripts/stop-yahboom-nav.sh

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${AGENT_ENV_FILE:-$DIR/agent.env}"
BRINGUP="$DIR/scripts/yahboom-nav-bringup.sh"
STOP_SCRIPT="$DIR/scripts/stop-yahboom-nav.sh"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "缺少 $ENV_FILE"
  echo "请先: cp \"$DIR/agent.env.example\" \"$DIR/agent.env\" 并填写 IP / 凭据"
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$ENV_FILE"
set +a

ROS_SETUP="${ROS_SETUP:-/opt/ros/foxy/setup.bash}"
if [[ -f "$ROS_SETUP" ]]; then
  set +u
  # shellcheck disable=SC1090
  source "$ROS_SETUP"
  set -u
fi
if [[ -n "${WS_SETUP:-}" && -f "$WS_SETUP" ]]; then
  set +u
  # shellcheck disable=SC1090
  source "$WS_SETUP"
  set -u
fi

export SKIP_DISPLAY="${SKIP_DISPLAY:-1}"
export MAP_YAML="${MAP_YAML:-/root/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps/yahboomcar.yaml}"
export LOG_DIR="${LOG_DIR:-/tmp/oh-ai-car-nav}"
export ROS_SETUP WS_SETUP

echo "=== 1/3 启动激光 + Nav2（后台，跳过车上 RViz）==="
bash "$BRINGUP"

echo "=== 2/3 启动网页代理（后台，允许 Web 先设置 AMCL 初始位）==="
bash "$DIR/start_nav_agent.sh" &
AGENT_PID=$!

stop_agent() {
  if kill -0 "$AGENT_PID" 2>/dev/null; then
    kill "$AGENT_PID" 2>/dev/null || true
  fi
}
trap stop_agent INT TERM EXIT

sleep 2
if ! kill -0 "$AGENT_PID" 2>/dev/null; then
  echo "网页代理启动失败"
  wait "$AGENT_PID" || true
  exit 1
fi

echo "=== 3/3 等待 NavigateToPose ==="
ready=0
for _ in $(seq 1 60); do
  if ! kill -0 "$AGENT_PID" 2>/dev/null; then
    echo "网页代理已退出，停止等待 NavigateToPose"
    wait "$AGENT_PID" || true
    exit 1
  fi
  # action 名称存在不代表服务端可用；必须确认至少有一个 Action server。
  if ros2 action info /navigate_to_pose 2>/dev/null | grep -Eq 'Action servers:[[:space:]]*[1-9][0-9]*'; then
    ready=1
    break
  fi
  sleep 2
done
if [[ "$ready" != "1" ]]; then
  echo "等待超时：仍看不到 /navigate_to_pose；代理继续运行，可在 Web 重新设置初始位"
  echo "看日志: tail -n 80 $LOG_DIR/nav.log $LOG_DIR/bringup1.log"
else
  echo "已确认 /navigate_to_pose Action server 可用"
fi

echo "网页代理持续运行（勿 Ctrl+C）"
echo "若尚未就绪：在 Web 设初始位后等待 map TF 与 bt_navigator 激活。"
echo "停止导航后台: bash $STOP_SCRIPT"
wait "$AGENT_PID"
