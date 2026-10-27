#!/bin/sh
set -eu

AGENT="/opt/agent/desk_agent.py"
CLOUD="${CLOUD_URL:-}"
NAME="${BOARD_NAME:-Natasha}"
CONFIG="$HOME/.config/nebius-desk/agent.json"
API_PID=""

start_api() {
  mkdir -p "$HOME/data"
  cd /opt/api
  python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 &
  API_PID=$!
  # Wait until the desk API answers before the agent dials in.
  i=0
  while [ "$i" -lt 40 ]; do
    if python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=1)" 2>/dev/null; then
      echo "desk api ready" >&2
      return 0
    fi
    i=$((i + 1))
    sleep 0.25
  done
  echo "desk api failed to start" >&2
  return 1
}

cleanup() {
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
    if [ ! -f "$CONFIG" ]; then
      if [ -z "$CLOUD" ]; then
        echo "not paired — run: docker compose run --rm natasha pair" >&2
        exit 1
      fi
      echo "no saved pair yet — starting pair against $CLOUD" >&2
      python "$AGENT" pair --cloud "$CLOUD" --name "$NAME"
    fi
    start_api
    echo "cloud board online as $NAME — real shell/files/health; chat Nano/Lightning/Super (no local/auto)" >&2
    exec python "$AGENT" run ${CLOUD:+--cloud "$CLOUD"}
    ;;
  api)
    exec python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --app-dir /opt/api
    ;;
  sh|bash)
    exec /bin/bash "$@"
    ;;
  *)
    echo "usage: pair | run | api | bash" >&2
    exit 1
    ;;
esac
