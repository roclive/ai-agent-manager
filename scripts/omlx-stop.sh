#!/bin/sh
# Stop the omlx server started by omlx-start.sh (pid file only; never pkill by name). Idempotent.
set -eu
STATE=${OMLX_STATE_DIR:-$HOME/.omlx/aam}
PIDFILE=$STATE/omlx.pid
[ -f "$PIDFILE" ] || { echo "not running (no pid file)"; exit 0; }
PID=$(cat "$PIDFILE")
if kill -0 "$PID" 2>/dev/null; then
  # Only signal the group when the server leads its own group (started with set -m).
  PGID=$(ps -o pgid= -p "$PID" 2>/dev/null | tr -d ' ' || true)
  if [ "$PGID" = "$PID" ]; then kill -- "-$PID" 2>/dev/null || true; else kill "$PID" 2>/dev/null || true; fi
  i=0
  while kill -0 "$PID" 2>/dev/null && [ $i -lt 20 ]; do sleep 1; i=$((i + 1)); done
  if kill -0 "$PID" 2>/dev/null; then
    if [ "$PGID" = "$PID" ]; then kill -9 -- "-$PID" 2>/dev/null || true; else kill -9 "$PID" 2>/dev/null || true; fi
  fi
fi
rm -f "$PIDFILE"
echo "stopped"
