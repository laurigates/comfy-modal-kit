#!/usr/bin/env bash
# Tier a — typecheck the pack against the frontend types of the target ref.
#
#   env PACK_DIR            the pack checkout (never modified)
#   env FRONTEND_VERSION    exact comfyui-frontend-package version of the target
#   env WORK_DIR            scratch; the pack is copied to $WORK_DIR/types-pack
#   env LOG_DIR             types.log lands here
#   env COMPAT_RESULTS_DIR  tier verdict file
#
# The pack's own lockfile resolves @comfyorg/comfyui-frontend-types to
# whatever it was last bumped to; ComfyUI ships a frontend that may be a dozen
# minors ahead. This tier re-resolves exactly the version the target ref pins
# (in a scratch COPY, so neither the checkout nor the later tiers see the
# change) and runs the pack's own `typecheck` script against it.
#
# Skips, with a notice, rather than fails when the check cannot mean anything:
# no package.json / typecheck script, no dependency on the types package, or
# that exact version never published to npm (the frontend and its types are
# released separately, and not every frontend build has a types release).
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

: "${PACK_DIR:?}" "${WORK_DIR:?}" "${LOG_DIR:?}" "${COMPAT_RESULTS_DIR:?}"
: "${FRONTEND_VERSION:?FRONTEND_VERSION must be set}"
is_semver "$FRONTEND_VERSION" || die "bad FRONTEND_VERSION '${FRONTEND_VERSION}'"
pkg="@comfyorg/comfyui-frontend-types"
mkdir -p "$WORK_DIR" "$LOG_DIR"

skip() {
  notice "types: $1"
  record_tier types skip "$1"
  exit 0
}
fail() {
  record_tier types fail "$1"
  error "types: $1"
  exit 1
}

manifest="${PACK_DIR}/package.json"
[[ -f "$manifest" ]] || skip "no package.json in the pack"
jq -e '.scripts.typecheck // empty | length > 0' "$manifest" >/dev/null || skip "package.json has no typecheck script"
section=$(jq -r --arg p "$pkg" '
  if (.devDependencies // {} | has($p)) then "devDependencies"
  elif (.dependencies // {} | has($p)) then "dependencies"
  else "" end' "$manifest")
[[ -n "$section" ]] || skip "the pack does not depend on ${pkg}"

# Membership in the package's full version list, not `npm view pkg@X`: npm 10
# exits 1 with E404 for a version that was never published, the same exit as
# an unreachable registry. One list query separates the two — it fails only
# when npm cannot answer at all, and a missing version is then a plain
# "not in the list" (1.45.14, 1.45.15 and 1.41.0-1.41.3 shipped to PyPI with
# no types release, checked 2026-10-28; PyPI .devN builds never get one).
versions=$(npm view "$pkg" versions --json 2>"${LOG_DIR}/npm-view.err") ||
  fail "could not query npm for the versions of ${pkg}: $(head -c 300 "${LOG_DIR}/npm-view.err")"
jq -e 'if type == "array" then . else [.] end | length > 0' <<<"$versions" >/dev/null 2>&1 ||
  fail "npm returned no version list for ${pkg}: $(head -c 200 <<<"$versions")"
jq -e --arg v "$FRONTEND_VERSION" 'if type == "array" then . else [.] end | index($v) != null' <<<"$versions" >/dev/null ||
  skip "${pkg}@${FRONTEND_VERSION} is not published on npm; the types tier cannot test this target"

locked="unknown"
if [[ -f "${PACK_DIR}/bun.lock" ]]; then
  locked=$(grep -oE "\"${pkg}@[0-9][^\"]*\"" "${PACK_DIR}/bun.lock" | head -n 1 | sed -E 's/.*@([^"]+)"/\1/') || true
  locked="${locked:-unknown}"
fi

copy="${WORK_DIR}/types-pack"
rm -rf "$copy"
mkdir -p "$copy"
tar -C "$PACK_DIR" --exclude=./.git --exclude=./node_modules -cf - . | tar -C "$copy" -xf -

flag=(--exact)
[[ "$section" == devDependencies ]] && flag+=(--dev)
log "types: ${pkg} ${locked} (pack lockfile) -> ${FRONTEND_VERSION} (target), bun $(bun --version)"
(cd "$copy" && bun add "${flag[@]}" "${pkg}@${FRONTEND_VERSION}") >"${LOG_DIR}/types-install.log" 2>&1 ||
  fail "bun add ${pkg}@${FRONTEND_VERSION} failed (see types-install.log)"

# A version can be published and still carry no declarations: every release
# from 1.48.4 through 1.58.0 shipped only LICENSE + package.json, its
# `types: ./index.d.ts` pointing at nothing (npm dist.fileCount 2, checked
# 2026-10-28). tsc then fails with TS2688 for a reason that says nothing about
# the pack, so read the installed package's own `types` entry and skip when
# the file is absent.
installed="${copy}/node_modules/${pkg}"
entry=$(jq -r '.types // .typings // "index.d.ts"' "${installed}/package.json" 2>/dev/null) || entry=""
if [[ -z "$entry" || ! -f "${installed}/${entry#./}" ]]; then
  skip "${pkg}@${FRONTEND_VERSION} is published without its declaration file (${entry:-types entry unreadable}); nothing to typecheck against"
fi

set +e
(cd "$copy" && bun run typecheck) >"${LOG_DIR}/types.log" 2>&1
status=$?
set -e
cat "${LOG_DIR}/types.log" >&2
if ((status != 0)); then
  first=$(grep -m 3 -E 'error TS[0-9]+' "${LOG_DIR}/types.log" | paste -sd'|' -)
  fail "typecheck against ${pkg}@${FRONTEND_VERSION} failed (pack locks ${locked}): ${first:-see types.log}"
fi
record_tier types pass "typecheck clean against ${pkg}@${FRONTEND_VERSION} (pack locks ${locked})"
