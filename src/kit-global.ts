// kit-global.ts — the cross-pack runtime rendezvous.
//
// Every consuming pack inlines its OWN copy of comfy-modal-kit into its served
// bundle (`bun build --target browser` bundles node_modules in; nothing from
// node_modules/ ships to ComfyUI at runtime). A module-level singleton would
// therefore be duplicated once per pack — pack A's `let ACTIVE` and pack B's
// `let ACTIVE` are different variables — which defeats any "single active
// modal across packs" or "one shared field-provider registry" intent.
//
// Instead, all shared mutable state lives on a single object keyed by a
// well-known Symbol on globalThis. `Symbol.for(key)` returns the SAME symbol
// for the same key in every realm, so the per-pack inlined copies converge on
// one KitRuntime instance at runtime. This module is internal — not exported
// from the barrel — but the shape of KitRuntime IS the cross-pack
// compatibility surface: two packs with incompatible KitRuntime shapes would
// clobber each other, so extend it additively.

import type { FieldProvider } from "./field-registry.js";
import type { ActiveModalHandle } from "./modal-coordinator.js";
import type { ModelPicker } from "./model-picker-registry.js";

/** Shared mutable state — one instance per browser realm, keyed by Symbol. */
interface KitRuntime {
  /** Registered field providers; a re-register by id replaces in place. */
  fieldProviders: FieldProvider[];
  /** Registered model-file pickers; a re-register by id replaces in place. */
  modelPickers: ModelPicker[];
  /** The single modal on screen across ALL packs, or null when none. */
  activeModal: ActiveModalHandle | null;
  /** Most-recent pointer-claim id (diagnostic / future arbitration). */
  pointerClaim: string | null;
  /**
   * Kit-owned DOM that lives OUTSIDE the dialog (the notify stack) but is part
   * of the modal experience; the pointer guard must not treat it as "outside"
   * and dismiss the modal when the user taps it.
   */
  modalChrome: HTMLElement[];
  /**
   * Whether the capture-phase window pointer guard is already installed. Lives
   * here rather than in a module-local `let` so the per-pack inlined copies
   * dedupe one window listener between them instead of each adding its own.
   */
  pointerGuardInstalled: boolean;
}

const KEY = Symbol.for("laurigates.comfyModalKit");

/**
 * Return the shared KitRuntime, creating it on first access. All kit state
 * flows through this accessor so the inlined per-pack copies share one store.
 *
 * A pack running an OLDER inlined kit may have created this object before a
 * field existed — nothing coordinates which pack's copy wins the race, and
 * whichever loads first is the one that constructs it. So every collection is
 * backfilled on access rather than only at construction: a newer pack asking
 * for `modelPickers` on an object an older pack built must get an array, not
 * `undefined`. This is what "extend the KitRuntime shape additively" means in
 * practice.
 */
export function getKit(): KitRuntime {
  const g = globalThis as unknown as Record<symbol, KitRuntime | undefined>;
  let kit = g[KEY];
  if (!kit) {
    kit = {
      fieldProviders: [],
      modelPickers: [],
      activeModal: null,
      pointerClaim: null,
      modalChrome: [],
      pointerGuardInstalled: false,
    };
    g[KEY] = kit;
  }
  if (!kit.fieldProviders) kit.fieldProviders = [];
  if (!kit.modelPickers) kit.modelPickers = [];
  if (!kit.modalChrome) kit.modalChrome = [];
  // `pointerGuardInstalled` needs no backfill: on an object an older copy built
  // it reads `undefined`, which is falsy — exactly the right answer ("this
  // newer copy has not installed the guard yet").
  return kit;
}
