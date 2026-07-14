#!/usr/bin/env bash
# 课程场景：读 agent.env 后启动 nav_supervisor（在已进入的 Nav2/autodrive 容器内执行）
#
# 首次：
#   cp agent.env.example agent.env   # 改 PLATFORM_API_URL / DEVICE_CREDENTIAL
#   bash start_nav_agent.sh
#
# 换热点：只改 agent.env 里 PLATFORM_API_URL，再重新跑本脚本。

set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${AGENT_ENV_FILE:-$DIR/agent.env}"
LOCK_FILE="${AGENT_LOCK_FILE:-/tmp/oh-ai-car-nav-supervisor.lock}"

# Only one supervisor may claim goals for this container.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$LOCK_FILE"
  if ! flock -n 9; then
    echo "已有 nav_supervisor 在运行；请勿重复启动"
    exit 1
  fi
fi

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
  # shellcheck disable=SC1090
  set +u
  source "$ROS_SETUP"
  set -u
else
  echo "警告: 找不到 $ROS_SETUP（确认已在 ROS 容器内）"
fi

if [[ -n "${WS_SETUP:-}" && -f "$WS_SETUP" ]]; then
  # shellcheck disable=SC1090
  set +u
  source "$WS_SETUP"
  set -u
fi

EDGE_AGENT_DIR="${EDGE_AGENT_DIR:-$DIR}"
export PLATFORM_API_URL DEVICE_CREDENTIAL NAV_MODE MAP_VERSION
export NAV_ASSUME_BRINGUP NAV_BRINGUP_CMD EDGE_AGENT_DIR MAP_YAML
export NAV_MODE="${NAV_MODE:-nav2}"
export MAP_VERSION="${MAP_VERSION:-yahboomcar}"
export NAV_ASSUME_BRINGUP="${NAV_ASSUME_BRINGUP:-true}"

if [[ -z "${PLATFORM_API_URL:-}" || -z "${DEVICE_CREDENTIAL:-}" ]]; then
  echo "agent.env 里必须设置 PLATFORM_API_URL 和 DEVICE_CREDENTIAL"
  exit 1
fi

if [[ ! -f "$EDGE_AGENT_DIR/nav_supervisor.py" ]]; then
  echo "找不到 $EDGE_AGENT_DIR/nav_supervisor.py"
  exit 1
fi

echo "PLATFORM_API_URL=$PLATFORM_API_URL"
echo "EDGE_AGENT_DIR=$EDGE_AGENT_DIR"
echo "MAP_VERSION=$MAP_VERSION NAV_ASSUME_BRINGUP=$NAV_ASSUME_BRINGUP"
cd "$EDGE_AGENT_DIR"
exec python3 nav_supervisor.py
