#!/usr/bin/env bash
# Describe the pack under test: where its web files live, which frontend
# extension names it registers, and whether it has a typecheck to run.
#
#   env PACK_DIR         the pack checkout (required)
#   env PACK_NAME        directory name under custom_nodes/ (default: basename of PACK_DIR)
#   env EXTENSION_NAMES  newline list; empty => derive from the web directory
#
# Outputs: pack_name, web_dir, extension_names (JSON array), has_typecheck,
# bun_version_file.
#
# Deriving names reads `registerExtension({ ... name: "<literal>"` out of the
# served .js files — the committed bundle, which is what ComfyUI serves, not
# src/. A pack that ships web files but whose names cannot be read (a name held
# in a variable, an unusual bundler shape) FAILS here and asks for the
# extension-names input: a smoke test that silently asserted nothing would read
# as coverage.
#
# An empty web_dir here is only "not readable from source" (WEB_DIRECTORY
# computed with os.path.join, say), never proof the pack has no frontend:
# tier-browser.sh asks the running server what it serves under
# /extensions/<pack>/ and derives the names from those files instead.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

: "${PACK_DIR:?PACK_DIR must be set}"
[[ -d "$PACK_DIR" ]] || die "pack directory ${PACK_DIR} does not exist"
pack_name="${PACK_NAME:-}"
[[ -n "$pack_name" ]] || pack_name="$(basename "$(cd "$PACK_DIR" && pwd)")"
is_pack_name "$pack_name" || die "pack-name '${pack_name}' is not a plain directory name"
[[ -f "${PACK_DIR}/__init__.py" ]] || die "${PACK_DIR} has no __init__.py — not a ComfyUI custom-node pack"

# WEB_DIRECTORY as a top-level literal assignment in __init__.py (optionally
# annotated), the form every pack in the fleet uses. ComfyUI also honours
# [tool.comfy] web in pyproject.toml.
web_dir=$(sed -nE "s/^WEB_DIRECTORY[[:space:]]*(:[[:space:]]*str[[:space:]]*)?=[[:space:]]*[\"']([^\"']+)[\"'][[:space:]]*(#.*)?$/\2/p" "${PACK_DIR}/__init__.py" | head -n 1)
if [[ -z "$web_dir" && -f "${PACK_DIR}/pyproject.toml" ]]; then
  web_dir=$(sed -nE "/^\[tool\.comfy\]/,/^\[/ s/^web[[:space:]]*=[[:space:]]*[\"']([^\"']+)[\"'].*/\1/p" "${PACK_DIR}/pyproject.toml" | head -n 1)
fi
web_dir="${web_dir#./}"
if [[ -n "$web_dir" && ! -d "${PACK_DIR}/${web_dir}" ]]; then
  die "WEB_DIRECTORY '${web_dir}' does not exist in the pack (is the built bundle committed?)"
fi

names=$(list_items "${EXTENSION_NAMES:-}")
if [[ -z "$names" && -n "$web_dir" ]]; then
  mapfile -d '' js_files < <(find "${PACK_DIR}/${web_dir}" -type f \( -name '*.js' -o -name '*.mjs' \) -print0)
  names=$(derive_extension_names "${js_files[@]}")
  [[ -n "$names" ]] || die "no app.registerExtension({ name: \"...\" }) literal found under ${web_dir}/ — pass the extension-names input"
  log "derived extension names from ${web_dir}/: $(paste -sd' ' <<<"$names")"
elif [[ -z "$names" ]] && grep -qE '^[[:space:]]*WEB_DIRECTORY' "${PACK_DIR}/__init__.py"; then
  notice "WEB_DIRECTORY in __init__.py is not a plain string literal; extension names will be read from what the server serves"
fi
names_json=$(printf '%s\n' "$names" | jq -R . | jq -cs 'map(select(length > 0))')

has_typecheck=false
if [[ -f "${PACK_DIR}/package.json" ]] &&
  jq -e '.scripts.typecheck // empty | length > 0' "${PACK_DIR}/package.json" >/dev/null; then
  has_typecheck=true
fi
bun_version_file=""
[[ -f "${PACK_DIR}/.bun-version" ]] && bun_version_file=".bun-version"

set_output pack_name "$pack_name"
set_output web_dir "$web_dir"
set_output extension_names "$names_json"
set_output has_typecheck "$has_typecheck"
set_output bun_version_file "$bun_version_file"
