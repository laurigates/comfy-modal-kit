// modal-coordinator.ts — cross-pack modal + pointer coordination.
//
// Three coordination problems, one shared mechanism (getKit):
//
// 1. Single active modal ACROSS packs. Because each pack inlines its own kit
//    copy, a module-local `let ACTIVE` only tracks that pack's modals. Opening
//    pack B's modal would not dismiss pack A's — two backdrops coexist,
//    ownership is ambiguous. Routing every modal through the shared
//    `activeModal` slot makes any pack's open dismiss whatever is truly on
//    screen. modal-shell registers itself here.
//
// 2. A uniform widget-pointer "consumed" contract. Every touch pack hand-rolls
//    the same "chain the original onPointerDown, then consume" wrapper with a
//    slightly different consumed-return. patchWidgetPointer standardizes it.
//
// 3. Best-effort modal -> gesture veto. The window-level gesture packs
//    (touch-connect link-snap, touch-resize pinch, touch-tooltips) grab
//    `window` pointerdown in capture phase with no coordination, so a canvas
//    gesture can fire while a modal is open. installPointerGuard adds a
//    capture-phase window guard that dismisses the modal and stops propagation
//    for pointerdowns outside the active modal. FULL veto also needs the
//    gesture packs to consult isModalActive() themselves (they register their
//    own window-capture listeners, and same-target listener order across packs
//    is non-deterministic) — that is the pointer-claim protocol below, and
//    gesture-pack adoption of it is tracked as future work. "Outside the modal"
//    is not the same as "outside the dialog element": kit-owned chrome that
//    renders above the modal from a body-level container (the notify stack) is
//    registered via registerModalChrome and exempted from the guard.

import { getKit } from "./kit-global.js";

/** A handle to whatever modal is currently the single active modal. */
export interface ActiveModalHandle {
  /** Owning pack/source id, for diagnostics. */
  id?: string;
  /** The modal's outermost interactive element (dialog), for hit-testing. */
  element?: HTMLElement;
  /** Dismiss the modal. MUST be idempotent — the coordinator may call it. */
  close: () => void;
}

/** A LiteGraph-widget-like object carrying the optional pointer hook. */
export interface PointerPatchableWidget {
  onPointerDown?: (...args: unknown[]) => unknown;
  [key: string]: unknown;
}

/**
 * Opener invoked by a patched widget. Return true when the opener took over
 * (event consumed, native control suppressed); false to fall through to the
 * native control.
 */
export type WidgetPointerOpener = (pointer: unknown, node: unknown, canvas: unknown) => boolean;

/** Handle returned by {@link patchWidgetPointer} for restoring the widget. */
export interface WidgetPointerPatch {
  /** Restore the widget's original onPointerDown. */
  restore(): void;
}

/**
 * Attribute stamped on every registered chrome element. The registry lookup is
 * the primary path; this attribute is the cross-realm belt-and-braces, so a
 * chrome element registered by a *different* inlined kit copy (or one whose
 * registry entry was lost) is still recognised by a DOM ancestor walk.
 */
const CHROME_ATTR = "data-cmp-chrome";

/**
 * Register `handle` as the single active modal, dismissing any modal already
 * on screen first (across every pack, via the shared runtime). Also installs
 * the window pointer guard on first use.
 */
export function setActiveModal(handle: ActiveModalHandle): void {
  installPointerGuard();
  dismissActiveModal();
  getKit().activeModal = handle;
}

/**
 * Dismiss the current active modal, if any. Clears the shared slot BEFORE
 * calling close() so a close handler that re-enters the coordinator can't
 * recurse. A close() that throws is swallowed (logged).
 */
export function dismissActiveModal(): void {
  const kit = getKit();
  const active = kit.activeModal;
  if (!active) return;
  kit.activeModal = null;
  try {
    active.close();
  } catch (e) {
    console.warn("[comfy-modal-kit] active modal close() threw", e);
  }
}

/** Whether a modal is currently on screen (across all packs). */
export function isModalActive(): boolean {
  return getKit().activeModal !== null;
}

/** The current active-modal handle, or null. */
export function getActiveModal(): ActiveModalHandle | null {
  return getKit().activeModal;
}

// ============================================================
// Modal chrome — kit-owned DOM that lives outside the dialog
//
// The notify stack (`#cmn-notify-container`) is a child of document.body, not of
// the dialog, because it must paint above the modal shell (z-index 10000 vs
// 9999) and outlive any single modal. That makes it "outside the active modal"
// by the guard's hit-test, which is wrong: tapping a toast is interacting with
// the modal experience, not dismissing it. Registering it as chrome exempts it.
// ============================================================

/** Mark `el` (and its subtree) as kit chrome the pointer guard must not veto. */
export function registerModalChrome(el: HTMLElement): void {
  const chrome = getKit().modalChrome;
  if (!chrome.includes(el)) chrome.push(el);
  el.setAttribute?.(CHROME_ATTR, "");
}

/**
 * Drop `el` from the chrome registry. Callers MUST do this before removing the
 * element from the DOM, so the shared registry never retains a detached node.
 * The attribute comes off too — otherwise the cross-realm fallback below would
 * keep answering "chrome" for an element this registry no longer knows about
 * (`closest()` matches the element itself).
 */
export function unregisterModalChrome(el: HTMLElement): void {
  const chrome = getKit().modalChrome;
  for (let i = chrome.length - 1; i >= 0; i--) {
    if (chrome[i] === el) chrome.splice(i, 1);
  }
  el.removeAttribute?.(CHROME_ATTR);
}

/**
 * Whether `node` sits inside registered modal chrome. Runs on every pointerdown
 * while a modal is up, so it stays cheap: a linear scan of a list that holds one
 * or two entries, then a single `closest()` for the cross-realm fallback.
 */
export function isModalChrome(node: Node | null): boolean {
  if (!node) return false;
  for (const el of getKit().modalChrome) {
    if (el.contains?.(node)) return true;
  }
  // Cross-realm / mixed-kit-version fallback: another inlined copy's registry
  // is invisible to us, but the attribute it stamped is in the DOM.
  const el =
    node.nodeType === 1
      ? (node as Element)
      : (node as { parentElement?: Element | null }).parentElement;
  return !!el?.closest?.(`[${CHROME_ATTR}]`);
}

/**
 * Record a pointer claim by a window-level gesture pack. Part of the
 * pointer-claim protocol: a gesture pack should `if (isModalActive()) return;`
 * before acting on a pointer, and `claimPointer(id)` when it takes one, so
 * peers can observe who owns the gesture. Currently advisory (stored for
 * diagnostics / future arbitration).
 */
export function claimPointer(id: string): void {
  getKit().pointerClaim = id;
}

/**
 * Patch a widget's onPointerDown with the uniform chain-then-consume contract:
 * chain to the original handler first and honor its consumed-return; otherwise
 * call `opener` and consume only when it took over; on error, fall back to the
 * native control (return false). This mirrors the wrapper the touch packs
 * hand-roll today, so adopting it is a drop-in.
 *
 * @returns a handle whose restore() puts the original handler back.
 */
export function patchWidgetPointer(
  widget: PointerPatchableWidget,
  opener: WidgetPointerOpener,
): WidgetPointerPatch {
  const original = widget.onPointerDown;
  function patched(this: unknown, pointer: unknown, node: unknown, canvas: unknown): unknown {
    try {
      if (typeof original === "function") {
        const consumed = original.call(this, pointer, node, canvas);
        if (consumed) return consumed;
      }
      return opener(pointer, node, canvas);
    } catch (e) {
      console.warn("[comfy-modal-kit] patched onPointerDown threw", e);
      return false;
    }
  }
  widget.onPointerDown = patched;
  return {
    restore() {
      widget.onPointerDown = original;
    },
  };
}

/**
 * Install the best-effort capture-phase window pointer guard (idempotent, and
 * a no-op outside a browser). While a modal is active, a pointerdown OUTSIDE
 * the active modal dismisses it and has its propagation stopped, so
 * window-level gesture packs don't also act on the same tap. Pointerdowns
 * inside the modal — or inside registered modal chrome — pass through untouched.
 *
 * The installed flag lives on the shared runtime, not in a module-local `let`,
 * so the per-pack inlined copies install ONE window listener between them.
 */
export function installPointerGuard(): void {
  const kit = getKit();
  if (kit.pointerGuardInstalled) return;
  if (typeof window === "undefined") return;
  kit.pointerGuardInstalled = true;
  window.addEventListener("pointerdown", pointerGuard, true);
}

function pointerGuard(e: Event): void {
  const active = getKit().activeModal;
  if (!active) return;
  const target = e.target as Node | null;
  if (active.element && target && active.element.contains(target)) {
    return; // inside the modal — let it interact normally
  }
  if (isModalChrome(target)) {
    // The notify stack sits above the modal on purpose (z-index 10000 > 9999)
    // and is a child of body, so a tap on a toast must REACH the toast.
    // Treating it as "outside" made dismissing a toast dismiss the whole modal.
    return;
  }
  // Outside the active modal: veto any window-level gesture, then dismiss.
  e.stopImmediatePropagation();
  dismissActiveModal();
}
