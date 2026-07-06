---
id: ADR-0002
date: 2026-07-06
status: Accepted
deciders: Lauri Gates
domain: api-design
relates-to: [ADR-0001]
github-issues: []
name: family-launcher-conventions-and-shell-overlay
---

# ADR-0002: Family Launcher Conventions & In-Shell Overlay Primitives

## Decision Drivers

- **The family's chrome entry points drifted.** The three packs that register
  menus/commands did it three ways: menu paths `["Extensions"]`
  (touch-manager) vs `["Extensions", "Image Browser"]` vs
  `["Extensions", "Touch Shim"]`; command ids in three casings
  (`TouchManager.Open`, `image-browser.open`, `touch-shim.dock-actionbar`);
  three icon systems (PrimeIcons, iconify/Lucide classes, emoji). Every pack
  also hand-wrote the same "safe open" try/catch + `notify()` wrapper around
  its opener.
- **High-value duplication outside the kit.** A byte-identical
  `ensureStyle(id, css)` idiom lived in seven packs *and twice inside this
  kit*; comfyui-image-browser and comfyui-touch-manager carried two
  near-duplicate "confirm/prompt overlay inside the shell dialog"
  implementations; the "Strategy B" button-widget helper (append a
  non-serialized button as the guaranteed click path) was duplicated verbatim
  in comfyui-gallery-loader and comfyui-prompt-editor.

## Decision Outcome

Add four pure per-bundle modules — **no `kit-global.ts` change**; the
`Symbol.for` rendezvous shape is untouched:

1. **`style-inject.ts` — `ensureStyleOnce(id, css)`.** Dedupes by DOM id, so
   it is naturally cross-bundle safe (two packs' inlined copies share one
   document). SSR/node-safe no-op. The kit's own `modal-shell` / `modal-notify`
   now use it.
2. **`shell-overlay.ts` — `openShellOverlay` / `confirmInShell` /
   `promptInShell`.** In-dialog overlays (CSS `.cmp-ov-*`) for secondary
   prompts, because the single-active-modal discipline (ADR-0001) means a
   second `openModalShell` would dismiss the primary modal. While an overlay
   is up, the shell's capture-phase document ESC handler
   (`ModalShellController._onKey`) is **removed and restored on close**.
   - *Rejected alternative*: touch-manager's variant beat the shell's ESC by
     listening on `window` capture with `stopImmediatePropagation` — a
     sledgehammer that also suppresses **other** extensions' window-level key
     handling. The suspend/restore mechanism is deterministic and scoped to
     the one handler that must yield. Touch-manager's Enter-to-confirm
     behavior survives as the opt-in `enterConfirms` flag; image-browser's
     rename extension enforcement maps to `validate`.
   - Mixed-kit-version note: an overlay is always opened by the same pack
     (same bundle) that opened its shell, so a <0.6 pack's shell is never
     overlaid by a 0.6 pack's overlay — no cross-version coupling.
3. **`widget-button.ts` — `appendButtonWidget(node, label, onClick)`.** The
   Strategy-B safety net: `addWidget("button", …, {serialize:false})`,
   `serialize:false` set **on the widget** (the flag the frontend's
   `widgets_values` loops actually check), kept LAST so the skipped slot can't
   leave a hole that shifts saved values, `setDirtyCanvas`, all failures
   swallowed. Dedupe flags stay caller-owned.
4. **`launcher.ts` — `makeLauncher(opts)` + `FAMILY_MENU_PATH`.** Builds the
   `commands` / `menuCommands` / `actionBarButtons` registerExtension fields
   from one declaration, with the conventions baked in:
   - **One shared submenu** `["Extensions", "Touch Tools"]` for the whole
     family. Verified against the frontend: same-path `menuCommands` from
     different extensions merge by label (`menuItemStore.registerMenuGroup`
     walks existing nodes and appends; a separator between extensions' groups
     is expected cosmetics). An extension's menuCommands can only surface its
     own command ids, so each pack still declares its own command.
   - **Kebab command ids** `"<pack-short-name>.<action>"` — non-conforming ids
     `console.warn`, never throw (additive rule). Existing **setting ids stay
     frozen** (`TouchManager.*`, `TouchShim.*`) so stored user values survive;
     renamed command ids orphan user keybindings once (release-noted).
   - **PrimeIcons** (`pi pi-*`) — the only icon format guaranteed to render
     for runtime-loaded extensions on all three surfaces (`<i :class>` with
     `primeicons.css` imported wholesale in the frontend's `main.ts`; iconify
     `icon-[lucide--*]` classes exist only if the frontend's own Tailwind
     build happened to emit them). If the frontend ever drops `primeicons.css`,
     each pack's icon is a single `makeLauncher` option — cheap migration.
   - **Safe-open** baked in: try/catch, `console.error`, then a guarded
     copyable `notify()` error toast.
   - Sidebar tabs are out of scope (only touch-manager has one; it stays
     manual in its `setup()`).

**Companion conventions** (applied in the consuming packs, not enforceable
here): extension names `comfy.<short-name>`; `EXT_NAME` constants hold the
pack-dir/URL segment; field-provider ids `"<pack-short-name>:<field>"`
(registry ids are runtime-only, so renames are safe).

## Deliberately Deferred Extractions

Surveyed and left in the packs for now (medium value, need API design):
ok-envelope JSON fetch wrappers (`postJSON` / typed-error / batch
partial-success variants), the cached base-paths fetch, localStorage
persistence helpers, and a generic corpus loader/lookup (sampler-info and
model-gallery schemas have genuinely diverged: alias maps, case flags, key
derivation).

## Consequences

- The kit gains four opt-in surfaces; no existing export changes shape
  (additive rule holds). `feat:` → 0.6.0 via release-please.
- touch-shim stays kit-free (its hard rule); it hardcodes the shared menu path
  with a comment pointing at `FAMILY_MENU_PATH`.
- Consumers migrate in one wave after 0.6.0 publishes: launcher adoption
  (touch-manager, image-browser), overlay adoption (image-browser,
  touch-manager), `appendButtonWidget` (gallery-loader, prompt-editor),
  `ensureStyleOnce` (all modal packs), plus gallery-loader adopting the
  existing `patchWidgetPointer`.
