#!/usr/bin/env bash
# Stop the ComfyUI server tier-backend.sh started (pid in $WORK_DIR/server.pid).
# Safe to call when nothing is running; always exits 0 so it can sit in an
# `if: always()` step without masking the real verdict.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
set +e

: "${WORK_DIR:?WORK_DIR must be set}"
pidfile="${WORK_DIR}/server.pid"
[[ -f "$pidfile" ]] || exit 0
pid=$(cat "$pidfile")
if [[ "$pid" =~ ^[0-9]+$ ]] && kill -0 "$pid" 2>/dev/null; then
  kill "$pid"
  for _ in $(seq 1 20); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.5
  done
  kill -9 "$pid" 2>/dev/null
  log "stopped ComfyUI (pid ${pid})"
fi
rm -f "$pidfile"
exit 0
