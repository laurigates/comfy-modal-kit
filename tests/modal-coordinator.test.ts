// modal-coordinator.test.ts — coverage for cross-pack modal + pointer
// coordination. The active-modal slot and pointer guard touch the DOM, so this
// file runs under jsdom (per-file annotation, keeping the rest DOM-free).
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  type ActiveModalHandle,
  dismissActiveModal,
  getActiveModal,
  installPointerGuard,
  isModalActive,
  type PointerPatchableWidget,
  patchWidgetPointer,
  setActiveModal,
} from "../src/modal-coordinator.js";

const handle = (close: () => void, element?: HTMLElement): ActiveModalHandle => ({
  id: "test",
  element,
  close,
});

beforeEach(() => {
  dismissActiveModal(); // clear any modal a prior test left active
  document.body.innerHTML = "";
});

describe("active-modal slot", () => {
  test("setActiveModal dismisses the previous modal (single active across packs)", () => {
    const closeA = vi.fn();
    const closeB = vi.fn();
    setActiveModal(handle(closeA));
    setActiveModal(handle(closeB));
    // Opening B dismissed A exactly once; B is now active.
    expect(closeA).toHaveBeenCalledTimes(1);
    expect(closeB).not.toHaveBeenCalled();
    expect(isModalActive()).toBe(true);
  });

  test("dismissActiveModal closes the active modal and is idempotent", () => {
    const close = vi.fn();
    setActiveModal(handle(close));
    dismissActiveModal();
    expect(close).toHaveBeenCalledTimes(1);
    expect(isModalActive()).toBe(false);
    expect(getActiveModal()).toBeNull();
    dismissActiveModal(); // no-op — already dismissed
    expect(close).toHaveBeenCalledTimes(1);
  });

  test("the shared slot clears BEFORE close() runs, so a re-entrant close cannot recurse", () => {
    let reentrantActiveState: boolean | null = null;
    const close = vi.fn(() => {
      // A close handler that re-enters must see the slot already cleared.
      reentrantActiveState = isModalActive();
      dismissActiveModal(); // would infinite-loop if the slot weren't cleared first
    });
    setActiveModal(handle(close));
    dismissActiveModal();
    expect(close).toHaveBeenCalledTimes(1);
    expect(reentrantActiveState).toBe(false);
  });

  test("a close() that throws is swallowed and the slot still clears", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    setActiveModal(
      handle(() => {
        throw new Error("close exploded");
      }),
    );
    expect(() => dismissActiveModal()).not.toThrow();
    expect(isModalActive()).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("patchWidgetPointer", () => {
  test("chains the original handler and honors its consumed-return", () => {
    const original = vi.fn(() => true);
    const opener = vi.fn(() => true);
    const widget: PointerPatchableWidget = { onPointerDown: original };
    patchWidgetPointer(widget, opener);
    const consumed = widget.onPointerDown?.("p", "n", "c");
    expect(original).toHaveBeenCalledWith("p", "n", "c");
    expect(consumed).toBe(true);
    // Original consumed the event, so the opener never ran.
    expect(opener).not.toHaveBeenCalled();
  });

  test("runs the opener when the original does not consume", () => {
    const original = vi.fn(() => false);
    const opener = vi.fn(() => true);
    const widget: PointerPatchableWidget = { onPointerDown: original };
    patchWidgetPointer(widget, opener);
    expect(widget.onPointerDown?.("p", "n", "c")).toBe(true);
    expect(opener).toHaveBeenCalledWith("p", "n", "c");
  });

  test("runs the opener when there is no original handler", () => {
    const opener = vi.fn(() => true);
    const widget: PointerPatchableWidget = {};
    patchWidgetPointer(widget, opener);
    expect(widget.onPointerDown?.("p", "n", "c")).toBe(true);
    expect(opener).toHaveBeenCalled();
  });

  test("falls back to native (returns false) when the opener throws", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const widget: PointerPatchableWidget = {};
    patchWidgetPointer(widget, () => {
      throw new Error("opener exploded");
    });
    expect(widget.onPointerDown?.("p", "n", "c")).toBe(false);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("restore() puts the original handler back", () => {
    const original = vi.fn(() => true);
    const widget: PointerPatchableWidget = { onPointerDown: original };
    const patch = patchWidgetPointer(widget, () => false);
    patch.restore();
    expect(widget.onPointerDown).toBe(original);
  });
});

describe("pointer guard (best-effort modal->gesture veto)", () => {
  // Register a peer window-capture listener AFTER the guard so
  // stopImmediatePropagation can suppress it — this stands in for a gesture
  // pack's window pointerdown listener.
  let gestureSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    installPointerGuard(); // idempotent; ensures the guard is registered first
    gestureSpy = vi.fn();
    window.addEventListener("pointerdown", gestureSpy, true);
  });

  afterEach(() => {
    window.removeEventListener("pointerdown", gestureSpy, true);
  });

  test("a pointerdown OUTSIDE the active modal is vetoed and dismisses the modal", () => {
    const dialog = document.createElement("div");
    const outside = document.createElement("div");
    document.body.append(dialog, outside);
    const close = vi.fn();
    setActiveModal(handle(close, dialog));

    outside.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(gestureSpy).not.toHaveBeenCalled(); // gesture suppressed
    expect(close).toHaveBeenCalledTimes(1); // modal dismissed
    expect(isModalActive()).toBe(false);
  });

  test("a pointerdown INSIDE the active modal passes through and keeps it open", () => {
    const dialog = document.createElement("div");
    const inside = document.createElement("div");
    dialog.appendChild(inside);
    document.body.appendChild(dialog);
    const close = vi.fn();
    setActiveModal(handle(close, dialog));

    inside.dispatchEvent(new Event("pointerdown", { bubbles: true }));

    expect(gestureSpy).toHaveBeenCalledTimes(1); // passed through
    expect(close).not.toHaveBeenCalled(); // modal stays
    expect(isModalActive()).toBe(true);
  });

  test("does nothing when no modal is active", () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    el.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(gestureSpy).toHaveBeenCalledTimes(1);
  });
});
