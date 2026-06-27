// modal-notify.test.ts — coverage for the notify() primitive.
//
// Pure helpers run in the default node env. The DOM/clipboard behaviour runs
// under jsdom via the per-file environment annotation below, so the rest of
// the kit's suite stays DOM-free.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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
