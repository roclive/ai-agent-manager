#!/bin/sh
# Stop the omlx server started by omlx-start.sh (pid file only; never pkill by name). Idempotent.
# A pid file is only trusted if the live process is verifiably AAM's omlx server (its command line
# runs omlx with our --model-dir) and does not match the deny-list; otherwise the pid file is stale
# (PID reuse) and is removed WITHOUT signaling anything.
set -eu
STATE=${OMLX_STATE_DIR:-$HOME/.omlx/aam}
PIDFILE=$STATE/omlx.pid
DENY='aam|ai-agent-manager|OntoKB|ontokb|Paperclip|paperclip|Claude|claude|Codex|codex|ChatGPT|chatgpt'
[ -f "$PIDFILE" ] || { echo "not running (no pid file)"; exit 0; }
PID=$(cat "$PIDFILE")
case $PID in ''|*[!0-9]*) rm -f "$PIDFILE"; echo "stale pid file removed"; exit 0 ;; esac
if kill -0 "$PID" 2>/dev/null; then
  CMD=$(ps -o command= -p "$PID" 2>/dev/null || true)
  case $CMD in
    *omlx*serve*--model-dir*) ok=1 ;;
    *) ok=0 ;;
  esac
  # Deny-list check on the executable and arguments, ignoring the omlx model/cache paths.
  if [ "$ok" = 1 ] && printf '%s' "$CMD" | sed -E 's# --(model-dir|paged-ssd-cache-dir) [^ ]+##g' | grep -Eq "$DENY"; then ok=0; fi
  if [ "$ok" != 1 ]; then
    rm -f "$PIDFILE"
    echo "stale pid file removed (pid $PID is not the AAM omlx server; not signaled)"
    exit 0
  fi
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
