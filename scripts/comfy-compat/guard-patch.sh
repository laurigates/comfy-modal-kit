#!/usr/bin/env bash
# Refuse a staged change the auto-fix must never publish. Run inside the pack
# checkout AFTER the change is in the index (`git add -A`, or
# `git apply --index <patch>`); exits 1, naming every offending path, when:
#
#   - a path is not plain: anything outside [A-Za-z0-9._/@+-], so no quoting,
#     no control characters, no non-ASCII look-alikes
#   - a path is under .github/ (any letter case) — workflow and action files
#   - an entry is a symlink (mode 120000) or a submodule (160000), or the
#     change touches .gitmodules
#
# Paths are read NUL-delimited and with --no-renames, so both sides of a
# rename are checked and git's C-quoting (core.quotePath), which prints
# `".github/workflows/\303\251vil.yml"` with a leading quote, never reaches
# the comparison. Grepping the default `--name-only` / `--numstat` output is
# exactly how such a path slips past a `^\.github/` check.
#
# This check is not the only line: the publish job's App token is minted
# without the `workflows` permission, so GitHub itself rejects a push that
# touches .github/workflows/ even if a path got through here.
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

refused=()
count=0
# --raw -z: ":<old mode> <new mode> <old sha> <new sha> <status>\0<path>\0"
while IFS= read -r -d '' meta && IFS= read -r -d '' path; do
  count=$((count + 1))
  read -r _ new_mode _ <<<"${meta#:}"
  why=""
  lower="${path,,}"
  if [[ ! "$path" =~ ^[A-Za-z0-9._/@+-]+$ ]]; then
    why="not a plain path"
  elif [[ "$lower" == .github || "$lower" == .github/* ]]; then
    why="under .github/"
  elif [[ "$lower" == .gitmodules ]]; then
    why="submodule configuration"
  elif [[ "$new_mode" == 120000 ]]; then
    why="symlink"
  elif [[ "$new_mode" == 160000 ]]; then
    why="submodule entry"
  fi
  # printf %q keeps a hostile name on one readable line in the log.
  [[ -z "$why" ]] || refused+=("$(printf '%q' "$path") (${why})")
done < <(git diff --cached --no-renames --no-ext-diff --raw -z)

if ((${#refused[@]} > 0)); then
  for r in "${refused[@]}"; do error "refusing to publish: ${r}"; done
  exit 1
fi
log "patch guard: ${count} staged path(s), all plain and outside .github/"
