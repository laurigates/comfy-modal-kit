// hub-registry.ts — cross-pack registry of Touch Tools hub entries.
//
// The family has one action-bar button (see hub.ts). Tapping it lists every
// touch-first tool installed on the page, so each pack must be able to say "I
// exist and here is how to open me" without knowing which other packs are
// present. That list lives on the shared runtime rendezvous (getKit) so the
// per-pack inlined kit copies converge on ONE registry, exactly like
// field-registry.ts and model-picker-registry.ts.
//
// THE ONE STRUCTURAL CONTRACT: a pack MUST NOT register an entry whose opener
// needs a node, widget or graph context. The chooser is opened from the app
// chrome with nothing selected, so an opener that requires a context would
// produce a row that is visibly present and does nothing — the worst shape a
// menu can take. The signature enforces it: `open: () => void` takes no
// arguments, so there is nothing a context could arrive through. A pack whose
// only entry point is a canvas gesture or a widget tap (comfyui-output-swap,
// comfyui-touch-connect, …) correctly registers NO entry.
//
// Unlike field-registry / model-picker-registry this is a LIST consumer, not a
// winner consumer: every entry renders. There is deliberately no
// `resolveHubEntry`.

import { getKit } from "./kit-global.js";

/** One row in the Touch Tools chooser. */
export interface HubEntry {
  /** Kebab id, same value as the pack's launcher command id (e.g. "image-browser.open"). */
  id: string;
  /** Row title. Also the name the pack should use everywhere else. */
  label: string;
  /** PrimeIcons class ("pi pi-*") — the only icon format that renders for runtime-loaded extensions. */
  icon: string;
  /** One-line row subtitle. */
  description?: string;
  /** Higher sorts first. Ties keep registration order. Defaults to 0. */
  priority?: number;
  /**
   * Zero-argument opener. MUST work with no node, widget or graph context.
   * The chooser closes ITSELF before calling this, so the opener may open a kit
   * shell, a native dialog, or nothing visual at all.
   */
  open: () => void;
}

/**
 * Register a hub entry. Idempotent by `id`: registering an id that is already
 * present replaces it in place (so a pack reloading its extension doesn't
 * accumulate duplicate rows).
 */
export function registerHubEntry(entry: HubEntry): void {
  const list = getKit().hubEntries;
  const i = list.findIndex((e) => e.id === entry.id);
  if (i >= 0) {
    list.splice(i, 1, entry);
  } else {
    list.push(entry);
  }
}

/**
 * The registered entries, priority descending then registration order.
 * `Array.prototype.sort` is stable in ES2019+, so equal priorities preserve
 * registration order — matching both sibling registries' tie-break.
 *
 * Returns a sorted COPY. This is a deliberate divergence from
 * `getFieldProviders` / `getModelPickers`, which hand back the live array: the
 * sort would otherwise reorder the shared rendezvous list in place, and the
 * registry's tie-break IS registration order, so mutating it would make the
 * tie-break depend on how many times the chooser had been opened.
 */
export function getHubEntries(): readonly HubEntry[] {
  return [...getKit().hubEntries].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}
