---
id: ADR-0003
date: 2026-07-27
status: Accepted
deciders: Lauri Gates
domain: api-design
relates-to: [ADR-0001]
github-issues: []
name: separate-model-picker-registry
---

# ADR-0003: A Separate Model-Picker Registry, Not a Widened Field Provider

## Context

rgthree's **Power Lora Loader** is the standard multi-LoRA node, and on a touch
frontend it is close to unusable. Each LoRA row is a self-drawing `type:
"custom"` widget named `lora_1`, `lora_2`, … whose `value` is an **object**:

```ts
{ on: boolean, lora: string | null, strength: number, strengthTwo: number | null }
```

(`rgthree-comfy/src_web/comfyui/power_lora_loader.ts` — `PowerLoraLoaderWidget`.)

Two consequences follow, and together they are the whole reason this ADR exists:

1. **comfyui-model-gallery's `FieldProvider` can never engage.** Its `match()`
   is `categoryForWidget(w) !== null && isComboWidget(w)` — the widget name must
   be in the `WIDGET_CATEGORY` map (`lora_name`, `ckpt_name`, …) *and* the widget
   must carry an `options.values` array. A row named `lora_3` with no values
   array fails both halves.
2. **comfyui-prompt-editor therefore renders the filename as a bare
   `<input type="text">`.** Typing a `folder_paths` model path by hand on a
   phone is the precise experience these packs exist to remove.

The on-canvas path is not an alternative. rgthree custom widgets route pointer
input through `mouse()` / `onMouseDown` plus a `hitAreas` table
(`utils_widgets.ts`), **not** `onPointerDown` — which is what the kit's
`patchWidgetPointer` wraps. It can never fire on a LoRA row. The prompt-editor
modal is the only practical surface.

## Decision Drivers

- **The unit of reuse is "pick a file from `folder_paths` category X" — and it
  involves no widget.** The host (prompt-editor) owns the row and its four
  sub-controls; all it wants from a peer pack is the card grid.
- **`FieldProvider` is widget→control by construction.** `create()` takes a
  `FieldControlContext` whose required members are `widget`, `node` and
  `initialValue`, and the returned `FieldControl.getValue()` is contractually
  "the widget's native type". For a LoRA row the native type is an *object*
  while a picker's value is a *string*, so `initialValue` and `getValue()` would
  disagree in type at the contract level — the provider would have to be handed
  `{on, lora, …}` and return a bare filename, or be handed a synthetic
  widget-like that doesn't correspond to anything on the node.
- **One widget, four logical fields.** A LoRA row is a toggle + a filename + one
  or two strengths. `FieldProvider` has no vocabulary for "replace one *part* of
  a field", and inventing one (a sub-field selector on `FieldControlContext`)
  would complicate every existing provider to serve one caller.
- **Both packs already agree on the value space.** rgthree enumerates LoRAs via
  `folder_paths.get_filename_list("loras")`
  (`py/server/routes_model_info.py:35`); model-gallery's `/model_gallery/list`
  does the same (`model_gallery.py:670`). A gallery selection is therefore
  *exactly* the string rgthree stores and `get_lora_by_filename` resolves — no
  translation layer is needed, and none should be invented.
- **Metadata must not cross the pack boundary.** Trigger words, rank/alpha, and
  base architecture are model-gallery's domain (its corpus, its `/meta`
  endpoint). The host must be able to show them without knowing anything about
  them.

## Considered Options

1. **A new `ModelPicker` registry keyed by `folder_paths` category** (chosen).
2. **Extend `FieldProvider` with an optional sub-field notion** — e.g.
   `match(widget, node, subField?)` plus a string-valued control variant.
3. **Widen `FieldProvider`'s value contract to `unknown`-in/`unknown`-out** and
   let prompt-editor pass a synthetic widget-like `{name: "lora", value: "…"}`.
4. **Teach model-gallery to recognise Power Lora Loader rows directly** and
   register a `FieldProvider` for the whole row.

## Decision Outcome

**Option 1.** Add `src/model-picker-registry.ts`, exported from the barrel,
mirroring `field-registry.ts`'s structure exactly — same priority resolution,
same replace-by-id idempotency, same swallow-and-log of a throwing predicate,
same additive-fallback null return:

```ts
supports(category: string): boolean
create(req: { category, initialValue }): ModelPickerControl   // getValue(): string
createSummary?(req: { category, value }): HTMLElement          // optional, provider-owned DOM
```

`KitRuntime` gains `modelPickers: ModelPicker[]` — the additive extension its
own header mandates. `getKit()` now **backfills** missing collections on every
access rather than only at construction: whichever pack's inlined kit loads
first is the one that builds the rendezvous object, and a pack on an older kit
would build it without `modelPickers`, leaving a newer pack's
`registerModelPicker` to `.findIndex` on `undefined`. Backfilling is what
"extend the shape additively" has to mean for an object multiple bundle versions
construct.

`FieldProvider` is **unchanged**, and model-gallery keeps its existing
`model-gallery:combo` provider untouched. The two registries are complementary,
not competing: `FieldProvider` answers "who owns this *widget*", `ModelPicker`
answers "who can enumerate this *file category*".

### Positive Consequences

- prompt-editor gets a card-grid LoRA picker with zero knowledge of galleries,
  corpora, or `/meta`; model-gallery gets a second consumer for machinery it
  already has (`createGallery` already returns this exact shape — it is what the
  field provider wraps today).
- The registry is useful beyond LoRA rows: any host that knows a category but
  has no widget (a batch "retarget these five checkpoints" panel, an import
  wizard) can ask for a picker.
- `createSummary` keeps every metadata concern inside the provider pack. The
  host mounts an opaque element and never inspects it.
- No existing provider or consumer changes behaviour; a pack that never adopts
  this sees nothing.

### Negative Consequences

- **Two registries to learn.** Mitigated by making them structurally identical
  and documenting the split rule ("widget → `FieldProvider`; file category →
  `ModelPicker`") here and in the module header.
- **A pack could register both and duplicate its own logic.** model-gallery
  deliberately does not: its `ModelPicker.create` is a thin wrapper over the
  same `createGallery` its `FieldProvider` uses.
- **`ModelPickerControl.el` is not a scroll container** (inherited from
  `FieldControl.el`, and for the same reason), which pushes a real obligation
  onto hosts: a host mounting it into a height-capped container — such as
  `openShellOverlay`'s `.cmp-ov-card`, which is `max-height`-capped
  `display: flex` column with no scroll region of its own — must wrap it in its
  own `flex: 1; overflow-y: auto` element, or the grid is clipped and files
  below the fold are unreachable. Documented on the interface.

## Pros and Cons of the Options

### Option 1 — separate `ModelPicker` registry

- Good: the contract matches the actual unit of reuse; `getValue(): string` is
  honest; no existing type widens.
- Good: reusable by future hosts that have a category but no widget.
- Bad: a second registry in the public surface.

### Option 2 — sub-field notion on `FieldProvider`

- Good: one registry.
- Bad: every existing provider's `match()` gains a parameter it ignores, and
  `FieldControl` needs a value-type discriminator. Complexity paid by four
  existing providers to serve one caller.
- Bad: still doesn't fix the widget-shaped `create()` context — the host has no
  widget to hand over for "the filename part of `lora_3`".

### Option 3 — `unknown` in / `unknown` out + a synthetic widget-like

- Good: no new types at all.
- Bad: deletes the type safety that makes the existing registry pleasant, and a
  synthetic widget that is on no node invites providers to reach into
  `node.widgets` and find nothing (or worse, the wrong thing).

### Option 4 — model-gallery owns the whole LoRA row

- Good: no kit change whatsoever.
- Bad: puts rgthree-specific row semantics (dual strength, the `"None"`
  sentinel, `addNewLoraWidget`) into a pack whose subject is *model files*, and
  duplicates the strength-stepper UI prompt-editor already has.
- Bad: the row would then only be editable when model-gallery is installed —
  the opposite of the additive-fallback contract.

## Links

- [ADR-0001](0001-cross-pack-field-provider-and-click-coordination.md) — the
  `FieldProvider` registry and the `Symbol.for` rendezvous this extends.
- `src/model-picker-registry.ts` — the implementation and its header rationale.
- comfyui-model-gallery ADR-0003 — the provider side.
- comfyui-prompt-editor ADR-0003 — the consumer side.
