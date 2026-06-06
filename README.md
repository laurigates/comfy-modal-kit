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

| Export | Kind | Signature |
|---|---|---|
| `openModalShell` | function | `(opts?: ModalShellOptions) => ModalShellController` |
| `closeModalShell` | function | `() => void` |
| `ModalShellOptions` | interface | shell config (title, subtitle, placeholder, showSearch, showFooter, footer HTML, width, height, onKeyDown, onClose) |
| `ModalShellController` | interface | DOM elements + `setBusy`, `setStatus`, `close` |
| `fuzzyScore` | function | `(query: string, target: string) => FuzzyScoreResult \| null` |
| `fuzzyRank` | function | `(query: string, fields: (string \| null \| undefined)[], primaryWeight?: number) => FuzzyRankResult \| null` |
| `highlightMatches` | function | `(target: string, matchIndices: number[] \| null \| undefined) => DocumentFragment` |
| `FuzzyScoreResult` | interface | `{ score: number; matches: number[] }` |
| `FuzzyRankResult` | interface | `{ score: number; primaryMatches: number[] }` |

The exported names are identical to the original vendored JS, so a consuming
pack can swap its vendored copy for an import with no call-site renames.

## Development

```sh
bun install
bun run build      # bundled ESM (dist/index.js) + declarations (dist/index.d.ts)
bun run typecheck  # tsc --noEmit, strict
bun run test       # vitest (pure fuzzy-scorer coverage)
bunx biome check . # lint + format
bunx knip          # dead-code / unused-dependency check
```
