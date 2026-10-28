#!/usr/bin/env bash
# Tier b — load the pack into a real ComfyUI server and check what it serves.
#
#   env COMFYUI_DIR         checkout (read-only: all state goes to WORK_DIR)
#   env VENV_DIR            venv from install-comfyui.sh
#   env PACK_DIR, PACK_NAME the pack and its custom_nodes/ directory name
#   env WEB_DIR             the pack's WEB_DIRECTORY (from pack-info.sh; may be empty)
#   env NODE_CLASSES        newline list asserted present in /object_info
#   env WORK_DIR            scratch: --base-directory, pid file
#   env LOG_DIR             comfyui.log, object_info.json, extensions.json
#   env COMPAT_RESULTS_DIR  tier verdict file
#   env PORT                default 8188;  START_TIMEOUT  seconds, default 300
#
# Leaves the server RUNNING (pid in $WORK_DIR/server.pid) for the browser
# tier; stop-server.sh ends it. The pack is COPIED in rather than symlinked so
# the server sees a plain directory, exactly as ComfyUI-Manager installs one,
# and so the checkout under test stays untouched.
#
# The import verdict is positive, not just "no error seen": ComfyUI prints one
# "Import times" line per custom-node module, and the pack's line must be
# present and must not say IMPORT FAILED. A pack that ComfyUI silently skipped
# (no NODE_CLASS_MAPPINGS, refused by policy) has no clean line and goes red.
#
# A port that is already answering is a SETUP failure (tier-setup.json), not a
# backend one: the readiness poll would otherwise accept the other server,
# read a still-empty log, and blame the pack for "never loading". Locally the
# default 8188 is exactly where a live ComfyUI listens, so run-local.sh uses
# another port.
#
# Outputs: web_files — how many files /extensions lists under
# /extensions/<pack>/ (counted whether or not WEB_DIR could be read, so the
# browser tier can tell "no frontend" from "frontend we could not parse").
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

: "${COMFYUI_DIR:?}" "${VENV_DIR:?}" "${PACK_DIR:?}" "${PACK_NAME:?}" "${WORK_DIR:?}" "${LOG_DIR:?}" "${COMPAT_RESULTS_DIR:?}"
is_pack_name "$PACK_NAME" || die "bad pack name '${PACK_NAME}'"
port="${PORT:-8188}"
timeout="${START_TIMEOUT:-300}"
url="http://127.0.0.1:${port}"
python="${VENV_DIR}/bin/python"

fail() {
  record_tier backend fail "$1"
  error "backend: $1"
  exit 1
}

served=()
mkdir -p "$WORK_DIR" "$LOG_DIR"
# Any HTTP answer at all (even a 404) means the port is taken.
if curl -sS -o /dev/null --max-time 5 "${url}/" 2>/dev/null; then
  record_tier setup fail "port ${port} is already serving HTTP before ComfyUI was started; pick a free PORT"
  die "setup: ${url} already answers — another server holds port ${port}; refusing to test against it"
fi
base="${WORK_DIR}/base"
rm -rf "$base"
mkdir -p "${base}/custom_nodes"
dest="${base}/custom_nodes/${PACK_NAME}"
mkdir -p "$dest"
tar -C "$PACK_DIR" --exclude=./.git --exclude=./node_modules -cf - . | tar -C "$dest" -xf -

# A pack's own Python requirements, constrained to every exact pin ComfyUI
# makes, so a loose `comfyui-frontend-package>=1.40` in a pack can never move
# the frontend this run is supposed to be testing.
if [[ -f "${dest}/requirements.txt" ]] && grep -qvE '^[[:space:]]*(#|$)' "${dest}/requirements.txt"; then
  constraints="${WORK_DIR}/constraints.txt"
  grep -E '^[A-Za-z0-9_.-]+[[:space:]]*==' "${COMFYUI_DIR}/requirements.txt" >"$constraints" || true
  log "installing ${PACK_NAME}/requirements.txt (constrained to ComfyUI's exact pins)"
  uv pip install --python "$python" -r "${dest}/requirements.txt" -c "$constraints" ||
    fail "pip could not install ${PACK_NAME}/requirements.txt against ComfyUI's pins"
fi

server_log="${LOG_DIR}/comfyui.log"
log "starting ComfyUI on ${url} (log: ${server_log})"
(
  cd "$COMFYUI_DIR" || exit 1
  exec "$python" main.py --cpu --listen 127.0.0.1 --port "$port" \
    --base-directory "$base" --disable-auto-launch
) >"$server_log" 2>&1 &
pid=$!
echo "$pid" >"${WORK_DIR}/server.pid"

deadline=$((SECONDS + timeout))
until curl -fsS -o "${LOG_DIR}/system_stats.json" "${url}/system_stats" 2>/dev/null; do
  if ! kill -0 "$pid" 2>/dev/null; then
    tail -n 60 "$server_log" >&2 || true
    fail "ComfyUI exited before serving /system_stats (see comfyui.log)"
  fi
  if ((SECONDS >= deadline)); then
    tail -n 60 "$server_log" >&2 || true
    fail "ComfyUI did not answer /system_stats within ${timeout}s"
  fi
  sleep 2
done
# The answer must come from THIS process: the pid we started is alive and the
# payload is ComfyUI's (system.comfyui_version is set by every release since
# the field was added).
if ! kill -0 "$pid" 2>/dev/null; then
  tail -n 60 "$server_log" >&2 || true
  record_tier setup fail "something answered /system_stats on port ${port} but the ComfyUI we started had exited (port clash?)"
  die "setup: the server answering ${url} is not the one this tier started"
fi
version=$(jq -r '.system.comfyui_version // empty' "${LOG_DIR}/system_stats.json" 2>/dev/null) || version=""
[[ -n "$version" ]] || fail "/system_stats answered without system.comfyui_version — not a ComfyUI server, or its API changed"
log "server up after ~${SECONDS}s: $(jq -c '.system | {comfyui_version, required_frontend_version}' "${LOG_DIR}/system_stats.json")"

# --- import verdict ---------------------------------------------------------
plain_log="${WORK_DIR}/comfyui.plain.log"
strip_ansi "$server_log" "$plain_log"
# Every path ComfyUI prints for this pack ends in custom_nodes/<name>.
import_lines=$(grep -F "seconds" "$plain_log" | grep -E "custom_nodes/${PACK_NAME//./\\.}[[:space:]]*\$" || true)
if grep -q 'IMPORT FAILED' <<<"$import_lines"; then
  grep -B2 -A40 -F "custom_nodes/${PACK_NAME}" "$plain_log" | head -n 60 >&2 || true
  # nodes.py logs "Cannot import <path> module for custom nodes: <exception>".
  cause=$(grep -F "custom_nodes/${PACK_NAME} module for custom nodes:" "$plain_log" | head -n 1 | sed -E 's/.*module for custom nodes: //')
  fail "ComfyUI reports '(IMPORT FAILED)' for custom_nodes/${PACK_NAME}: ${cause:-see comfyui.log}"
fi
[[ -n "$import_lines" ]] ||
  fail "no 'Import times' line for custom_nodes/${PACK_NAME}: ComfyUI never loaded the pack (skipped, refused, or the log format changed)"

# A traceback frame inside the pack, at import or later, is a pack error even
# when ComfyUI recovered from it. tier-browser.sh repeats this scan after the
# smoke, when the pack's own routes have been called.
if exc=$(pack_traceback "$plain_log" "$PACK_NAME"); then
  fail "traceback through custom_nodes/${PACK_NAME}/ in the server log: ${exc}"
fi

# --- /object_info -------------------------------------------------------------
curl -fsS -o "${LOG_DIR}/object_info.json" "${url}/object_info" || fail "GET /object_info failed"
missing=()
while IFS= read -r cls; do
  [[ -n "$cls" ]] || continue
  jq -e --arg c "$cls" 'has($c)' "${LOG_DIR}/object_info.json" >/dev/null || missing+=("$cls")
done < <(list_items "${NODE_CLASSES:-}")
((${#missing[@]} == 0)) || fail "node class(es) missing from /object_info: ${missing[*]}"

# --- /extensions ---------------------------------------------------------------
curl -fsS -o "${LOG_DIR}/extensions.json" "${url}/extensions" || fail "GET /extensions failed"
prefix="/extensions/$(jq -rn --arg n "$PACK_NAME" '$n|@uri')/"
mapfile -t served < <(jq -r --arg p "$prefix" '.[] | select(startswith($p))' "${LOG_DIR}/extensions.json")
if [[ -n "${WEB_DIR:-}" ]] && ((${#served[@]} == 0)); then
  fail "/extensions lists no file under ${prefix} although the pack declares WEB_DIRECTORY=${WEB_DIR}"
fi
for path in "${served[@]}"; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "${url}${path}") || code=000
  [[ "$code" == 200 ]] || fail "${path} is listed by /extensions but answers HTTP ${code}"
done
log "/extensions serves ${#served[@]} file(s) under ${prefix}"
set_output web_files "${#served[@]}"

record_tier backend pass "imported cleanly; $(list_items "${NODE_CLASSES:-}" | wc -l | tr -d ' ') node class(es) present; ${#served[@]} web file(s) served"
