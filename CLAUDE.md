# CLAUDE.md

`@laurigates/comfy-modal-kit` — the shared TypeScript package consumed by the
mobile-first ComfyUI custom-node packs (`comfyui-prompt-editor`,
`comfyui-touch-*`, `comfyui-sampler-info`, `comfyui-model-gallery`). Authored in
`src/`, built to bundled ESM + declarations in `dist/`. Consuming packs
`bun add` it and their own `bun build --target browser` **inlines** this code
into their served bundle — nothing from `node_modules/` ships to ComfyUI at
runtime.

## Architecture

Five surfaces, one shared runtime:

| Module | Role |
|---|---|
| `src/modal-shell.ts` | Bare modal dialog (backdrop + header/search/body/footer). CSS `.cmp-*`. |
| `src/modal-fuzzy.ts` | Pure fzf-lite scoring + `highlightMatches`. |
| `src/modal-notify.ts` | Transient toasts with copy-to-clipboard. CSS `.cmn-*`. |
| `src/field-registry.ts` | Cross-pack registry of enhanced inline field controls. |
| `src/modal-coordinator.ts` | Single active-modal registry + `patchWidgetPointer` + best-effort pointer guard. |
| `src/kit-global.ts` | **Internal.** The `Symbol.for` runtime rendezvous all shared state lives on. |

**Why the `Symbol.for` rendezvous** (`kit-global.ts`): each pack inlines its own
copy of this kit, so a module-level `let` singleton would be per-pack and
wouldn't coordinate. `getKit()` returns one object keyed by
`Symbol.for("laurigates.comfyModalKit")` — the same in every realm — so the
inlined copies converge. The **shape of that object is the cross-pack
compatibility surface: extend it additively, never re-shape.** See
[ADR-0001](docs/blueprint/adrs/0001-cross-pack-field-provider-and-click-coordination.md),
[`docs/architecture/README.md`](docs/architecture/README.md), and
[`docs/ONBOARDING.md`](docs/ONBOARDING.md).

## Hard rules

- **Additive only.** Every export is opt-in. `resolveFieldProvider` returns
  `null` ⇒ consumers fall back to the built-in control; no coordinator adoption
  ⇒ existing modal behavior. Never break a consumer that hasn't adopted the API.
- **Keep the public surface stable.** The exported shapes are the contract for
  the inlined consumers. `src/index.ts` is the barrel; new public exports go
  there. Internal modules (`kit-global.ts`) stay out of the barrel.
- **Release-please owns versioning.** Never hand-edit `CHANGELOG.md`,
  `package.json` `version`, or `.release-please-manifest.json`. `feat:` cuts a
  minor, `fix:` a patch. The publish is OIDC trusted-publishing on release-PR
  merge.

## Dev workflow

```sh
bun install
bun run typecheck   # tsc --noEmit, strict
bun run build       # bundled ESM (dist/index.js) + declarations
bun run test        # vitest (node + per-file jsdom)
bunx biome check .  # lint + format
bun run knip        # dead-code / unused-dependency check
```

Run the full gate before a PR: `bun run typecheck && bun run build &&
bun run test && bunx biome check . && bun run knip`. CI mirrors it.

## Diagrams

`docs/architecture/*.d2` render to `*.svg` via `d2 in.d2 out.svg`. Commit the
`.d2` source and the rendered `.svg` together.
