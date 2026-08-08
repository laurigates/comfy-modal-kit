// back-guard.ts — make the Android/gesture back button act on the modal
// instead of navigating away from ComfyUI.
//
// A sentinel history entry is pushed while the modal is open, so a hardware or
// gesture back pops THAT instead of leaving the page. The pack decides what
// back means for it — comfyui-image-browser dismisses an open overlay, else
// ascends one directory, and only closes at a root; a picker has no overlays
// and just ascends — so the policy is the caller's callback and only the
// history bookkeeping lives here. Same shape as `postRating(url, …)`: the kit
// owns the mechanism, the pack supplies the specifics.
//
// The bookkeeping is the part worth sharing, because it has one non-obvious
// state: after a pop the sentinel is ALREADY consumed, so a teardown that
// unconditionally calls `history.back()` would eat a real history entry and
// navigate the user off ComfyUI — the exact thing the guard exists to prevent.
// `armed` tracks it.

/**
 * Push a sentinel history entry and route `popstate` to `onBack`.
 *
 * `onBack` returns **true** if it handled the back (the guard re-arms the
 * sentinel and the modal stays open) or **false** if not — in which case the
 * guard disarms and the caller is expected to close the modal from inside that
 * same callback.
 *
 * Returns a disposer to call from the modal's `onClose`. It pops the sentinel
 * only when it is still armed, so closing via back (sentinel already consumed)
 * and closing via the ✕ (still armed) both leave history exactly as found.
 * Safe no-op where there is no `window`/`history`.
 *
 * Pass `{ pop: false }` when the caller is handing off synchronously to ANOTHER
 * modal that will push its own sentinel: popping here would queue a traversal
 * that could land after the new push and eat the new modal's sentinel. The
 * cost of not popping is one inert history entry — at worst one extra Back
 * press that no listener handles, which is strictly safer than the race.
 */
export function installBackGuard(onBack: () => boolean): (opts?: { pop?: boolean }) => void {
  if (typeof window === "undefined" || typeof history === "undefined") return () => {};

  let armed = false;
  let disposed = false;

  const arm = (): void => {
    history.pushState({ cmpBackGuard: true }, "");
    armed = true;
  };

  const dispose = (opts?: { pop?: boolean }): void => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("popstate", onPop);
    if (armed) {
      armed = false;
      if (opts?.pop !== false) history.back();
    }
  };

  function onPop(): void {
    // The pop consumed the sentinel; re-arm only if the pack handled it.
    armed = false;
    let handled = false;
    try {
      handled = onBack();
    } catch (e) {
      console.error("[comfy-modal-kit] back handler threw", e);
    }
    if (handled && !disposed) {
      arm();
      return;
    }
    // Not handled: the caller closes (likely re-entering dispose via onClose).
    dispose();
  }

  arm();
  window.addEventListener("popstate", onPop);
  return dispose;
}
