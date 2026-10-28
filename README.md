# @laurigates/comfy-modal-kit

Shared modal primitives for the mobile-first ComfyUI custom-node packs
(`comfyui-gallery-loader`, `comfyui-sampler-info`, and the touch-\* family).
These two files — a bare modal-dialog shell and an fzf-lite fuzzy matcher —
were previously vendored byte-identically across several packs. This package
is their single source of truth, authored in TypeScript and built to bundled
ESM + type declarations.

## What's in it

- **`modal-shell`** — a bare modal dialog (backdrop + centered dialog with
  header, optional toolbar, optional search row, scrollable body, optional
  footer). Handles CSS injection, ESC-to-close, single-modal-at-a-time
  discipline, focus management, and touch-friendly dismiss. CSS is namespaced
  under `.cmp-*`. The consumer fills `bodyEl` with whatever DOM it wants.
- **`modal-fuzzy`** — pure fzf-lite scoring: greedy subsequence matching with
  start-of-string, separator, CamelCase-boundary, and consecutive-cluster
  bonuses; AND-token query semantics; and a DOM helper to highlight matches.
- **`modal-notify`** — transient toast notifications (info / success / warn /
  error) with severity-based lifetime and a one-tap copy-to-clipboard button
  for error/warning detail. CSS namespaced under `.cmn-*`.
- **`field-registry`** — a cross-pack registry of enhanced *inline field
  controls*. A provider pack registers a control for a widget; a consumer (the
  all-fields editor) resolves the highest-priority match per field and mounts
  it in place of the built-in `<input>`/`<select>`, falling back when nothing
  matches. See [`docs/architecture/README.md`](docs/architecture/README.md).
- **`modal-coordinator`** — cross-pack modal + pointer coordination: a single
  active-modal registry shared across the inlined per-pack copies, the uniform
  `patchWidgetPointer` chain-then-consume contract, and a best-effort
  modal→gesture pointer guard.
- **`safe-view`** — the family's sensitive-content filter, shared by the gallery
  packs so the same file is never blurred in one grid and plain in another. A
  user keyword list is matched as **whole tokens** against a file's name, every
  folder above it, and its XMP keyword tags (so `nsfw` matches `output/nsfw/…`
  while `ass` does *not* match `assets/`); matches get a CSS blur and a solid
  spoiler block over the name, with a per-card reveal. Ships the settings
  definitions themselves (`safeViewSettings()`), which both packs spread — they
  register the same frozen ids, so ComfyUI stores **one** value and the
  preference is cross-pack and cross-device for free.

  > **This is discretion, not access control.** The blur is CSS — one devtools
  > override away from gone — and the blurred file is still downloaded and still
  > sits in the browser cache. It defeats someone glancing over your shoulder,
  > not someone with your keyboard.

Both new surfaces converge the inlined per-pack copies on a single runtime
rendezvous (`Symbol.for`) — the rationale is
[ADR-0001](docs/blueprint/adrs/0001-cross-pack-field-provider-and-click-coordination.md).
To adopt them in a pack, see [`docs/ONBOARDING.md`](docs/ONBOARDING.md).

## Usage

Consuming packs add it as a dev dependency and import from the barrel:

```sh
bun add @laurigates/comfy-modal-kit
```

```ts
import {
  openModalShell,
  closeModalShell,
  fuzzyRank,
  fuzzyScore,
  highlightMatches,
} from "@laurigates/comfy-modal-kit";

const shell = openModalShell({ title: "Pick a sampler", placeholder: "Filter…" });
// fill shell.bodyEl, wire shell.searchEl, etc.
```

A pack's own `bun build` (`--target browser --format esm`) inlines this code
into its served `web/dist` bundle — nothing from `node_modules/` ships to
ComfyUI at runtime. The package emits browser-targeted ESM, so it tree-shakes
and bundles cleanly.

## Public API

### modal-shell

| Export | Kind | Signature |
|---|---|---|
| `openModalShell` | function | `(opts?: ModalShellOptions) => ModalShellController` |
| `closeModalShell` | function | `() => void` |
| `ModalShellOptions` | interface | shell config (title, subtitle, placeholder, showSearch, showFooter, footer HTML, width, height, onKeyDown, onClose) |
| `ModalShellController` | interface | DOM elements + `setBusy`, `setStatus`, `close` |

### modal-fuzzy

| Export | Kind | Signature |
|---|---|---|
| `fuzzyScore` | function | `(query: string, target: string) => FuzzyScoreResult \| null` |
| `fuzzyRank` | function | `(query: string, fields: (string \| null \| undefined)[], primaryWeight?: number) => FuzzyRankResult \| null` |
| `highlightMatches` | function | `(target: string, matchIndices: number[] \| null \| undefined) => DocumentFragment` |
| `FuzzyScoreResult` | interface | `{ score: number; matches: number[] }` |
| `FuzzyRankResult` | interface | `{ score: number; primaryMatches: number[] }` |

### modal-notify

| Export | Kind | Signature |
|---|---|---|
| `notify` | function | `(opts: NotifyOptions) => NotifyController \| null` |
| `notifyClipboardText` | function | `(summary: string, detail?: string) => string` |
| `copyTextToClipboard` | function | `(text: string) => Promise<boolean>` |
| `defaultLife` | function | `(severity: NotifySeverity) => number` |
| `defaultCopyable` | function | `(severity: NotifySeverity) => boolean` |
| `NotifyOptions` / `NotifyController` / `NotifySeverity` | types | toast config / handle / `"info" \| "success" \| "warn" \| "error"` |

### field-registry

| Export | Kind | Signature |
|---|---|---|
| `registerFieldProvider` | function | `(provider: FieldProvider) => void` — idempotent by `id` |
| `resolveFieldProvider` | function | `(widget: FieldWidgetLike, node: unknown) => FieldProvider \| null` |
| `getFieldProviders` | function | `() => readonly FieldProvider[]` |
| `FieldProvider` | interface | `{ id; priority?; match(widget, node); create(ctx) => FieldControl }` |
| `FieldControl` | interface | `{ el; getValue(); hasChanged(); focus?(); destroy?() }` |
| `FieldWidgetLike` / `FieldControlContext` | interfaces | widget subset / `create()` context |

### modal-coordinator

| Export | Kind | Signature |
|---|---|---|
| `setActiveModal` | function | `(handle: ActiveModalHandle) => void` |
| `dismissActiveModal` | function | `() => void` |
| `isModalActive` | function | `() => boolean` |
| `getActiveModal` | function | `() => ActiveModalHandle \| null` |
| `patchWidgetPointer` | function | `(widget: PointerPatchableWidget, opener: WidgetPointerOpener) => WidgetPointerPatch` |
| `claimPointer` | function | `(id: string) => void` |
| `installPointerGuard` | function | `() => void` |
| `ActiveModalHandle` / `PointerPatchableWidget` / `WidgetPointerOpener` / `WidgetPointerPatch` | types | coordinator contracts |

The shell/fuzzy/notify export names are identical to the original vendored JS,
so a consuming pack can swap its vendored copy for an import with no call-site
renames.

## Development

```sh
bun install
bun run build      # bundled ESM (dist/index.js) + declarations (dist/index.d.ts)
bun run typecheck  # tsc --noEmit, strict
bun run test       # vitest (pure fuzzy-scorer coverage)
bunx biome check . # lint + format
bunx knip          # dead-code / unused-dependency check
```

## ComfyUI compatibility check (reusable workflow)

Every pack's own CI stubs ComfyUI out. `.github/workflows/comfy-compat.yml` is
the check that a pack still works against **real** ComfyUI, as a reusable
workflow any pack in the fleet can call on a schedule. The fleet's reusable
workflows normally live in `laurigates/.github`; this one lives here because
the kit is the one repository every pack already depends on.

**Targets.** By default the newest `vX.Y.Z` tag of `comfyanonymous/ComfyUI`
(highest by `sort -V`, read off the remote) and `master`; `comfyui-ref` tests
one tag, branch or SHA instead. The frontend under test is always the
`comfyui-frontend-package==X` that ref's `requirements.txt` pins, never npm's
latest.

**Three tiers per target**, each reported separately in the job summary:

| Tier | What it checks | Skips when |
|---|---|---|
| types | the pack's `typecheck` script with `@comfyorg/comfyui-frontend-types` re-resolved to the target's exact frontend version (in a scratch copy) | no `package.json` / `typecheck` script, no dependency on the types package, that version is not on npm, or it was published without its `.d.ts` |
| backend | ComfyUI on CPU (CPU-only torch) with the pack copied into `custom_nodes/<pack-name>`: a clean `Import times` line for the pack, no traceback frame inside the pack, every `node-classes` entry in `/object_info`, and every web file `/extensions` lists under `/extensions/<pack-name>/` answering 200 | — |
| browser | Chromium loads the UI: each extension name is in `app.extensions`, every pack module re-imports without its evaluation error, no extension hook (`init`/`setup`/`nodeCreated`…) of the pack throws, no console error / uncaught error / failed request is attributable to `/extensions/<pack-name>/`, and the server log gained no traceback through the pack while the UI was up (a crashing pack route) | the server serves nothing under `/extensions/<pack-name>/` and no `extension-names` were given |

On a `schedule` or `workflow_dispatch` run from the default branch it keeps
**one** issue labelled `comfy-compat` in sync: opened when a target goes red,
rewritten (and commented when the set of failing targets changes) while red,
closed with a comment once every failing target is green. A `comfyui-ref`
dispatch is a one-off probe: its failure is reported, then dropped by the next
run that does not test it. With `auto-fix: true` and a
`CLAUDE_CODE_OAUTH_TOKEN`, Claude drafts a fix from the failing run's
artifacts in a job holding no write credential (secrets scrubbed from the
agent's subprocesses, an exact-command tool allowlist); a separate job
re-checks the patch (`scripts/comfy-compat/guard-patch.sh`: plain paths only,
nothing under `.github/`, no symlinks or submodules), applies it to
`comfy-compat/fix-<slot>` and opens a **draft** PR with an App token narrowed
to `contents` + `pull-requests`. Nothing merges it, and no second PR opens
while one is open for the same target.

### Adopting it in a pack

```yaml
# .github/workflows/comfy-compat.yml
on:
  schedule:
    - cron: "43 3 * * *"   # pick an odd minute, outside 06-09 UTC
  workflow_dispatch:
    inputs:
      comfyui-ref: { description: "ComfyUI ref (empty: newest release + master)", required: false, default: "" }

permissions:
  contents: read

jobs:
  compat:
    uses: laurigates/comfy-modal-kit/.github/workflows/comfy-compat.yml@main
    permissions:            # the union every job in it requests, auto-fix or not
      contents: write
      issues: write
      pull-requests: write
    with:
      comfyui-ref: ${{ inputs.comfyui-ref || '' }}
      node-classes: |       # omit for a frontend-only pack
        MyNode
    secrets:
      CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

`laurigates/comfyui-touch-numeric` is the reference caller (it also passes the
release-please App so a fix PR runs CI). Pair it with a Renovate rule that
bumps `@comfyorg/comfyui-frontend-types` with `rangeStrategy: "bump"`, so the
pack's own lockfile follows upstream too.

| Input | Default | Meaning |
|---|---|---|
| `pack-name` | repository name | directory under `custom_nodes/`, i.e. the `/extensions/<name>/` URL segment |
| `extension-names` | derived | newline list of `app.registerExtension` names; empty reads the `registerExtension({ name: "…" })` literals out of the committed bundle and **fails** if there are none |
| `node-classes` | — | newline list that must appear in `/object_info` |
| `comfyui-ref` | newest release + `master` | test this one ref instead |
| `python-version` | `3.12` | venv Python |
| `file-issue` | `true` | sync the `comfy-compat` issue (schedule/dispatch on the default branch only) |
| `auto-fix` | `false` | draft a fix PR when red (needs `file-issue` and the secret) |
| `auto-fix-model` / `auto-fix-max-turns` | `opus` / `40` | the agent's model and turn budget |
| `app-id` + secret `APP_PRIVATE_KEY` | — | GitHub App for the fix branch/PR; without it `GITHUB_TOKEN` opens it and no CI runs on it |

### Running it locally

The workflow's steps are the scripts in `scripts/comfy-compat/`, checked out
at the workflow's own commit (`job.workflow_sha`); `run-local.sh` runs the same
scripts in the same order for one target:

```sh
CACHE_DIR=~/.cache/comfy-compat scripts/comfy-compat/run-local.sh ../comfyui-touch-numeric          # newest release
CACHE_DIR=~/.cache/comfy-compat scripts/comfy-compat/run-local.sh ../comfyui-touch-numeric master
```

It listens on port 18188 by default (`PORT=` to change), never 8188 where a
live ComfyUI usually runs; a port that already answers is refused as a setup
failure rather than tested.

It needs `git`, `jq`, `curl`, `perl`, `uv`, `bun` (the pack's `.bun-version`
for fidelity) and a `node` that can `require('playwright')`. The first run per
target builds a CPU venv; later runs reuse it while `requirements.txt` is
unchanged. `FRONTEND_VERSION_OVERRIDE=<x>` points the types tier at another
types release, for exercising it when the target's pin is unusable (below).

### Known: most frontend-types releases ship no declarations

Measured 2026-10-28 with `npm view @comfyorg/comfyui-frontend-types@<v>
dist.fileCount`: every release from **1.48.4 through 1.58.0** contains only
`LICENSE` and `package.json` — its `types: ./index.d.ts` points at nothing —
while 1.48.3 (the last before the gap), 1.45.10 and 1.58.1+ carry the file.
ComfyUI v0.43.1 pins 1.57.4 and `master` pinned 1.57.6 that day, so the
types tier **skipped** on both default targets, saying so in a notice. Re-check a version with the command
above (2 files = no declarations); the tier detects it per run from the
installed package itself, so nothing here needs updating when it changes.
