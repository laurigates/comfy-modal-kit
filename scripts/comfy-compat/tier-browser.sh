#!/usr/bin/env bash
# Tier c — run smoke.cjs against the server tier-backend.sh left running.
#
#   env PACK_NAME, EXTENSION_NAMES_JSON (from pack-info.sh), LOG_DIR, WORK_DIR,
#       COMPAT_RESULTS_DIR, PORT (default 8188)
#   env NODE_PATH  must resolve `playwright` (the workflow installs it there)
#
# Which extensions to assert: EXTENSION_NAMES_JSON when pack-info.sh found any.
# When it found none, the SERVER decides, not the source parse: if /extensions
# lists files under /extensions/<pack>/ (tier-backend.sh saved the listing),
# the names are read out of those served files — a WEB_DIRECTORY computed with
# os.path.join is invisible to pack-info.sh but not to ComfyUI. Only a pack the
# server serves nothing for is skipped.
#
# After the smoke the server log is scanned again for traceback frames inside
# the pack: the page has now called the pack's own HTTP routes, and a handler
# that raises shows up only there (the page just sees a 500 from a URL outside
# /extensions/<pack>/).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

: "${PACK_NAME:?}" "${LOG_DIR:?}" "${WORK_DIR:?}" "${COMPAT_RESULTS_DIR:?}"
names_json="${EXTENSION_NAMES_JSON:-[]}"
port="${PORT:-8188}"
url="http://127.0.0.1:${port}"

fail() {
  record_tier browser fail "$1"
  error "browser: $1"
  exit 1
}

if [[ "$(jq 'length' <<<"$names_json")" == 0 ]]; then
  prefix="/extensions/$(jq -rn --arg n "$PACK_NAME" '$n|@uri')/"
  served=()
  if [[ -f "${LOG_DIR}/extensions.json" ]]; then
    mapfile -t served < <(jq -r --arg p "$prefix" '.[] | select(startswith($p))' "${LOG_DIR}/extensions.json")
  fi
  if ((${#served[@]} == 0)); then
    notice "browser: the server serves nothing under ${prefix} and no extension-names were given; nothing to smoke"
    record_tier browser skip "no frontend extensions to check (nothing served under ${prefix})"
    exit 0
  fi
  fetched="${WORK_DIR}/served-web"
  rm -rf "$fetched"
  mkdir -p "$fetched"
  files=()
  for i in "${!served[@]}"; do
    [[ "${served[$i]}" =~ \.m?js$ ]] || continue
    curl -fsS -o "${fetched}/${i}.js" "${url}${served[$i]}" || fail "could not fetch ${served[$i]} to read its extension names"
    files+=("${fetched}/${i}.js")
  done
  names=$(derive_extension_names "${files[@]}")
  [[ -n "$names" ]] ||
    fail "the server serves ${#served[@]} file(s) under ${prefix} but no registerExtension({ name: \"...\" }) literal was found in them — pass the extension-names input"
  names_json=$(printf '%s\n' "$names" | jq -R . | jq -cs 'map(select(length > 0))')
  notice "browser: extension names read from the ${#served[@]} file(s) the server serves under ${prefix}: $(jq -r 'join(", ")' <<<"$names_json")"
fi

out="${LOG_DIR}/smoke"
mkdir -p "$LOG_DIR"
set +e
COMFYUI_URL="$url" PACK_NAME="$PACK_NAME" EXTENSION_NAMES_JSON="$names_json" OUT_DIR="$out" \
  node "${COMPAT_SCRIPTS_DIR}/smoke.cjs" 2>&1 | tee "${LOG_DIR}/smoke.log"
status=${PIPESTATUS[0]}
set -e

# Server-side errors the smoke provoked (the backend tier already failed on
# any frame present at startup, so every frame found now is new).
server_error=""
if [[ -f "${LOG_DIR}/comfyui.log" ]]; then
  plain_log="${WORK_DIR}/comfyui.after-smoke.plain.log"
  strip_ansi "${LOG_DIR}/comfyui.log" "$plain_log"
  if exc=$(pack_traceback "$plain_log" "$PACK_NAME"); then
    server_error="server traceback through custom_nodes/${PACK_NAME}/ while the UI was loaded: ${exc}"
  fi
fi

if [[ -f "${out}/smoke.json" ]] && jq -e '.ok == true' "${out}/smoke.json" >/dev/null && [[ "$status" == 0 ]]; then
  [[ -z "$server_error" ]] || fail "$server_error"
  record_tier browser pass "$(jq -r '"registered: " + (.expected | join(", ")) + " (frontend " + (.frontendVersion // "?") + ")"' "${out}/smoke.json")"
  exit 0
fi
detail="smoke harness exited ${status} without a verdict (see smoke.log)"
if [[ -f "${out}/smoke.json" ]]; then
  detail=$(jq -r '.failures | map(split("\n")[0]) | join("; ") | .[0:600]' "${out}/smoke.json")
fi
fail "${detail}${server_error:+; ${server_error}}"
