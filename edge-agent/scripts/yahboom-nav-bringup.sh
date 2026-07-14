#!/bin/bash
# Yahboom 真车导航 bringup（在**已经进入的同一个 Docker 容器**里执行）
# 供 nav_supervisor 的 NAV_BRINGUP_CMD / start_all_nav.sh 调用。
#
# 用法（容器内）:
#   export SKIP_DISPLAY=1
#   bash scripts/yahboom-nav-bringup.sh

set -euo pipefail

MAP_YAML="${MAP_YAML:-/root/yahboomcar_ros2_ws/yahboomcar_ws/src/yahboomcar_nav/maps/yahboomcar.yaml}"
SKIP_DISPLAY="${SKIP_DISPLAY:-1}"
LOG_DIR="${LOG_DIR:-/tmp/oh-ai-car-nav}"
ROS_SETUP="${ROS_SETUP:-/opt/ros/foxy/setup.bash}"
WS_SETUP="${WS_SETUP:-}"
mkdir -p "$LOG_DIR"

run_bg() {
  local name="$1"
  local cmd="$2"
  local log="$3"
  local pidfile="$4"
  nohup bash -c "
    set +u
    [[ -f \"$ROS_SETUP\" ]] && source \"$ROS_SETUP\"
    [[ -n \"$WS_SETUP\" && -f \"$WS_SETUP\" ]] && source \"$WS_SETUP\"
    set -u
    exec $cmd
  " >"$log" 2>&1 &
  echo $! >"$pidfile"
  echo "[bringup] $name pid=$(cat "$pidfile") log=$log"
}

# 若你的 n1/n2 是别名，把下面改成 alias 展开后的真实命令
BRINGUP1="${BRINGUP1:-ros2 launch yahboomcar_nav laser_bringup_launch.py}"
BRINGUP2="${BRINGUP2:-ros2 launch yahboomcar_nav display_nav_launch.py}"
NAV_LAUNCH="${NAV_LAUNCH:-ros2 launch yahboomcar_nav navigation_dwa_launch.py map:=${MAP_YAML}}"

echo "[bringup] MAP_YAML=$MAP_YAML"
run_bg "laser" "$BRINGUP1" "$LOG_DIR/bringup1.log" "$LOG_DIR/bringup1.pid"
sleep 3

if [[ "$SKIP_DISPLAY" != "1" ]]; then
  run_bg "display" "$BRINGUP2" "$LOG_DIR/bringup2.log" "$LOG_DIR/bringup2.pid"
  sleep 2
else
  echo "[bringup] display skipped (SKIP_DISPLAY=1)"
fi

run_bg "navigation" "$NAV_LAUNCH" "$LOG_DIR/nav.log" "$LOG_DIR/nav.pid"
sleep 5

echo "[bringup] started. logs in $LOG_DIR"
echo "[bringup] check: ros2 action list | grep navigate"
