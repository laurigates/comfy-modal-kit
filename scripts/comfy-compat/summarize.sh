#!/usr/bin/env bash
# Fold the tier verdicts of one target into result.json + the step summary,
# and exit non-zero when any tier failed (this is what turns the job red).
#
#   env COMPAT_RESULTS_DIR  tier-*.json from the tier scripts; result.json written here
#   env SLOT, TARGET_REF, COMFYUI_SHA, FRONTEND_VERSION, PACK_NAME
#   env RUN_URL             optional, recorded for the issue
#
# A tier with no verdict file did not run. For the browser tier after a red
# backend that is expected ("blocked"); anything else missing means a step
# before the tiers failed (checkout, venv, playwright install), reported as
# the "setup" tier so the issue never claims a pack defect it did not see.
# A script that knows WHY setup failed (a port clash, say) writes
# tier-setup.json itself, and its detail replaces the generic one.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

: "${COMPAT_RESULTS_DIR:?}" "${SLOT:?}"
mkdir -p "$COMPAT_RESULTS_DIR"

tier_json() {
  local f="${COMPAT_RESULTS_DIR}/tier-$1.json"
  if [[ -f "$f" ]]; then cat "$f"; else jq -n --arg t "$1" '{tier: $t, status: "not-run", detail: ""}'; fi
}

result=$(jq -n \
  --arg slot "$SLOT" --arg ref "${TARGET_REF:-}" --arg sha "${COMFYUI_SHA:-}" \
  --arg fe "${FRONTEND_VERSION:-}" --arg pack "${PACK_NAME:-}" --arg run "${RUN_URL:-}" \
  --argjson types "$(tier_json types)" --argjson backend "$(tier_json backend)" --argjson browser "$(tier_json browser)" \
  --argjson setup "$(tier_json setup)" '
  ($backend.status == "fail") as $backend_red
  | {types: $types, backend: $backend,
     browser: (if $browser.status == "not-run" and $backend_red
               then $browser + {status: "blocked", detail: "not run: the backend tier failed"} else $browser end)}
  | . as $tiers
  | ([$tiers | to_entries[] | select(.value.status == "fail") | .key]) as $failed
  | ([$tiers | to_entries[] | select(.value.status == "not-run") | .key]) as $missing
  | ($setup.status == "fail" or ($missing | length) > 0) as $setup_red
  | {slot: $slot, ref: $ref, comfyui_sha: $sha, frontend_version: $fe, pack: $pack, run_url: $run,
     tiers: ($tiers + (if $setup_red
               then {setup: {tier: "setup", status: "fail",
                             detail: (if $setup.status == "fail" then $setup.detail
                                      else "no verdict from " + ($missing | join(", ")) + ": a step before the tiers failed, see the job log" end)}}
               else {} end)),
     failed_tiers: ($failed + (if $setup_red then ["setup"] else [] end))}
  | .ok = ((.failed_tiers | length) == 0)')
printf '%s\n' "$result" >"${COMPAT_RESULTS_DIR}/result.json"

sha="${COMFYUI_SHA:-}"
sha_short="${sha:0:12}"
icon() { case "$1" in pass) echo "✅" ;; fail) echo "❌" ;; skip) echo "⏭️" ;; blocked) echo "⛔" ;; *) echo "❔" ;; esac; }
{
  echo "### ComfyUI compat — \`${PACK_NAME:-?}\` on \`${TARGET_REF:-?}\` (${SLOT})"
  echo
  echo "ComfyUI \`${sha_short:-?}\` · frontend \`${FRONTEND_VERSION:-?}\` (from that ref's requirements.txt)"
  echo
  echo "| Tier | Result | Detail |"
  echo "|---|---|---|"
  jq -r '.tiers | to_entries[] | [.key, .value.status, (.value.detail | gsub("\\|"; "\\|") | gsub("\n"; " "))] | @tsv' <<<"$result" |
    while IFS=$'\t' read -r tier status detail; do
      echo "| ${tier} | $(icon "$status") ${status} | ${detail} |"
    done
  echo
} >>"${GITHUB_STEP_SUMMARY:-/dev/stderr}"

if jq -e '.ok' <<<"$result" >/dev/null; then
  log "all tiers green for ${SLOT} (${TARGET_REF:-?})"
  exit 0
fi
die "compat failed for ${SLOT} (${TARGET_REF:-?}): $(jq -r '.failed_tiers | join(", ")' <<<"$result")"
