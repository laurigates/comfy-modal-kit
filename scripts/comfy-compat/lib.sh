# shellcheck shell=bash
# Shared helpers for the comfy-compat scripts. Sourced, never executed.
#
# Every script here runs both in GitHub Actions (called from
# .github/workflows/comfy-compat.yml) and on a workstation, so nothing may
# assume a runner: GITHUB_OUTPUT / GITHUB_STEP_SUMMARY are optional, and
# annotations degrade to plain stderr lines that still say what failed.

set -euo pipefail

COMPAT_SCRIPTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export COMPAT_SCRIPTS_DIR

log() { printf '[comfy-compat] %s\n' "$*" >&2; }

# Annotation-safe message: GitHub reads %, CR and LF in a workflow command as
# control characters, and a pack's log line can carry any of them.
_escape_annotation() {
  local s="$1"
  s="${s//'%'/'%25'}"
  s="${s//$'\r'/'%0D'}"
  s="${s//$'\n'/'%0A'}"
  printf '%s' "$s"
}

notice() { printf '::notice::%s\n' "$(_escape_annotation "$*")"; }
warn() { printf '::warning::%s\n' "$(_escape_annotation "$*")"; }
error() { printf '::error::%s\n' "$(_escape_annotation "$*")"; }
die() {
  error "$*"
  exit 1
}

# set_output KEY VALUE — single-line values only; a newline in VALUE would let
# it write a second key, so it is refused rather than silently split.
set_output() {
  local key="$1" value="$2"
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* ]] || die "output ${key} contains a newline"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$key" "$value" >>"$GITHUB_OUTPUT"
  fi
  printf '%s=%s\n' "$key" "$value" >&2
}

# record_tier TIER STATUS DETAIL — STATUS in pass|fail|skip. The summary step
# and the issue reporter read these files, never the step logs.
record_tier() {
  local tier="$1" status="$2" detail="${3:-}"
  : "${COMPAT_RESULTS_DIR:?COMPAT_RESULTS_DIR must be set}"
  case "$status" in pass | fail | skip) ;; *) die "bad tier status: ${status}" ;; esac
  mkdir -p "$COMPAT_RESULTS_DIR"
  jq -n --arg tier "$tier" --arg status "$status" --arg detail "$detail" \
    '{tier: $tier, status: $status, detail: $detail}' >"${COMPAT_RESULTS_DIR}/tier-${tier}.json"
  log "tier ${tier}: ${status}${detail:+ — ${detail}}"
}

# Strict version check for anything that later reaches npm, a branch name or a
# prompt: it came out of a file in a repository we do not control.
is_semver() { [[ "$1" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.+][0-9A-Za-z.-]+)?$ ]]; }

# Pack directory names become URL segments (/extensions/<name>/) and paths.
is_pack_name() { [[ "$1" =~ ^[A-Za-z0-9._-]+$ && "$1" != "." && "$1" != ".." ]]; }

# Newline list -> one trimmed, non-empty, non-comment item per line.
list_items() {
  printf '%s\n' "$1" | sed -e 's/#.*$//' -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' | sed '/^$/d'
}

# derive_extension_names FILE... — the `registerExtension({ ... name: "<literal>"`
# names in the given .js files, sorted and unique, one per line. -0777 slurps
# each file, so `registerExtension({` and `name:` may sit on different lines;
# [^{}]*? keeps the match inside the object literal's first level, before any
# nested method body.
derive_extension_names() {
  (($# > 0)) || return 0
  # shellcheck disable=SC2016 # the backticks are a regex character class
  perl -0777 -ne 'while (/registerExtension\(\s*\{[^{}]*?\bname\s*:\s*(["\x27`])([^"\x27`\n]+)\1/g) { print "$2\n" }' "$@" | sort -u
}

# pack_traceback LOG PACK_NAME — when the (ANSI-stripped) server log holds a
# traceback frame inside custom_nodes/<pack>/, print a one-line description
# (the closing exception, else the frame) and return 0; else return 1. The
# frames themselves go to stderr for the job log.
pack_traceback() {
  local log_file="$1" pack="$2" frames first exc
  frames=$(grep -nE "File \".*custom_nodes/${pack//./\\.}/" "$log_file") || return 1
  printf '%s\n' "$frames" | head -n 20 >&2
  first=$(head -n 1 <<<"$frames")
  # The exception line that closes that traceback, for the issue text.
  exc=$(tail -n +"${first%%:*}" "$log_file" | grep -m 1 -E '^[A-Za-z_][A-Za-z0-9_.]*(Error|Exception|Exit|Interrupt)\b' || true)
  printf '%s\n' "${exc:-${first#*:}}"
}

# strip_ansi IN OUT — ComfyUI colours its log lines even when stdout is not a
# TTY; every check reads the log with ANSI escapes stripped so a colour code
# can't hide a match.
strip_ansi() { sed -E $'s/\x1b\\[[0-9;]*[A-Za-z]//g' "$1" >"$2"; }
