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
