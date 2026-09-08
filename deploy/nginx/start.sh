#!/usr/bin/env bash
# Scenara nginx 入口（docker compose，后台常驻）
#
#   ./deploy/nginx/start.sh          # up -d
#   ./deploy/nginx/start.sh down     # 停止
#   ./deploy/nginx/start.sh logs     # 看日志
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"
mkdir -p ../../back-end/data/media

cmd="${1:-up}"
case "$cmd" in
  up)
    docker compose up -d
    echo
    echo "Scenara nginx  http://127.0.0.1:3080  （局域网 http://<本机IP>:3080）"
    echo "媒体直出 /api/v1/media/raw/  →  back-end/data/media"
    echo "不要再走 :3000 预览图/视频。"
    docker compose ps
    ;;
  down|stop)
    docker compose down
    ;;
  logs)
    docker compose logs -f
    ;;
  restart)
    docker compose up -d --force-recreate
    docker compose ps
    ;;
  *)
    echo "usage: $0 [up|down|logs|restart]" >&2
    exit 1
    ;;
esac
