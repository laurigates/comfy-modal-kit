#!/usr/bin/env bash
# Decide which ComfyUI refs this run tests, as a matrix for the compat job.
#
#   env COMFYUI_REF       optional override (tag, branch or commit SHA)
#   env COMFYUI_REPO_URL  default https://github.com/comfyanonymous/ComfyUI
#
# Output `matrix`: {"include":[{"slot":..., "ref":...}, ...]}.
#
# A *slot* is the stable identity of a target across runs, and is what the
# tracking issue keys on: "release" is whatever the newest vX.Y.Z tag is
# today, "master" is the moving branch, "custom" is a dispatch override. A
# release that broke yesterday and is superseded by a green tag today is the
# same slot going green, not an orphaned failure nobody re-tests.
#
# "Latest release" is the highest vX.Y.Z tag by `sort -V`, read straight off
# the remote. Never the GitHub "latest release" API: that is whatever was last
# marked latest, and pre-release-shaped tags are excluded by the regex anyway.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

repo_url="${COMFYUI_REPO_URL:-https://github.com/comfyanonymous/ComfyUI}"
override="${COMFYUI_REF:-}"
override="${override//[[:space:]]/}"

if [[ -n "$override" ]]; then
  # A ref reaches git as an argument and a branch name later; keep it boring.
  [[ "$override" =~ ^[A-Za-z0-9._/-]+$ && "$override" != *..* && "$override" != -* ]] ||
    die "comfyui-ref '${override}' is not a plain tag, branch or SHA"
  matrix=$(jq -cn --arg ref "$override" '{include: [{slot: "custom", ref: $ref}]}')
else
  latest=$(git ls-remote --tags --refs "$repo_url" 'v*' |
    awk '{sub("refs/tags/", "", $2); print $2}' |
    grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -n 1) || true
  [[ -n "$latest" ]] || die "no vX.Y.Z tag found on ${repo_url}"
  matrix=$(jq -cn --arg rel "$latest" \
    '{include: [{slot: "release", ref: $rel}, {slot: "master", ref: "master"}]}')
fi

set_output matrix "$matrix"
