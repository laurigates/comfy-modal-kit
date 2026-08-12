# CLAUDE.md

`@laurigates/comfy-modal-kit` — the shared TypeScript package consumed by the
mobile-first ComfyUI custom-node packs (`comfyui-prompt-editor`,
`comfyui-touch-*`, `comfyui-sampler-info`, `comfyui-model-gallery`). Authored in
`src/`, built to bundled ESM + declarations in `dist/`. Consuming packs
`bun add` it and their own `bun build --target browser` **inlines** this code
into their served bundle — nothing from `node_modules/` ships to ComfyUI at
runtime.

## Architecture

One shared runtime, these surfaces:

| Module | Role |
|---|---|
| `src/modal-shell.ts` | Bare modal dialog (backdrop + header/search/body/footer). CSS `.cmp-*`. Exposes `scrollHost` (the one scroll region) and `getScrollTop()` — see the hard rule below. |
| `src/modal-fuzzy.ts` | Pure fzf-lite scoring + `highlightMatches`. |
| `src/modal-notify.ts` | Transient toasts with copy-to-clipboard. CSS `.cmn-*`. Registers its body-level stack as modal chrome (below) and insets it (`cmn-modal-inset`) while a modal is up. |
| `src/modal-rating.ts` | 0..5 star-rating helpers for the gallery packs. |
| `src/gallery-file.ts` | The `GalleryFile` listing row the gallery packs share, plus `sortFiles` / `SORT_OPTIONS` / `isValidSort`. Data and comparators only — packs build their own `<select>`. |
| `src/lazy-media.ts` | `installLazyMedia` — deferred `<img>`/`<video>` loading. **`root` is required**: it must be the element that actually scrolls (see the hard rule below). |
| `src/back-guard.ts` | `installBackGuard` — the Android/gesture back sentinel. Kit owns the history bookkeeping, the pack's callback owns what "back" means. |
| `src/escape-html.ts` | `escapeHTML(s)` — the five-entity escape that was vendored in three packs. |
| `src/field-registry.ts` | Cross-pack registry of enhanced inline field controls (widget → control). |
| `src/model-picker-registry.ts` | Cross-pack registry of model-file pickers (`folder_paths` category → control). See ADR-0003. |
| `src/modal-coordinator.ts` | Single active-modal registry + `patchWidgetPointer` + best-effort pointer guard + the **modal-chrome** registry (`registerModalChrome` / `unregisterModalChrome` / `isModalChrome`). |
| `src/shell-overlay.ts` | In-dialog confirm/prompt/custom overlays (secondary prompts under single-modal discipline). CSS `.cmp-ov-*`. See ADR-0002. |
| `src/launcher.ts` | `makeLauncher` + `FAMILY_MENU_PATH` + `FAMILY_SETTINGS_CATEGORY` — the family's command/menu/action-bar/settings conventions in code. See ADR-0002. |
| `src/hub-registry.ts` | Cross-pack registry of Touch Tools chooser rows. A **list** consumer (every entry renders), so there is no `resolveHubEntry`. Its one contract: an entry's opener must need no node/widget/graph context. Also holds the **separate** `HubToggle` registry — kept out of `getHubEntries()` on purpose, so a toggle can never make `entries.length === 2` and cost a single-pack user the one-tap short-circuit. |
| `src/safe-view.ts` | The family's sensitive-content filter: the frozen `SAFE_VIEW_SETTINGS` ids, the shared `safeViewSettings()` array both gallery packs spread, keyword parsing, the **token** matcher (`tokenize` / `isSensitive`), the per-session `RevealSet`, the blur/spoiler CSS and DOM helpers (`setBlurred` / `setSpoilered` / `makeRevealButton`), and the cross-pack change bus. CSS `.cmk-sv-*`. **Discretion, not access control** — the blur is CSS and the bytes are still downloaded. |
| `src/hub.ts` | The family's single action-bar button and the chooser behind it: `makeHubEntry` (per-pack command + menu + row, **no** button), `installHubButton` (page-global election, returns **only** `actionBarButtons` so it is key-disjoint from `makeHubEntry` and safe to spread as a sibling), `openTouchToolsHub`. CSS `.cmk-hub-*`. |
| `src/widget-button.ts` | `appendButtonWidget` — the Strategy-B non-serialized button-widget safety net. |
| `src/style-inject.ts` | `ensureStyleOnce(id, css)` — style injection deduped by DOM id (cross-bundle safe). |
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
- **Chrome that renders above a modal must stay reachable through it.** The
  pointer guard's hit-test is the dialog element, so anything the kit appends to
  `document.body` to paint above the shell (today: `#cmn-notify-container`) reads
  as "outside the modal" — that is how tapping a toast's × came to dismiss the
  whole modal. Such an element MUST go through `registerModalChrome` (on every
  raise, not just on create) and `unregisterModalChrome` before removal, and must
  not physically sit on the shell's own controls. Mechanism, the
  `data-cmp-chrome` cross-realm fallback and the mixed-kit-version caveat:
  [`docs/architecture/README.md`](docs/architecture/README.md) → *"Outside the
  modal" ≠ "outside the dialog element"*.
- **`installLazyMedia`'s `root` must be the element that actually scrolls, and
  stays required.** Rooting on a container with no overflow clip makes the root
  rectangle that container's *whole bounding box*, so every element reports as
  intersecting on the first callback and the "lazy" load fires for the entire
  listing at once. Measured in comfyui-image-browser: 400/400 off-screen cards
  intersect with the grid as root vs 20/400 with the real scroller — survivable
  in a folder view of tens of files, an OOM'd tab in a flat view of thousands.
  The two consuming surfaces genuinely differ (a modal picker's grid sits inside
  the shell's `.cmp-body`; an inline node grid *is* its own scroller), so only
  the call site knows. **Do not add a default or an ancestor-walk fallback** —
  both packs got this wrong once each, and a helper that guesses hides the third
  occurrence behind a shared abstraction where it is harder to see.
- **On a close path, read the offset through `getScrollTop()`, never
  `bodyEl.scrollTop`.** The shell removes the dialog from the document and
  *then* calls `onClose`, so a consumer remembering the scroll position there is
  reading a detached element — which every real engine answers with **0**.
  Measured in comfyui-image-browser: parked at 31185, `scrollTop` read 0, and
  the browser silently reopened at the top of the list for three releases. The
  shell keeps a passive mirror that survives the detach; `getScrollTop()` still
  prefers a live read while attached, because a programmatic write lands before
  its `scroll` event does. jsdom cannot see any of this — it has no layout and
  happily reads back whatever you assigned, detached or not.
- **`installHubButton()` must keep returning `actionBarButtons` and nothing
  else, and hub rows must keep registering in the pack's `setup()`.** Packs
  spread it as a sibling of `makeHubEntry()`'s result, so the moment it also
  returns `commands`/`menuCommands` the later spread wins those keys: the pack's
  Extensions-menu row vanishes (`menuItemStore.ts:90-97` filters
  `menuCommand.commands` against `extension.commands` ids) and a user keybinding
  on the now-orphaned id is re-added at boot with **no** `isRegistered` gate
  (`keybindingService.ts:116-124`), squatting its combo and throwing on press
  (`commandStore.ts:110`). `tests/hub-registry.test.ts` pins the disjointness.
  Registration in `setup()` (not at module evaluation) is what keeps **disabled**
  packs out of the chooser — see the header of `src/hub.ts`.
- **A chooser row must close the chooser BEFORE it acts.** `runRow` disposes the
  back guard with `{ pop: false }`, calls `controller.close()` synchronously, and
  only then defers the action by one macrotask. The kit's scrim is `z-index:
  9998` while PrimeVue is configured at 1800, so acting first would open
  ComfyUI's own dialogs *behind* our backdrop and the tap would look inert.
  `tests/hub-chooser.test.ts`'s CLOSE-BEFORE-ACT case is the pin; do not weaken it.
  **One documented exemption: a TOGGLE row (`HubToggle`) opens nothing**, so the
  reason does not apply to it — it flips its boolean and repaints itself in
  place with the chooser still up, which is also the better interaction (the
  user flipping a filter is the user who wants to see it flip). It repaints from
  `get()` rather than from `!previous`, so a write ComfyUI's setting store
  refuses or coerces shows as unchanged instead of as a flip that never
  happened. `tests/hub-toggle.test.ts` pins both. A row that opens *anything* —
  a dialog, a modal, a native picker — is not a toggle and must go through
  `runRow`.
- **A toggle is not a `HubEntry`, and the separate registry is what enforces
  it.** `installHubButton`'s single-entry short-circuit opens the lone
  registered tool directly instead of showing a one-row menu, so registering a
  family-wide toggle as an ordinary entry would make `getHubEntries().length ===
  2` for every user with exactly one pack installed and silently take that tap
  back. `getHubEntries()` therefore excludes toggles **by construction**, not by
  care; `tests/hub-toggle.test.ts` asserts the one-tap launch survives a
  registered toggle. Both registries sort through the single `byPriority`
  comparator — writing the expression twice drifts *and* makes the mutation
  table's anchor for it ambiguous, which disarms that mutation silently (this
  happened while Safe View was being written; `just mutation-check` reported
  `BAD ANCHOR (2 matches)` and is the only reason it was noticed).
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

`tests/mutations.json` drives `just mutation-check comfy-modal-kit` from the
workspace root — it breaks each pinned mechanism in turn and reports which test
went red. It also carries a deliberate **CONTROL** mutation (a comment edit) that
the suite must MISS: a harness reporting everything as CAUGHT is
indistinguishable from a broken one. Because a MISSED mutation is how the script
reports a finding, the recipe exits **1** on a healthy run — read the report, not
the exit code. Add a mutation whenever you add a regression assertion
(`.claude/rules/modal-pack-test-tiers.md`).

## Diagrams

`docs/architecture/*.d2` render to `*.svg` via `d2 in.d2 out.svg`. Commit the
`.d2` source and the rendered `.svg` together.
