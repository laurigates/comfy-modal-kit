#!/usr/bin/env bash
# Run one compat target on a workstation, in the same order and with the same
# scripts as the `compat` job of .github/workflows/comfy-compat.yml.
#
#   run-local.sh <pack-dir> [comfyui-ref]
#
#   env CACHE_DIR       ComfyUI checkouts + venvs, reused across runs
#                       (default ~/.cache/comfy-compat)
#   env RUN_DIR         this run's logs/results/scratch (default: mktemp -d)
#   env PACK_NAME, EXTENSION_NAMES, NODE_CLASSES, PYTHON_VERSION
#                       as the workflow inputs of the same names
#   env PORT            default 18188 — NOT 8188, where a live ComfyUI on a
#                       workstation (or the GPU box) is usually listening;
#                       tier-backend.sh refuses a port that already answers
#   env FRONTEND_VERSION_OVERRIDE  types tier only: test against this version
#                       instead of the ref's pin (for exercising the tier when
#                       the pinned types release is unusable)
#
# Needs: git, jq, curl, perl, uv, bun, node with `playwright` resolvable.
# Exit status is the summary's: 0 when every tier passed or skipped.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

pack_dir="$(cd "${1:?usage: run-local.sh <pack-dir> [comfyui-ref]}" && pwd)"
ref="${2:-}"
cache="${CACHE_DIR:-${HOME}/.cache/comfy-compat}"
run="${RUN_DIR:-$(mktemp -d)}"
mkdir -p "$cache" "$run"
export COMPAT_RESULTS_DIR="${run}/results" LOG_DIR="${run}/logs" WORK_DIR="${run}/work"
outputs="${run}/outputs.env"
: >"$outputs"
export GITHUB_OUTPUT="$outputs"
out() { sed -n "s/^$1=//p" "$outputs" | tail -n 1; }
port="${PORT:-18188}"
trap 'bash "${COMPAT_SCRIPTS_DIR}/stop-server.sh"' EXIT

# targets job
COMFYUI_REF="$ref" bash "${COMPAT_SCRIPTS_DIR}/resolve-targets.sh"
target=$(out matrix | jq -c '.include[0]')
slot=$(jq -r .slot <<<"$target")
target_ref=$(jq -r .ref <<<"$target")
log "target: ${slot} ${target_ref} (run dir ${run})"

# compat job
comfy_dir="${cache}/comfyui-${target_ref//\//_}"
TARGET_REF="$target_ref" COMFYUI_DIR="$comfy_dir" bash "${COMPAT_SCRIPTS_DIR}/checkout-comfyui.sh"
sha=$(out comfyui_sha)
frontend=$(out frontend_version)
venv="${cache}/venv-${target_ref//\//_}-py${PYTHON_VERSION:-3.12}"
COMFYUI_DIR="$comfy_dir" VENV_DIR="$venv" bash "${COMPAT_SCRIPTS_DIR}/install-comfyui.sh"

PACK_DIR="$pack_dir" PACK_NAME="${PACK_NAME:-}" EXTENSION_NAMES="${EXTENSION_NAMES:-}" \
  bash "${COMPAT_SCRIPTS_DIR}/pack-info.sh"
pack_name=$(out pack_name)

PACK_DIR="$pack_dir" FRONTEND_VERSION="${FRONTEND_VERSION_OVERRIDE:-$frontend}" \
  bash "${COMPAT_SCRIPTS_DIR}/tier-types.sh" || true

backend_ok=true
COMFYUI_DIR="$comfy_dir" VENV_DIR="$venv" PACK_DIR="$pack_dir" PACK_NAME="$pack_name" \
  WEB_DIR="$(out web_dir)" NODE_CLASSES="${NODE_CLASSES:-}" PORT="$port" \
  bash "${COMPAT_SCRIPTS_DIR}/tier-backend.sh" || backend_ok=false

if [[ "$backend_ok" == true ]]; then
  PACK_NAME="$pack_name" EXTENSION_NAMES_JSON="$(out extension_names)" PORT="$port" \
    bash "${COMPAT_SCRIPTS_DIR}/tier-browser.sh" || true
fi
bash "${COMPAT_SCRIPTS_DIR}/stop-server.sh"   # as the workflow's always() step; the trap covers early exits

SLOT="$slot" TARGET_REF="$target_ref" COMFYUI_SHA="$sha" FRONTEND_VERSION="$frontend" \
  PACK_NAME="$pack_name" GITHUB_STEP_SUMMARY="${run}/summary.md" \
  bash "${COMPAT_SCRIPTS_DIR}/summarize.sh"
