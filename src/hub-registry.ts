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
  return [...getKit().hubEntries].sort(byPriority);
}

/**
 * The chooser's one ordering rule, shared by both registries: priority
 * descending, ties keeping registration order (`Array.prototype.sort` is stable
 * in ES2019+). Deliberately ONE function rather than the same expression
 * written twice — a duplicated comparator drifts, and it also makes the
 * mutation table's anchor for this rule ambiguous, which silently disarms it.
 */
function byPriority(a: { priority?: number }, b: { priority?: number }): number {
  return (b.priority ?? 0) - (a.priority ?? 0);
}

// ---------------------------------------------------------------------------
// Toggles — a SEPARATE registry, and the separation is the point
// ---------------------------------------------------------------------------
//
// A chooser row that flips a family-wide preference (Safe View) is not a tool,
// and must not be counted as one. `installHubButton`'s single-entry
// short-circuit opens the lone registered tool directly rather than costing a
// tap on a one-row menu (hub.ts) — so registering a toggle as an ordinary
// HubEntry would make `length === 2` for every single-pack user and silently
// take that tap back. Toggles therefore live in their own list and
// `getHubEntries()` is unchanged by construction, not by care.
//
// The other half of the split is behavioural. A chooser row must close the
// chooser BEFORE it acts (hub.ts's `runRow`), because the kit's scrim is
// z-9998 while PrimeVue dialogs sit at 1800, so acting first opens them behind
// our own backdrop. A toggle opens nothing at all, so that rule does not apply
// to it: it flips the boolean and repaints itself in place with the chooser
// still up — which is also the better interaction, since flipping a filter and
// being thrown out of the menu is a worse answer than seeing it flip.

/** One toggle row in the Touch Tools chooser. */
export interface HubToggle {
  /** Kebab id, e.g. `"safe-view.toggle"`. */
  id: string;
  /** Row title. */
  label: string;
  /** PrimeIcons class ("pi pi-*"). */
  icon: string;
  /** One-line row subtitle. */
  description?: string;
  /** Higher sorts first. Ties keep registration order. Defaults to 0. */
  priority?: number;
  /**
   * Current state, read at RENDER time (and again after each flip) rather than
   * captured at registration — the value lives in ComfyUI's setting store and
   * can change from the settings dialog, another pack, or another device.
   */
  get: () => boolean;
  /** Flip it. The chooser re-reads {@link get} afterwards and repaints in place. */
  set: (next: boolean) => void;
}

/**
 * Register a toggle row. Idempotent by `id` — a second pack registering the
 * same toggle replaces it in place rather than adding a duplicate row, which is
 * what lets both gallery packs call `registerSafeViewHubToggle()` blindly.
 */
export function registerHubToggle(toggle: HubToggle): void {
  const list = getKit().hubToggles;
  const i = list.findIndex((t) => t.id === toggle.id);
  if (i >= 0) {
    list.splice(i, 1, toggle);
  } else {
    list.push(toggle);
  }
}

/** The registered toggles, priority descending then registration order. */
export function getHubToggles(): readonly HubToggle[] {
  return [...getKit().hubToggles].sort(byPriority);
}
