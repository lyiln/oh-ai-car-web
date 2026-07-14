#!/usr/bin/env bash
# 在 Jetson 宿主机执行：进容器并一键启动导航+代理
#
# 用法:
#   bash edge-agent/scripts/host-start-all.sh ba28
#   或: CONTAINER=ba28 bash edge-agent/scripts/host-start-all.sh

set -euo pipefail
CONTAINER="${1:-${CONTAINER:-}}"
if [[ -z "$CONTAINER" ]]; then
  echo "用法: $0 <容器名或ID>"
  echo "先: docker ps --format 'table {{.ID}}\t{{.Names}}\t{{.Status}}'"
  exit 1
fi

# 确保容器内有最新 edge-agent（宿主机 ~/oh-ai-car-web/edge-agent）
if [[ -d "$HOME/oh-ai-car-web/edge-agent" ]]; then
  echo "同步 edge-agent -> 容器 /tmp/edge-agent"
  tar -C "$HOME/oh-ai-car-web" -cf - edge-agent | docker exec -i "$CONTAINER" tar -C /tmp -xf -
fi

docker exec -it "$CONTAINER" bash -lc '
  cd /tmp/edge-agent
  sed -i "s/\r$//" start_all_nav.sh start_nav_agent.sh scripts/*.sh agent.env 2>/dev/null || true
  chmod +x start_all_nav.sh start_nav_agent.sh scripts/*.sh
  bash start_all_nav.sh
'
