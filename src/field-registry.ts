// field-registry.ts — cross-pack registry of enhanced inline field controls.
//
// The problem: comfyui-prompt-editor is an all-fields node editor. It renders
// a dumb <input type=number> for `seed` and a dumb <select> for `sampler_name`
// / `ckpt_name`, even when comfyui-touch-numeric / -sampler-info /
// -model-gallery are installed and each owns a richer control for exactly
// those widgets. The richer control is reachable only by tapping the widget on
// the canvas, never from inside the editor.
//
// The fix: a provider pack REGISTERS a FieldProvider here; the editor
// RESOLVES the highest-priority matching provider per field and mounts its
// FieldControl inline in place of the built-in control. The registry lives on
// the shared runtime rendezvous (getKit) so the per-pack inlined copies share
// ONE provider list.
//
// Additive-fallback contract: resolveFieldProvider returns null when nothing
// matches, and the consumer MUST fall back to its built-in control. A
// provider that isn't installed simply doesn't register — the editor keeps
// working exactly as before. The same contract governs the optional members
// of FieldControlContext / FieldControl below: a host that doesn't supply
// them and a provider that ignores them both behave exactly as before.
//
// Cross-field awareness: a host that renders several fields at once may pass
// getSiblingValue / onSiblingChange so one control can react to another's
// UNCOMMITTED value (see FieldControlContext). This registry defines only the
// contract — the host owns the bus; the kit ships no runtime for it.

import { getKit } from "./kit-global.js";

/** The subset of a LiteGraph widget a provider inspects to decide a match. */
export interface FieldWidgetLike {
  /** Widget name, e.g. "seed", "sampler_name", "ckpt_name". */
  name?: string;
  /** Widget type, e.g. "number", "combo", "toggle". */
  type?: string;
  /** Current widget value. */
  value?: unknown;
  /** Widget options; `values` holds a combo's choices. */
  options?: { values?: unknown } & Record<string, unknown>;
}

/** Context handed to a provider's create(). */
export interface FieldControlContext {
  /** The widget the control is being built for. */
  widget: FieldWidgetLike;
  /** The owning node (opaque — providers narrow it themselves). */
  node: unknown;
  /** The widget's value at open time, for change tracking. */
  initialValue: unknown;
  /**
   * Optional: read the live in-modal value of a SIBLING widget on the same
   * node — i.e. what the user has picked in another field of this same modal
   * session, before anything is committed back to the node.
   *
   * Use this instead of reading `node.widgets[]`. A host that edits several
   * fields at once (comfyui-prompt-editor) only writes values back to the
   * node on commit, so `node.widgets[]` yields the COMMITTED value — the one
   * from before the modal opened — not the uncommitted one the user just
   * chose. A control that cross-references a sibling (e.g. highlighting the
   * schedulers that pair with the currently-selected SAMPLER) reads a stale
   * value if it goes to the node.
   *
   * Falls back to the node's committed value when the host has no live entry
   * for that widget. Absent entirely when the host edits a single widget in
   * its own modal — there, no sibling is live, and reading `node.widgets[]`
   * IS correct.
   */
  getSiblingValue?(widgetName: string): unknown;
  /**
   * Optional: subscribe to sibling value changes for the lifetime of this
   * modal session. The callback fires when ANY other field in the same modal
   * changes; filter by `widgetName` for the sibling(s) you care about.
   *
   * @returns an unsubscribe function — call it from the control's destroy().
   */
  onSiblingChange?(cb: (widgetName: string, value: unknown) => void): () => void;
}

/**
 * A live, mounted inline control returned by a provider's create(). Maps 1:1
 * onto comfyui-prompt-editor's existing FieldRow contract (el / read /
 * changed / focus), so consumption is a drop-in wrap.
 */
export interface FieldControl {
  /**
   * Root element to mount in the field row.
   *
   * MUST NOT be a scroll container: no `overflow-y: auto|scroll`, no
   * `overscroll-behavior: contain`, no fixed/`100%` height. Its natural height
   * must be its content height; outer scrolling is the host modal's job — the
   * shell has exactly one scroll region (`.cmp-body`).
   *
   * A control that scrolls internally works inside its own dialog (a
   * constrained parent gives it a definite height) but breaks when mounted
   * inline in a host modal: it never gets a definite height, so it has nothing
   * to scroll, yet it still swallows the touch-scroll gesture — and
   * `overscroll-behavior: contain` stops that gesture from chaining back out
   * to the host's scroll region. The field, and everything below it, becomes
   * unscrollable.
   */
  el: HTMLElement;
  /** Current value, coerced to the widget's native type, for commit. */
  getValue(): unknown;
  /** Whether the value differs from `initialValue`. */
  hasChanged(): boolean;
  /** Optional: focus the control's primary input. */
  focus?(): void;
  /**
   * Optional: hand the host a callback to invoke whenever this control's value
   * changes, so sibling fields in the same modal can react to it live (the
   * other end of `FieldControlContext.getSiblingValue` / `onSiblingChange`).
   *
   * The host calls this once, right after create(). A control that has no
   * siblings to inform simply omits it.
   */
  onValueChange?(cb: (value: unknown) => void): void;
  /** Optional: tear down listeners / DOM when the row is discarded. */
  destroy?(): void;
}

/** A registered provider of enhanced inline field controls. */
export interface FieldProvider {
  /** Stable id; re-registering the same id replaces the prior entry. */
  id: string;
  /** Higher wins when multiple providers match. Defaults to 0. */
  priority?: number;
  /** Return true when this provider handles the given widget. */
  match(widget: FieldWidgetLike, node: unknown): boolean;
  /** Build the live control. Called lazily when the field is rendered. */
  create(ctx: FieldControlContext): FieldControl;
}

/**
 * Register a field provider. Idempotent by `id`: registering an id that is
 * already present replaces it in place (so a pack reloading its extension
 * doesn't accumulate duplicates).
 */
export function registerFieldProvider(provider: FieldProvider): void {
  const list = getKit().fieldProviders;
  const i = list.findIndex((p) => p.id === provider.id);
  if (i >= 0) {
    list.splice(i, 1, provider);
  } else {
    list.push(provider);
  }
}

/** The currently registered providers (read-only snapshot reference). */
export function getFieldProviders(): readonly FieldProvider[] {
  return getKit().fieldProviders;
}

/**
 * Resolve the highest-priority provider whose match() returns true for the
 * given widget. Ties (equal priority) resolve to the earliest registered.
 * A match() that throws is swallowed (logged) and treated as no-match, so one
 * misbehaving provider can never break the editor's field rendering.
 *
 * @returns the winning provider, or null when nothing matches (fall back to
 *          the built-in control).
 */
export function resolveFieldProvider(widget: FieldWidgetLike, node: unknown): FieldProvider | null {
  let best: FieldProvider | null = null;
  let bestPriority = Number.NEGATIVE_INFINITY;
  for (const p of getKit().fieldProviders) {
    let matched = false;
    try {
      matched = p.match(widget, node);
    } catch (e) {
      console.warn(`[comfy-modal-kit] field provider "${p.id}" match() threw`, e);
      matched = false;
    }
    if (!matched) continue;
    const priority = p.priority ?? 0;
    if (priority > bestPriority) {
      best = p;
      bestPriority = priority;
    }
  }
  return best;
}
