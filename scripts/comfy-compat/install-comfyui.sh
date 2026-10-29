#!/usr/bin/env bash
# Create a venv for a ComfyUI checkout: CPU-only torch, then requirements.txt.
#
#   env COMFYUI_DIR      checkout from checkout-comfyui.sh (required)
#   env VENV_DIR         venv to create (required); reused when its marker
#                        matches this checkout's requirements.txt
#   env PYTHON_VERSION   default 3.12
#   env TORCH_INDEX_URL  default https://download.pytorch.org/whl/cpu
#
# torch/torchvision go in FIRST from the CPU index, so the PyPI resolution of
# requirements.txt finds them satisfied and never pulls the multi-GB CUDA
# wheels. A single resolve with both indexes would pick whichever index has the
# higher version, which is how CUDA torch sneaks back in.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

: "${COMFYUI_DIR:?COMFYUI_DIR must be set}"
: "${VENV_DIR:?VENV_DIR must be set}"
py_version="${PYTHON_VERSION:-3.12}"
torch_index="${TORCH_INDEX_URL:-https://download.pytorch.org/whl/cpu}"
command -v uv >/dev/null || die "uv is required (astral-sh/setup-uv in CI)"

req="${COMFYUI_DIR}/requirements.txt"
stamp="$(sha256sum "$req" | cut -c1-16)-py${py_version}"
marker="${VENV_DIR}/.comfy-compat-stamp"
if [[ -x "${VENV_DIR}/bin/python" && -f "$marker" && "$(cat "$marker")" == "$stamp" ]]; then
  log "reusing venv ${VENV_DIR} (${stamp})"
else
  log "creating venv ${VENV_DIR} with Python ${py_version}"
  rm -rf "$VENV_DIR"
  uv venv -q --python "$py_version" "$VENV_DIR"
  uv pip install --python "${VENV_DIR}/bin/python" --index-url "$torch_index" torch torchvision
  uv pip install --python "${VENV_DIR}/bin/python" -r "$req"
  printf '%s\n' "$stamp" >"$marker"
fi

# What is actually installed is what the browser tier will be served; report
# it next to the pinned version so a mismatch is visible, not inferred.
"${VENV_DIR}/bin/python" - <<'PY' >&2
import importlib.metadata as m
for dist in ("torch", "comfyui-frontend-package"):
    try:
        print(f"[comfy-compat] installed {dist}=={m.version(dist)}")
    except m.PackageNotFoundError:
        print(f"[comfy-compat] {dist} is NOT installed")
PY
