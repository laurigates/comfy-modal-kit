// model-picker-registry.ts — cross-pack registry of "pick a model file from
// folder_paths category X" controls.
//
// The problem this exists for: rgthree's Power Lora Loader carries one custom
// widget PER lora row, whose value is an OBJECT
// (`{on, lora, strength, strengthTwo}`) and which has no `options.values`
// array. comfyui-model-gallery's FieldProvider matches on
// "widget name is a known model combo AND it carries options.values", so it
// can never engage — and comfyui-prompt-editor is left rendering the lora
// filename as a bare `<input type="text">`: typing a model path by hand on a
// phone, which is the whole thing these packs exist to avoid.
//
// Why a SEPARATE registry rather than widening FieldProvider (see ADR-0003):
// FieldProvider is widget→control by construction — one widget, one value, one
// `initialValue`/`getValue()` pair. A lora row is one widget carrying FOUR
// logical fields, and its value is an object while a file picker's value is a
// string, so threading it through FieldProvider makes `initialValue` and
// `getValue()` disagree in type at the contract level. The unit of reuse here
// ("let the user pick a file from folder_paths category `loras`") involves no
// widget at all: the host owns the row, and asks only for the picker.
//
// Additive-fallback contract, identical to field-registry: resolveModelPicker
// returns null when nothing matches and the consumer MUST fall back to its
// built-in control (for prompt-editor, the text input it renders today). A
// picker pack that isn't installed simply never registers.

import { getKit } from "./kit-global.js";

/**
 * A live, mounted model-picker control returned by a picker's create().
 *
 * Deliberately the string-valued subset of {@link FieldControl}: a picker
 * always yields the exact `folder_paths` relative filename, never a widget's
 * native type. Hosts mount `el`, then read `getValue()` on confirm.
 */
export interface ModelPickerControl {
  /**
   * Root element to mount.
   *
   * MUST NOT be a scroll container (no `overflow-y: auto|scroll`, no
   * `overscroll-behavior: contain`, no fixed/`100%` height) — its natural
   * height must be its content height. The same rule as `FieldControl.el`,
   * and for the same reason: a control that scrolls internally never gets a
   * definite height when mounted inline, so it has nothing to scroll yet still
   * swallows the touch-scroll gesture.
   *
   * The corollary is on the HOST: because `el` does not scroll, a host that
   * mounts it into a height-constrained container (e.g. `openShellOverlay`'s
   * `.cmp-ov-card`, which is `max-height`-capped `display:flex` column with no
   * scroll region of its own) MUST wrap it in its own
   * `flex: 1; overflow-y: auto` element, or the grid is clipped and the files
   * below the fold are unreachable.
   */
  el: HTMLElement;
  /** The currently chosen `folder_paths` relative filename ("" when none). */
  getValue(): string;
  /** Whether the chosen value differs from the `initialValue` it was built with. */
  hasChanged(): boolean;
  /** Optional: focus the control's primary input (usually its search box). */
  focus?(): void;
  /**
   * Optional: hand the host a callback invoked whenever the chosen value
   * changes, so the host can enable its own Choose/OK affordance on the first
   * selection. A picker that only ever yields a value at teardown omits it.
   */
  onValueChange?(cb: (value: string) => void): void;
  /** Optional: tear down listeners / DOM when the host discards the control. */
  destroy?(): void;
}

/** What a host asks for when it wants a picker. */
export interface ModelPickerRequest {
  /**
   * The `folder_paths` category to enumerate — `"loras"`, `"checkpoints"`,
   * `"vae"`, … NOT a widget name. This is the whole point of the separate
   * registry: the host names the *file space*, not a widget.
   */
  category: string;
  /** The value to preselect; "" when the host has no current value. */
  initialValue: string;
}

/** What a host asks for when it wants the optional metadata strip. */
export interface ModelSummaryRequest {
  category: string;
  /** The chosen `folder_paths` relative filename to summarise. */
  value: string;
}

/** A registered provider of model-file pickers. */
export interface ModelPicker {
  /** Stable id; re-registering the same id replaces the prior entry. */
  id: string;
  /** Higher wins when multiple pickers match. Defaults to 0. */
  priority?: number;
  /** Return true when this picker can enumerate the given category. */
  supports(category: string): boolean;
  /** Build the live picker. Called lazily when the host actually opens it. */
  create(req: ModelPickerRequest): ModelPickerControl;
  /**
   * Optional: a compact metadata strip for an already-chosen file (base
   * architecture, rank/alpha, trigger words). Provider-owned DOM — the host
   * mounts it and never inspects it, so all metadata knowledge stays inside
   * the provider pack. Fills asynchronously; returns immediately.
   */
  createSummary?(req: ModelSummaryRequest): HTMLElement;
}

/**
 * Register a model picker. Idempotent by `id`: registering an id that is
 * already present replaces it in place (so a pack reloading its extension
 * doesn't accumulate duplicates).
 */
export function registerModelPicker(picker: ModelPicker): void {
  const list = getKit().modelPickers;
  const i = list.findIndex((p) => p.id === picker.id);
  if (i >= 0) {
    list.splice(i, 1, picker);
  } else {
    list.push(picker);
  }
}

/** The currently registered pickers (read-only snapshot reference). */
export function getModelPickers(): readonly ModelPicker[] {
  return getKit().modelPickers;
}

/**
 * Resolve the highest-priority picker whose supports() returns true for the
 * given category. Ties (equal priority) resolve to the earliest registered.
 * A supports() that throws is swallowed (logged) and treated as no-match, so
 * one misbehaving pack can never break a host's field rendering.
 *
 * @returns the winning picker, or null when nothing matches (fall back to the
 *          host's built-in control).
 */
export function resolveModelPicker(category: string): ModelPicker | null {
  let best: ModelPicker | null = null;
  let bestPriority = Number.NEGATIVE_INFINITY;
  for (const p of getKit().modelPickers) {
    let supported = false;
    try {
      supported = p.supports(category);
    } catch (e) {
      console.warn(`[comfy-modal-kit] model picker "${p.id}" supports() threw`, e);
      supported = false;
    }
    if (!supported) continue;
    const priority = p.priority ?? 0;
    if (priority > bestPriority) {
      best = p;
      bestPriority = priority;
    }
  }
  return best;
}
