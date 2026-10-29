#!/bin/sh
set -eu

AGENT="/opt/agent/desk_agent.py"
CLOUD="${CLOUD_URL:-}"
NAME="${BOARD_NAME:-Natasha}"
CONFIG="$HOME/.config/nebius-desk/agent.json"
API_PID=""
AGENT_PID=""

start_api() {
  mkdir -p "$HOME/data" "$HOME/.config/nebius-desk"
  cd /opt/api
  python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 &
  API_PID=$!
  i=0
  while [ "$i" -lt 40 ]; do
    if python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=1)" 2>/dev/null; then
      echo "desk api ready on 0.0.0.0:8000" >&2
      return 0
    fi
    i=$((i + 1))
    sleep 0.25
  done
  echo "desk api failed to start" >&2
  return 1
}

cleanup() {
  if [ -n "$AGENT_PID" ]; then
    kill "$AGENT_PID" 2>/dev/null || true
  fi
  if [ -n "$API_PID" ]; then
    kill "$API_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

cmd="${1:-run}"
shift || true

case "$cmd" in
  pair)
    if [ -z "$CLOUD" ]; then
      echo "set CLOUD_URL to your desk cloud, e.g. https://nebius-desk-cloud….workers.dev" >&2
      exit 1
    fi
    exec python "$AGENT" pair --cloud "$CLOUD" --name "$NAME"
    ;;
  run)
    if [ -z "$CLOUD" ]; then
      echo "set CLOUD_URL to your desk cloud, e.g. https://nebius-desk-cloud….workers.dev" >&2
      exit 1
    fi
    start_api
    if [ ! -f "$CONFIG" ]; then
      echo "waiting for web setup — POST /setup then claim the Pair ID in Desk" >&2
      while [ ! -f "$CONFIG" ]; do
        sleep 1
      done
    fi
    echo "cloud board online as $NAME — shell/files/health/jobs/browser; chat Nano/Lightning/Super (no local/auto)" >&2
    python "$AGENT" run ${CLOUD:+--cloud "$CLOUD"} &
    AGENT_PID=$!
    wait "$API_PID"
    ;;
  api)
    exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir /opt/api
    ;;
  sh|bash)
    exec /bin/bash "$@"
    ;;
  *)
    echo "usage: pair | run | api | bash" >&2
    exit 1
    ;;
esac
