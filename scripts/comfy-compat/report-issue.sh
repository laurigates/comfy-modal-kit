#!/usr/bin/env bash
# Open, update or close the ONE tracking issue for this pack's compat check.
#
#   env RESULTS_ROOT     directory holding one result.json per target (any depth)
#   env EXPECTED_SLOTS   JSON array of the slots this run's matrix contained
#   env COMPAT_RESULT    needs.compat.result; "cancelled" reports nothing
#   env ISSUE_LABEL      default comfy-compat
#   env RUN_URL          this run
#   env GH_TOKEN, GITHUB_REPOSITORY  for gh
#
# Outputs: state (red|green|unchanged), issue_number, fix_slot, fix_json
# (the result object of the target the auto-fix should take on, base64).
#
# Mirrors the registry-health pattern — one labelled issue, commented while it
# stays red, closed with a comment once green — with one addition: the issue
# remembers WHICH targets are failing, keyed by slot (release / master /
# custom) in a hidden marker. A run only rewrites the slots it tested, so a
# dispatch against one custom ref going green cannot close an issue about
# master, and a release slot that moved to a newer, green tag clears itself.
# The exception is `custom`: a dispatch against an arbitrary ref is a one-off
# probe that no scheduled run ever re-tests, so a custom failure is reported by
# the run that saw it and dropped by the next run that did not test it —
# otherwise one red probe would keep the issue open forever.
#
# fix_slot is chosen only among the failures THIS run produced (its artifacts
# are the ones the auto-fix job downloads), never from a carried-over entry,
# and never for a target whose only failure is setup (no pack defect seen).
#
# The lookup reads `gh issue list` (the GraphQL listing), never `--search`:
# the search index lags creation by minutes, which is how a sibling workflow
# in the org filed eight duplicates of one failure.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

: "${RESULTS_ROOT:?}" "${EXPECTED_SLOTS:?}"
label="${ISSUE_LABEL:-comfy-compat}"
run_url="${RUN_URL:-}"
marker_re='<!-- comfy-compat-state: ([A-Za-z0-9+/=]+) -->'

if [[ "${COMPAT_RESULT:-}" == cancelled ]]; then
  notice "compat run was cancelled; leaving the tracking issue as it is"
  set_output state unchanged
  exit 0
fi

# This run's verdicts, one per expected slot. A slot with no result.json never
# reached its summary step: report it as a setup failure rather than skip it,
# or a target that cannot even be set up would read as green forever.
mapfile -t files < <(find "$RESULTS_ROOT" -name result.json -type f 2>/dev/null | sort)
current=$( (for f in "${files[@]}"; do jq -c . "$f"; done) | jq -cs --argjson want "$EXPECTED_SLOTS" --arg run "$run_url" '
  (map({key: .slot, value: .}) | from_entries) as $have
  | [$want[] as $s | $have[$s] // {slot: $s, ref: "", comfyui_sha: "", frontend_version: "", run_url: $run, ok: false,
        failed_tiers: ["setup"],
        tiers: {setup: {tier: "setup", status: "fail", detail: "the job produced no result (it failed or was skipped before the verdict step)"}}}]')

existing_json=$(gh issue list --label "$label" --state open --limit 1 --json number,body) || die "cannot list issues labelled ${label}"
existing=$(jq -r '.[0].number // empty' <<<"$existing_json")
old_state='{}'
if [[ -n "$existing" ]]; then
  body=$(jq -r '.[0].body // ""' <<<"$existing_json")
  if [[ "$body" =~ $marker_re ]]; then
    old_state=$(base64 -d <<<"${BASH_REMATCH[1]}" 2>/dev/null | jq -c 'if type == "object" then . else {} end' 2>/dev/null) || old_state='{}'
    [[ -n "$old_state" ]] || old_state='{}'
  fi
fi

new_state=$(jq -c --argjson cur "$current" '
  (if any($cur[]; .slot == "custom") then . else del(.custom) end)
  | reduce $cur[] as $r (.; if $r.ok then del(.[$r.slot]) else .[$r.slot] = $r end)' <<<"$old_state")
# Only (slot, ref, sha, failing tiers) count as news; the run URL alone does not.
sig() { jq -c 'to_entries | map({s: .key, r: .value.ref, h: .value.comfyui_sha, t: .value.failed_tiers}) | sort_by(.s)' <<<"$1"; }
changed=true
[[ "$(sig "$old_state")" == "$(sig "$new_state")" ]] && changed=false

pick_fix() {
  # Prefer the released target (what users run), then master, then custom.
  jq -c '[.[] | select((.ok | not) and any(.failed_tiers[]; . != "setup"))]
    | (map({key: .slot, value: .}) | from_entries) as $f
    | ($f.release // $f.master // $f.custom // .[0]) // empty' <<<"$current"
}

render_body() {
  local state="$1"
  echo "The scheduled ComfyUI compatibility check of this pack is failing."
  echo
  echo "| Target | Ref | ComfyUI SHA | Frontend | Failing tier(s) | Run |"
  echo "|---|---|---|---|---|---|"
  # Rendered in jq, not `read`: tab is IFS whitespace, so an empty @tsv field
  # (a setup failure has no SHA) would silently shift every later column.
  jq -r 'def v: if . == null or . == "" then "?" else . end;
    to_entries | sort_by(.key)[] | .value
    | "| \(.slot) | `\(.ref | v)` | `\(.comfyui_sha[0:12] | v)` | `\(.frontend_version | v)` | \(.failed_tiers | join(", ")) | \(if (.run_url // "") == "" then "?" else "[run](\(.run_url))" end) |"' <<<"$state"
  echo
  # Details are log text from a run of pack code: inside a code span they
  # cannot render markdown, links or @-mentions in a public issue.
  echo "<details><summary>Failing assertions</summary>"
  echo
  jq -r 'to_entries | sort_by(.key)[] | .value as $r
    | $r.tiers | to_entries[] | select(.value.status == "fail")
    | "- **\($r.slot) / \(.key)**: `" + (.value.detail | gsub("[\r\n]+"; " ") | gsub("`"; "\u0027") | .[0:500]) + "`"' <<<"$state"
  echo
  echo "</details>"
  echo
  echo "The frontend version is the one each ComfyUI ref pins in \`requirements.txt\`; artifacts (server log, smoke output) are on each run."
  echo "This issue is rewritten by the \`comfy-compat\` workflow and closed automatically once every failing target is green again."
  echo
  printf '<!-- comfy-compat-state: %s -->\n' "$(printf '%s' "$state" | base64 -w0)"
}

if [[ "$new_state" == '{}' ]]; then
  if [[ -n "$existing" ]]; then
    tested=$(jq -r 'map("`\(.slot)` (`\(if .ref == "" then "?" else .ref end)`)") | join(", ")' <<<"$current")
    gh issue comment "$existing" --body "Resolved: ${tested} green in ${run_url:-this run}. Closing."
    gh issue close "$existing"
    log "closed #${existing}"
  fi
  set_output state green
  set_output issue_number "${existing:-}"
  exit 0
fi

body_file=$(mktemp)
render_body "$new_state" >"$body_file"
if [[ -n "$existing" ]]; then
  gh issue edit "$existing" --body-file "$body_file" >/dev/null
  if [[ "$changed" == true ]]; then
    {
      echo "Compat state changed in ${run_url:-this run}:"
      echo
      jq -r '.[] | "- `\(.slot)` `\(if .ref == "" then "?" else .ref end)`: " + (if .ok then "green" else "failing — " + (.failed_tiers | join(", ")) end)' <<<"$current"
    } | gh issue comment "$existing" --body-file - >/dev/null
  fi
  number="$existing"
  log "updated #${number} (changed=${changed})"
else
  # Create-if-missing: never recolour a label someone already set up.
  gh label create "$label" --color "D93F0B" --description "ComfyUI compatibility check" >/dev/null 2>&1 || true
  url=$(gh issue create --title "ComfyUI compatibility check failing" --label "$label" --body-file "$body_file")
  number="${url##*/}"
  log "opened #${number}"
fi

set_output state red
set_output issue_number "$number"
fix=$(pick_fix)
if [[ -n "$fix" ]]; then
  set_output fix_slot "$(jq -r '.slot' <<<"$fix")"
  set_output fix_json "$(printf '%s' "$fix" | base64 -w0)"
else
  set_output fix_slot ""
  set_output fix_json ""
fi
