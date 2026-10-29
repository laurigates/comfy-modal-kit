#!/usr/bin/env bash
# Check out ComfyUI at TARGET_REF and read the frontend version it pins.
#
#   env TARGET_REF        tag, branch or commit SHA (required)
#   env COMFYUI_DIR       checkout directory; reused if it is already a clone
#   env COMFYUI_REPO_URL  default https://github.com/comfyanonymous/ComfyUI
#
# Outputs: comfyui_sha, frontend_version, requirements_hash.
#
# The frontend version under test comes from THIS ref's requirements.txt
# (`comfyui-frontend-package==X`), never from npm's latest: the point of the
# check is "does the pack work with what a user of this ComfyUI actually
# gets", and ComfyUI pins the frontend exactly. A ref whose requirements do
# not pin it exactly is an error, not a guess.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

: "${TARGET_REF:?TARGET_REF must be set}"
: "${COMFYUI_DIR:?COMFYUI_DIR must be set}"
repo_url="${COMFYUI_REPO_URL:-https://github.com/comfyanonymous/ComfyUI}"

if [[ ! -d "${COMFYUI_DIR}/.git" ]]; then
  mkdir -p "$COMFYUI_DIR"
  git -C "$COMFYUI_DIR" init -q
  git -C "$COMFYUI_DIR" remote add origin "$repo_url"
fi

# --depth 1 by ref works for tags, branches and (on GitHub) full commit SHAs.
log "fetching ${TARGET_REF} from ${repo_url}"
git -C "$COMFYUI_DIR" fetch -q --depth 1 --no-tags origin "$TARGET_REF" ||
  die "cannot fetch ComfyUI ref '${TARGET_REF}' from ${repo_url}"
git -C "$COMFYUI_DIR" -c advice.detachedHead=false checkout -q --force FETCH_HEAD
sha=$(git -C "$COMFYUI_DIR" rev-parse HEAD)

req="${COMFYUI_DIR}/requirements.txt"
[[ -f "$req" ]] || die "ComfyUI ${TARGET_REF} (${sha}) has no requirements.txt"
frontend=$(sed -nE 's/^[[:space:]]*comfyui-frontend-package[[:space:]]*==[[:space:]]*([^[:space:];#]+).*/\1/p' "$req" | head -n 1)
[[ -n "$frontend" ]] ||
  die "ComfyUI ${TARGET_REF} (${sha}) does not pin comfyui-frontend-package==X in requirements.txt"
is_semver "$frontend" || die "unexpected comfyui-frontend-package version '${frontend}'"

set_output comfyui_sha "$sha"
set_output frontend_version "$frontend"
set_output requirements_hash "$(sha256sum "$req" | cut -c1-16)"
