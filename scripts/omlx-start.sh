#!/bin/sh
# Explicit start of the omlx server for the AAM local worker. See docs/omlx-server.md.
# Usage: omlx-start.sh [--dry-run] [--max-concurrent N]
# --dry-run prints the resolved command and validates config WITHOUT starting omlx or loading a model.
# Never run from health checks / planner. No launchd, no KeepAlive.
set -eu
ROOT=$(cd "$(dirname "$0")/.." && pwd)
. "${OMLX_ENV:-$ROOT/config/omlx.env}"
STATE=${OMLX_STATE_DIR:-$HOME/.omlx/aam}
PIDFILE=$STATE/omlx.pid
LOG=$STATE/omlx.log
ACTIVE_RUN_FILE=${OMLX_ACTIVE_RUN_FILE:-$STATE/local-run.active}
DRY=0
while [ $# -gt 0 ]; do
  case $1 in
    --dry-run) DRY=1 ;;
    --max-concurrent) shift; OMLX_MAX_CONCURRENT=$1 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done
OMLX_BIN=${OMLX_BIN:-omlx}

[ "$OMLX_HOST" = 127.0.0.1 ] || { echo "refusing: host must be 127.0.0.1" >&2; exit 1; }

# Total RAM (GB) and hard memory ceiling.
MEM_BYTES=${OMLX_MEM_BYTES:-$(/usr/sbin/sysctl -n hw.memsize)}
TOTAL_GB=$((MEM_BYTES / 1073741824))
LIMIT_GB=$((TOTAL_GB - OMLX_SYSTEM_RESERVE_GB))
[ "$LIMIT_GB" -ge 2 ] || { echo "refusing: only ${TOTAL_GB}GB RAM, cannot keep ${OMLX_SYSTEM_RESERVE_GB}GB for system" >&2; exit 1; }

# Locate existing weights (no download).
WEIGHTS=
for c in $OMLX_WEIGHT_CANDIDATES; do
  [ -f "$c/config.json" ] && { WEIGHTS=$c; break; }
done
if [ -z "$WEIGHTS" ]; then
  echo "gemma4 e4b MLX weights not found on disk (searched: $OMLX_WEIGHT_CANDIDATES)." >&2
  echo "Download them explicitly (size check first) or set OMLX_WEIGHT_CANDIDATES; this script never downloads." >&2
  [ "$DRY" = 1 ] || exit 1
  WEIGHTS="<missing>"
fi

set -- "$OMLX_BIN" serve --model-dir "$OMLX_MODEL_DIR" --host "$OMLX_HOST" --port "$OMLX_PORT" \
  --paged-ssd-cache-dir "$OMLX_SSD_CACHE_DIR" --paged-ssd-cache-max-size "$OMLX_SSD_CACHE_MAX" \
  --memory-guard-gb "$LIMIT_GB" --max-concurrent-requests "$OMLX_MAX_CONCURRENT"

if [ "$DRY" = 1 ]; then
  echo "dry-run: no server started, no model loaded"
  echo "weights: $WEIGHTS -> $OMLX_MODEL_DIR/$OMLX_MODEL_NAME"
  echo "ram: ${TOTAL_GB}GB total, memory ceiling ${LIMIT_GB}GB, system reserve ${OMLX_SYSTEM_RESERVE_GB}GB"
  echo "ssd cache: $OMLX_SSD_CACHE_DIR (max $OMLX_SSD_CACHE_MAX), idle unload: ${OMLX_IDLE_MINUTES}min"
  echo "cmd: $*"
  exit 0
fi

if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
  echo "already running (pid $(cat "$PIDFILE"))" >&2; exit 1
fi
mkdir -p "$STATE" "$OMLX_MODEL_DIR" "$OMLX_SSD_CACHE_DIR"
ln -sfn "$WEIGHTS" "$OMLX_MODEL_DIR/$OMLX_MODEL_NAME"

# Memory guard: refuse if the system reserve is already not available.
FREE_GB=$(/usr/bin/vm_stat | awk '/page size of/{ps=$8} /Pages (free|inactive|speculative)/{n+=$3} END{printf "%d", n*ps/1073741824}')
if [ "$FREE_GB" -lt "$OMLX_SYSTEM_RESERVE_GB" ] && [ "${OMLX_FORCE:-0}" != 1 ]; then
  echo "refusing: only ~${FREE_GB}GB available (< ${OMLX_SYSTEM_RESERVE_GB}GB). Free memory first or OMLX_FORCE=1." >&2
  exit 1
fi

# Own process group (PGID = PID) so omlx-stop.sh can clean up the whole server tree.
set -m
"$@" >>"$LOG" 2>&1 &
PID=$!
echo "$PID" >"$PIDFILE"

# Idle watchdog: log quietness alone is insufficient—a long request may produce no log output.
# Only unload after the timeout when AAM has no active local-model run/request marker.
(
  while kill -0 "$PID" 2>/dev/null; do
    sleep 60
    NOW=$(date +%s); M=$(stat -f %m "$LOG" 2>/dev/null || echo "$NOW")
    if [ ! -f "$ACTIVE_RUN_FILE" ] && [ $((NOW - M)) -ge $((OMLX_IDLE_MINUTES * 60)) ]; then
      OMLX_STATE_DIR=$STATE "$ROOT/scripts/omlx-stop.sh" >/dev/null 2>&1
      break
    fi
  done
) >/dev/null 2>&1 &
echo "started omlx pid $PID on $OMLX_HOST:$OMLX_PORT (log $LOG)"
