---
id: ADR-0001
date: 2026-07-02
status: Accepted
deciders: Lauri Gates
domain: api-design
relates-to: []
github-issues: []
name: cross-pack-field-provider-and-click-coordination
---

# ADR-0001: Cross-Pack Field-Provider Registry & Click Coordination

## Decision Drivers

- **The packs don't compose.** The four usability packs
  (`comfyui-prompt-editor`, `comfyui-touch-numeric`, `comfyui-sampler-info`,
  `comfyui-model-gallery`) each independently intercept a widget's
  `onPointerDown` and open a touch modal built on this kit. `prompt-editor` is
  an *all-fields node editor*: it renders a dumb `<input type=number>` for
  `seed` and a dumb `<select>` for `sampler_name` / `ckpt_name`, even when the
  sibling packs are installed and each owns a richer affordance for exactly
  those widgets. The richer control is reachable only by tapping the widget on
  the canvas, never from inside the editor.
- **Modal stacking is broken today.** The kit is *inlined* into every pack's
  bundle (`bun build --target browser` bundles `node_modules/` in; nothing from
  `node_modules/` ships to ComfyUI at runtime). Each pack therefore had its own
  private `let ACTIVE` modal singleton in `modal-shell.ts`. Opening pack B's
  modal did **not** dismiss pack A's — two backdrops coexisted, ownership was
  ambiguous.
- **No pointer arbitration.** The window-level gesture packs (`touch-connect`
  link-snap, `touch-resize` pinch, `touch-tooltips`) all grab `window`
  pointerdown in capture phase with no coordination, and an open modal cannot
  veto a canvas gesture.

Both the composition problem and the coordination problems have the same root
cause — **inlined per-pack copies with no shared runtime** — so the kit is the
right home for the fix.

## Considered Options

1. **A shared runtime rendezvous in the kit (`Symbol.for`).** Field providers,
   the active-modal slot, and pointer-claim state all live on a single object
   keyed by a well-known Symbol on `globalThis`, so the inlined per-pack copies
   converge on one instance. Providers register enhanced *inline controls* the
   editor mounts per field; modal-shell routes its single-active discipline
   through the shared slot; a best-effort window guard vetoes gestures.
2. **Direct pack-to-pack imports.** `prompt-editor` `bun add`s each sibling
   pack and calls into it. Creates a dependency web (prompt-editor must know all
   siblings), couples release cycles, and each sibling would still inline its
   own copy of the kit — the modal-stacking bug persists.
3. **A nested-modal design.** The editor opens the sibling's *modal* (a modal
   inside the editor modal) instead of an inline control. Violates the
   single-active-modal invariant the kit exists to enforce, and stacks two
   backdrops — the exact bug being fixed.
4. **Do nothing / document the limitation.** Cheap, but the packs remain
   non-composing and the stacking bug stays latent.

## Decision Outcome

**Chosen option**: "A shared runtime rendezvous in the kit (`Symbol.for`)".
The kit gains two API surfaces on one mechanism:

- **`field-registry.ts`** — `registerFieldProvider` / `resolveFieldProvider` /
  `getFieldProviders`, with `FieldProvider` (`id`, `priority?`, `match`,
  `create`) and `FieldControl` (`el`, `getValue`, `hasChanged`, `focus?`,
  `destroy?`). A provider pack registers an enhanced inline control; the editor
  resolves the highest-priority match per field and mounts its `FieldControl`
  in place of the built-in `<input>`/`<select>`. `FieldControl` maps 1:1 onto
  the editor's existing `FieldRow` (`el`/`read`/`changed`/`focus`), so
  consumption is a drop-in wrap.
- **`modal-coordinator.ts`** — a shared active-modal registry
  (`setActiveModal` / `dismissActiveModal` / `isModalActive` /
  `getActiveModal`), the uniform `patchWidgetPointer` chain-then-consume
  contract every pack hand-rolls today, and the pointer-claim protocol
  (`claimPointer` / `isModalActive`) plus a best-effort window guard
  (`installPointerGuard`).

`modal-shell.ts` is refactored to route its single-active discipline through
the coordinator's shared slot (`getKit().activeModal`) instead of a
module-local `let ACTIVE`, so any pack's `openModalShell` dismisses whatever is
truly on screen. Existing behavior — backdrop-pointerdown dismiss, ESC,
focus-on-rAF — is preserved.

### Why `Symbol.for` and not a module singleton

A module-level `let` is duplicated once per inlined pack copy, so pack A's
singleton and pack B's singleton are different variables — the whole reason the
packs don't currently coordinate. `Symbol.for("laurigates.comfyModalKit")`
resolves to the **same** symbol in every realm, so a single object hangs off
`globalThis[symbol]` and every inlined copy reads and writes the one instance
(`src/kit-global.ts`). The **shape of that shared object is the cross-pack
compatibility surface** — it must be extended additively, never
re-shaped, so packs bundling different kit versions don't clobber each other.

### Constraint: inline control, not a nested modal

The editor mounts a provider's `FieldControl.el` *inline in the field row*. It
does **not** open the provider's modal. This keeps the single-active-modal
invariant intact — there is only ever one modal (the editor) — and is why the
provider contract returns a mountable element with value accessors, not an
`openModal()` call.

### Additive-fallback guarantee

`resolveFieldProvider` returns `null` when nothing matches, and the consumer
MUST fall back to its built-in control. A provider that isn't installed simply
never registers. So installing zero, one, or all sibling packs all work: the
editor degrades to its built-in controls for unclaimed fields and never breaks.

### Positive Consequences

- The packs compose: the editor surfaces the seed keypad, the sampler fuzzy
  list, and the model gallery inline, per field, when those packs are present.
- The cross-pack modal-stacking bug is fixed at the root — one active modal
  across all packs.
- `patchWidgetPointer` removes the copy-pasted, subtly-divergent pointer
  wrapper from each pack.
- Purely additive: no consumer is required to change; adoption is opt-in and
  file-by-file.

### Negative Consequences

- The shared-global shape becomes a compatibility contract that must be evolved
  additively — a breaking re-shape in one pack's kit version could clobber
  another pack bundling a different version.
- Full modal→gesture veto needs the gesture packs to consult `isModalActive()`
  themselves (same-target window-capture listener order across packs is
  non-deterministic, so the kit's guard is best-effort). Gesture-pack adoption
  is deferred (tracked as future work).
- One more internal module (`kit-global.ts`) and a larger public surface to
  keep stable.

## Pros and Cons of Options

### Shared runtime rendezvous (Symbol.for)

- ✅ Fixes both composition and modal-stacking with one mechanism
- ✅ Additive, opt-in, drop-in `FieldControl`→`FieldRow` mapping
- ✅ No pack-to-pack dependency web; siblings stay independent
- ❌ Shared-global shape is a compatibility surface to steward
- ❌ Full gesture veto still needs gesture-pack cooperation

### Direct pack-to-pack imports

- ✅ Explicit, no global state
- ❌ Dependency web; couples release cycles
- ❌ Each sibling still inlines its own kit → modal-stacking bug persists

### Nested-modal design

- ✅ Reuses the sibling's existing modal UI verbatim
- ❌ Two stacked backdrops — the exact bug being fixed
- ❌ Violates the single-active-modal invariant

### Do nothing

- ✅ Zero cost
- ❌ Packs stay non-composing; stacking bug stays latent

## Links

- `docs/architecture/README.md` — the registry + coordination architecture and
  the runtime-rendezvous mechanism
- `docs/ONBOARDING.md` — how a pack registers a provider / adopts the coordinator
- `src/field-registry.ts`, `src/modal-coordinator.ts`, `src/kit-global.ts`,
  `src/modal-shell.ts` (refactored)
- Consumer adoption is tracked as issues in the four core packs; gesture-pack
  adoption of the pointer-claim protocol is tracked as an issue on this repo.

---
*Authored alongside the field-provider registry + click-coordination API
(kit v0.4.0).*
