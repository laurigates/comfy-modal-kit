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

/** Shared mutable state — one instance per browser realm, keyed by Symbol. */
interface KitRuntime {
  /** Registered field providers; a re-register by id replaces in place. */
  fieldProviders: FieldProvider[];
  /** The single modal on screen across ALL packs, or null when none. */
  activeModal: ActiveModalHandle | null;
  /** Most-recent pointer-claim id (diagnostic / future arbitration). */
  pointerClaim: string | null;
}

const KEY = Symbol.for("laurigates.comfyModalKit");

/**
 * Return the shared KitRuntime, creating it on first access. All kit state
 * flows through this accessor so the inlined per-pack copies share one store.
 */
export function getKit(): KitRuntime {
  const g = globalThis as unknown as Record<symbol, KitRuntime | undefined>;
  let kit = g[KEY];
  if (!kit) {
    kit = { fieldProviders: [], activeModal: null, pointerClaim: null };
    g[KEY] = kit;
  }
  return kit;
}
