// modal-shell.test.ts — the scroll-region contract.
//
// jsdom performs no layout, so it cannot exercise clamping or real scrolling.
// What it CAN prove is the detach behaviour that motivated getScrollTop: the
// shell removes the dialog before calling onClose, and a consumer reading
// bodyEl.scrollTop there gets whatever a detached element reports.
//
// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";

import { closeModalShell, openModalShell } from "../src/modal-shell.js";

afterEach(() => {
  closeModalShell();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

/** jsdom has no layout, so fake a scrollable body and emit the event. */
function scrollTo(el: HTMLElement, top: number): void {
  Object.defineProperty(el, "scrollTop", { value: top, writable: true, configurable: true });
  el.dispatchEvent(new Event("scroll"));
}

describe("openModalShell scroll region", () => {
  test("scrollHost names the shell's one scroll region", () => {
    const shell = openModalShell();
    // Identical to bodyEl today; the field exists so consumers can say what
    // they mean instead of knowing .cmp-body happens to be the scroller.
    expect(shell.scrollHost).toBe(shell.bodyEl);
    expect(shell.scrollHost.classList.contains("cmp-body")).toBe(true);
  });

  test("getScrollTop tracks the body while attached", () => {
    const shell = openModalShell();
    expect(shell.getScrollTop()).toBe(0);
    scrollTo(shell.bodyEl, 640);
    expect(shell.getScrollTop()).toBe(640);
  });

  test("getScrollTop survives the detach that happens before onClose", () => {
    // The defect this exists for: the shell removes the dialog and THEN calls
    // onClose, so a consumer remembering the offset there reads a detached
    // element. Measured in Chromium: parked at 31185, scrollTop read 0.
    let atClose = -1;
    let rawAtClose = -1;
    const shell = openModalShell({
      onClose: () => {
        atClose = shellRef.getScrollTop();
        rawAtClose = shellRef.bodyEl.scrollTop;
      },
    });
    const shellRef = shell;
    scrollTo(shell.bodyEl, 31185);

    // Simulate what a real engine does to a detached element's scrollTop.
    const realRemove = shell.dialog.remove.bind(shell.dialog);
    shell.dialog.remove = () => {
      realRemove();
      Object.defineProperty(shell.bodyEl, "scrollTop", {
        value: 0,
        writable: true,
        configurable: true,
      });
    };

    shell.close();
    expect(shell.bodyEl.isConnected).toBe(false);
    expect(rawAtClose).toBe(0); // the obvious one-liner loses the offset
    expect(atClose).toBe(31185); // the mirror does not
  });

  test("a programmatic write is picked up even before its scroll event lands", () => {
    // scroll events fire at the frame's rendering step, after the input that
    // caused them — so while attached, getScrollTop re-reads rather than
    // trusting a mirror that can lag by a frame.
    const shell = openModalShell();
    Object.defineProperty(shell.bodyEl, "scrollTop", {
      value: 900,
      writable: true,
      configurable: true,
    });
    expect(shell.getScrollTop()).toBe(900);
  });
});
