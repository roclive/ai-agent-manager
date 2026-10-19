#!/bin/sh
# Stop the omlx server started by omlx-start.sh (pid file only; never pkill by name). Idempotent.
set -eu
STATE=${OMLX_STATE_DIR:-$HOME/.omlx/aam}
PIDFILE=$STATE/omlx.pid
[ -f "$PIDFILE" ] || { echo "not running (no pid file)"; exit 0; }
PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then
  kill "$PID" 2>/dev/null || true
  i=0
  while kill -0 "$PID" 2>/dev/null && [ $i -lt 20 ]; do sleep 1; i=$((i + 1)); done
  kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
fi
rm -f "$PIDFILE"
echo "stopped"
