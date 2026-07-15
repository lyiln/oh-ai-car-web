#!/usr/bin/env bash
# 停止 start_all_nav / yahboom-nav-bringup 拉起的后台进程
set -euo pipefail
LOG_DIR="${LOG_DIR:-/tmp/oh-ai-car-nav}"

stop_pidfile() {
  local file="$1"
  local name="$2"
  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file" 2>/dev/null || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" 2>/dev/null; then
      echo "stopping $name pid=$pid"
      kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
}

stop_pidfile "$LOG_DIR/bringup1.pid" "laser/bringup1"
stop_pidfile "$LOG_DIR/bringup2.pid" "display/bringup2"
stop_pidfile "$LOG_DIR/nav.pid" "navigation"

# 再清一层常见残留（避免多开）
pkill -f 'yahboomcar_nav.*laser_bringup' 2>/dev/null || true
pkill -f 'yahboomcar_nav.*navigation_dwa' 2>/dev/null || true
pkill -f 'yahboomcar_nav.*display_nav' 2>/dev/null || true
echo "done. 若代理还在跑，到其终端 Ctrl+C"
