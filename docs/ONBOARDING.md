# Onboarding a pack to the field-provider registry & click coordination

How a ComfyUI custom-node pack adopts the v0.4.0 API. Everything here is
**additive and opt-in** — adopt one piece at a time. Architecture:
[`docs/architecture/README.md`](architecture/README.md). Decision record:
[ADR-0001](blueprint/adrs/0001-cross-pack-field-provider-and-click-coordination.md).

```sh
bun add @laurigates/comfy-modal-kit@^0.4.0
```

## The additive-fallback rule (read first)

Every integration must degrade cleanly when a peer pack is absent:

- **Consumer**: `resolveFieldProvider(...)` returns `null` ⇒ **fall back to your
  built-in control**. Never assume a provider is present.
- **Provider**: only `registerFieldProvider(...)` for widgets you genuinely
  enhance. If your pack isn't installed, you don't register, and the consumer
  keeps working.
- **Gesture pack**: `if (isModalActive()) return;` is a guard, not a hard
  dependency — the kit is inlined, so `isModalActive()` is always callable.

## (i) Register a field provider — provider packs

A provider exposes an **inline control** (a mountable element + value
accessors), *not* a modal. The editor mounts `FieldControl.el` in the field row;
it never opens your modal (that would stack two backdrops — see ADR-0001).

Use this when your pack owns a richer affordance for a specific widget (a seed
keypad, a fuzzy sampler list, a model gallery) and you want it to appear inside
`comfyui-prompt-editor` too, not only on canvas tap.

```ts
import { registerFieldProvider } from "@laurigates/comfy-modal-kit";

registerFieldProvider({
  id: "touch-numeric:seed",   // stable; a re-register with this id replaces it
  priority: 10,               // higher wins when multiple providers match
  match: (widget) => widget?.name === "seed",
  create: ({ widget, initialValue }) => {
    // Reuse your on-canvas control's DOM builder + value accessor here.
    const el = buildSeedControl(widget, initialValue); // your code
    return {
      el,
      getValue: () => el.currentValue,          // coerced to the widget's type
      hasChanged: () => el.currentValue !== initialValue,
      focus: () => el.querySelector("input")?.focus(),
      destroy: () => el.teardown?.(),           // remove listeners / timers
    };
  },
});
```

Guidance:

- **Split the DOM builder from the self-committing modal wrapper.** Your
  on-canvas path opens a modal that commits on close; the provider path returns
  a live control the *editor* commits. Extract the shared inner builder + a
  value accessor; keep the modal wrapper for the canvas path.
- **`getValue()` must return the widget's native type** (the editor commits it
  verbatim). `hasChanged()` gates whether the editor churns that widget.
- **Implement `destroy()`** if `create()` attaches listeners/timers — the editor
  calls it when the row is discarded.
- `match()` must be cheap and total; a throw is swallowed and treated as
  no-match, but don't rely on that.

## (i-consumer) Resolve + mount a provider — the editor

In your per-field builder, try a provider *before* the built-in control, and
fall back on `null`:

```ts
import { resolveFieldProvider } from "@laurigates/comfy-modal-kit";

function buildField(widget, kind) {
  const provider = resolveFieldProvider(widget, node);
  if (provider) {
    const ctl = provider.create({ widget, node, initialValue: widget.value });
    return {
      widget, kind,
      el: ctl.el,
      read: () => ctl.getValue(),
      changed: () => ctl.hasChanged(),
      focus: () => ctl.focus?.(),
      _destroy: () => ctl.destroy?.(),   // call from the modal's onClose
    };
  }
  // …existing built-in <input>/<select> path unchanged…
}
```

Call each row's `destroy()` in the editor modal's `onClose`.

## (ii) Adopt `patchWidgetPointer` + `isModalActive`

Replace the hand-rolled `onPointerDown` wrapper with the shared one. It chains
the original handler, honors its consumed-return, runs your opener otherwise,
and falls back to the native control on error:

```ts
import { patchWidgetPointer } from "@laurigates/comfy-modal-kit";

patchWidgetPointer(widget, (_pointer, node) => {
  return openMyModal(widget, node); // return true if you took over, false to fall through
});
```

`openMyModal` should build on `openModalShell`, which already registers itself
as the single active modal — so opening it dismisses any sibling modal
automatically.

## (iii) Participate in the pointer-claim protocol — gesture packs

Window-level gesture packs (`touch-connect`, `touch-resize`, `touch-tooltips`)
should **not** act on a canvas gesture while a modal is open, and should
announce a pointer they take:

```ts
import { isModalActive, claimPointer } from "@laurigates/comfy-modal-kit";

window.addEventListener("pointerdown", (e) => {
  if (isModalActive()) return;   // a modal owns the interaction — stand down
  if (!isMyGesture(e)) return;
  claimPointer("touch-resize");  // advisory: announce the claim to peers
  // …handle the gesture…
}, true);
```

The kit installs a best-effort window guard that vetoes outside-modal
pointerdowns, but same-target capture-listener order across packs is
non-deterministic, so the `isModalActive()` guard above is what makes the veto
reliable. This is the deferred future-work step for the gesture packs.

## Verify your integration

- **Provider**: install your pack + `comfyui-prompt-editor`, open the editor on a
  node with your target widget → your inline control appears; edit + save →
  write-back round-trips; remove your pack → the editor falls back to its
  built-in control.
- **Coordinator**: open your modal, then open a sibling pack's modal → the first
  dismisses (one backdrop, not two).
