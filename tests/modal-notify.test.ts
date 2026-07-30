// modal-notify.test.ts — coverage for the notify() primitive.
//
// Pure helpers run in the default node env. The DOM/clipboard behaviour runs
// under jsdom via the per-file environment annotation below, so the rest of
// the kit's suite stays DOM-free.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  dismissActiveModal,
  installPointerGuard,
  isModalActive,
  isModalChrome,
  setActiveModal,
} from "../src/modal-coordinator.js";
import {
  copyTextToClipboard,
  defaultCopyable,
  defaultLife,
  notify,
  notifyClipboardText,
} from "../src/modal-notify.js";

describe("pure helpers", () => {
  test("defaultLife: errors are sticky, warns linger, rest auto-dismiss", () => {
    expect(defaultLife("error")).toBe(0);
    expect(defaultLife("warn")).toBe(8000);
    expect(defaultLife("info")).toBe(4000);
    expect(defaultLife("success")).toBe(4000);
  });

  test("defaultCopyable: only warn/error get a copy button", () => {
    expect(defaultCopyable("error")).toBe(true);
    expect(defaultCopyable("warn")).toBe(true);
    expect(defaultCopyable("info")).toBe(false);
    expect(defaultCopyable("success")).toBe(false);
  });

  test("notifyClipboardText joins summary and detail with a newline", () => {
    expect(notifyClipboardText("Boom")).toBe("Boom");
    expect(notifyClipboardText("Boom", "stack trace")).toBe("Boom\nstack trace");
  });
});

describe("copyTextToClipboard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  test("uses the async Clipboard API when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyTextToClipboard("hello")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("hello");
  });

  test("falls back to execCommand when Clipboard API is absent", async () => {
    vi.stubGlobal("navigator", {}); // no clipboard (insecure context)
    const exec = vi.fn().mockReturnValue(true);
    // jsdom doesn't implement execCommand; provide it.
    (document as unknown as { execCommand: typeof exec }).execCommand = exec;
    expect(await copyTextToClipboard("hello")).toBe(true);
    expect(exec).toHaveBeenCalledWith("copy");
  });
});

describe("notify() DOM", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("renders summary, detail, and a Copy button for errors", () => {
    const ctl = notify({ severity: "error", summary: "Install failed", detail: "boom (E_CLONE)" });
    expect(ctl).not.toBeNull();
    const toast = document.querySelector(".cmn-toast.cmn-error");
    expect(toast).not.toBeNull();
    expect(toast?.querySelector(".cmn-summary")?.textContent).toBe("Install failed");
    expect(toast?.querySelector(".cmn-detail")?.textContent).toBe("boom (E_CLONE)");
    expect(toast?.querySelector(".cmn-copy")).not.toBeNull();
  });

  test("success toasts have no Copy button", () => {
    notify({ severity: "success", summary: "Done" });
    expect(document.querySelector(".cmn-copy")).toBeNull();
  });

  test("Copy button writes summary+detail to the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    notify({ severity: "error", summary: "Boom", detail: "trace" });
    const copyBtn = document.querySelector<HTMLButtonElement>(".cmn-copy");
    copyBtn?.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("Boom\ntrace"));
    vi.unstubAllGlobals();
  });

  test("close() removes the toast and the container empties", () => {
    const ctl = notify({ severity: "error", summary: "x" });
    expect(document.querySelector(".cmn-toast")).not.toBeNull();
    ctl?.close();
    expect(document.querySelector(".cmn-toast")).toBeNull();
    expect(document.getElementById("cmn-notify-container")).toBeNull();
  });

  test("non-sticky toasts auto-dismiss after their life", () => {
    vi.useFakeTimers();
    notify({ severity: "info", summary: "hi", life: 1000 });
    expect(document.querySelector(".cmn-toast")).not.toBeNull();
    vi.advanceTimersByTime(1000);
    expect(document.querySelector(".cmn-toast")).toBeNull();
  });

  test("error toasts are sticky (no auto-dismiss)", () => {
    vi.useFakeTimers();
    notify({ severity: "error", summary: "stays" });
    vi.advanceTimersByTime(60000);
    expect(document.querySelector(".cmn-toast")).not.toBeNull();
  });
});

describe("toast vs active modal", () => {
  let dialog: HTMLElement;
  let close: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    dismissActiveModal(); // clear anything a prior test left active
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    installPointerGuard();
    dialog = document.createElement("div");
    document.body.appendChild(dialog);
    close = vi.fn();
  });

  afterEach(() => {
    dismissActiveModal();
  });

  test("tapping a toast's × dismisses the toast, NOT the modal (regression)", () => {
    setActiveModal({ element: dialog, close });
    notify({ severity: "error", summary: "x" });
    const closeBtn = document.querySelector<HTMLButtonElement>(".cmn-close");
    expect(closeBtn).not.toBeNull();

    // The bug in full: the toast stack is a body-level sibling of the dialog, so
    // the coordinator's window guard read this pointerdown as "outside the
    // modal" and dismissed the modal out from under the tap. jsdom's click()
    // does not synthesize a pointerdown, so both events must be dispatched —
    // that ordering IS the bug.
    closeBtn?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(close).not.toHaveBeenCalled();
    expect(isModalActive()).toBe(true);

    closeBtn?.click();
    expect(document.querySelector(".cmn-toast")).toBeNull();
    expect(isModalActive()).toBe(true);
  });

  test("cmn-modal-inset is re-evaluated on every raise", () => {
    const id = "cmn-notify-container";
    notify({ severity: "info", summary: "no modal" });
    expect(document.getElementById(id)?.classList.contains("cmn-modal-inset")).toBe(false);

    setActiveModal({ element: dialog, close });
    notify({ severity: "info", summary: "modal up" });
    expect(document.getElementById(id)?.classList.contains("cmn-modal-inset")).toBe(true);

    dismissActiveModal();
    notify({ severity: "info", summary: "modal gone" });
    expect(document.getElementById(id)?.classList.contains("cmn-modal-inset")).toBe(false);
  });

  test("the container registers as chrome and unregisters when it is removed", () => {
    const ctl = notify({ severity: "error", summary: "x" });
    const container = document.getElementById("cmn-notify-container");
    expect(container?.hasAttribute("data-cmp-chrome")).toBe(true);
    expect(isModalChrome(container)).toBe(true);

    ctl?.close();
    // The registry must not retain the detached container.
    expect(document.getElementById("cmn-notify-container")).toBeNull();
    expect(isModalChrome(container)).toBe(false);

    // A fresh raise builds and re-registers a new container.
    notify({ severity: "error", summary: "again" });
    expect(isModalChrome(document.getElementById("cmn-notify-container"))).toBe(true);
  });

  test("a container it did not create is still adopted as chrome (regression)", () => {
    // Registering only on the create branch left one realistic hole: an inlined
    // kit copy old enough to predate the chrome registry (<= 0.8.0) appends the
    // container without registering it. A pack on that copy raising a load-time
    // toast — never opening a shell, so never installing its own guard — leaves
    // exactly this DOM behind, and THIS copy's guard is then the only listener.
    const stale = document.createElement("div");
    stale.id = "cmn-notify-container";
    stale.className = "cmn-container";
    document.body.appendChild(stale);
    expect(stale.hasAttribute("data-cmp-chrome")).toBe(false);
    expect(isModalChrome(stale)).toBe(false);

    setActiveModal({ element: dialog, close });
    notify({ severity: "error", summary: "x" });

    // The adopted container, not a second one.
    expect(document.getElementById("cmn-notify-container")).toBe(stale);
    expect(stale.hasAttribute("data-cmp-chrome")).toBe(true);
    expect(isModalChrome(stale)).toBe(true);

    const closeBtn = stale.querySelector<HTMLButtonElement>(".cmn-close");
    expect(closeBtn).not.toBeNull();
    closeBtn?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(close).not.toHaveBeenCalled();
    expect(isModalActive()).toBe(true);
  });
});
