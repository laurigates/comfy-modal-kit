// @vitest-environment jsdom
//
// hub-chooser.test.ts — the Touch Tools chooser's DOM, wiring, and the
// close-before-act contract.
//
// WHAT THIS TIER CANNOT ASSERT (all of it belongs to the real-browser tier,
// `comfyui-plugin:comfyui-pack-live-smoke` on the GPU box):
//
//   - Real hit-box sizes. `min-height: 48px` below IS the resolved cascade, but
//     jsdom performs no layout, so the RENDERED height of a row and of the
//     action-bar button (the `!h-11` override against ActionBarButtons.vue's
//     hard-coded `h-7`) are unmeasurable here.
//   - The dialog's width. It is set inline from the `min(420px, calc(100vw -
//     24px))` option, and jsdom drops any value containing min()/calc() — a
//     probe of this exact string returns "auto". Asserting it would report the
//     harness, not the code.
//   - Whether ComfyUI's native settings dialog is actually VISIBLE after the
//     Settings row runs. This file proves our own scrim is gone at the instant
//     the action fires (the z-index fix); that the PrimeVue dialog then paints
//     at z-1800 with nothing over it is browser-tier.
//   - safe-area insets, the soft keyboard, and whether the `pi pi-mobile` glyph
//     paints from the loaded icon font.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installHubButton, openTouchToolsHub } from "../src/hub.js";
import { type HubEntry, registerHubEntry } from "../src/hub-registry.js";
import { getKit } from "../src/kit-global.js";
import { closeModalShell } from "../src/modal-shell.js";

const entry = (id: string, open: () => void = () => {}): HubEntry => ({
  id,
  label: id,
  icon: "pi pi-cog",
  description: `${id} description`,
  open,
});

/** Chooser rows only — excludes the shell's own ✕ button. */
const rows = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".cmk-hub-row"));

const labelsOf = (els: HTMLElement[]): (string | null)[] =>
  els.map((el) => el.querySelector(".cmk-hub-label")?.textContent ?? null);

let pushSpy: ReturnType<typeof vi.spyOn>;
let backSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getKit().hubEntries.length = 0;
  getKit().hubLauncherInstalled = false;
  pushSpy = vi.spyOn(history, "pushState").mockImplementation(() => {});
  backSpy = vi.spyOn(history, "back").mockImplementation(() => {});
});

afterEach(() => {
  closeModalShell();
  vi.useRealTimers();
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("openTouchToolsHub — contents", () => {
  test("renders one row per registered entry, plus a Settings row", () => {
    registerHubEntry(entry("image-browser.open"));
    registerHubEntry(entry("touch-manager.open"));
    openTouchToolsHub();

    expect(labelsOf(rows())).toEqual(["image-browser.open", "touch-manager.open", "Settings"]);
    expect(document.querySelector(".cmk-hub-empty")).toBeNull();
    expect(document.querySelector(".cmk-hub-note")?.textContent).toContain(
      "work directly on the canvas",
    );
  });

  test("an empty registry still renders the Settings row AND the empty-state line", () => {
    openTouchToolsHub();
    expect(labelsOf(rows())).toEqual(["Settings"]);
    expect(document.querySelector(".cmk-hub-empty")?.textContent).toBe(
      "No Touch Tools packs registered on this page yet.",
    );
  });

  test("rows resolve to a >=44px min-height through the injected stylesheet", () => {
    // getComputedStyle, never el.style: the declaration lives in the
    // ensureStyleOnce sheet, so an inline-style read would be vacuous. jsdom
    // does resolve plain-valued class rules — probed on this exact property.
    registerHubEntry(entry("a.open"));
    openTouchToolsHub();
    const row = rows()[0];
    expect(row).toBeDefined();
    const min = Number.parseInt(getComputedStyle(row as HTMLElement).minHeight, 10);
    expect(min).toBeGreaterThanOrEqual(44);
  });
});

describe("openTouchToolsHub — row activation", () => {
  test("clicking a row invokes that entry's open exactly once, on the next macrotask", () => {
    vi.useFakeTimers();
    const open = vi.fn();
    const other = vi.fn();
    registerHubEntry(entry("a.open", open));
    registerHubEntry(entry("b.open", other));
    openTouchToolsHub();

    // Dispatch on the row element — where a real tap lands. An event dispatched
    // at `document` would never reach a handler bound to the row.
    rows()[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(open).not.toHaveBeenCalled(); // deferred by one macrotask

    vi.advanceTimersByTime(0);
    expect(open).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });

  test("CLOSE-BEFORE-ACT: the chooser is fully detached before the action runs", () => {
    // THE LOAD-BEARING CASE. The kit's backdrop is z-9998 / dialog z-9999
    // (modal-shell.ts:37,46); PrimeVue is configured modal:1800 / overlay:1800
    // (main.ts:114-118) over MODAL_BASE_Z_INDEX = 1700
    // (useModalLiftedZIndex.ts:6). Both are fixed children of <body>. If the
    // chooser were still up when a row acted, ComfyUI's settings dialog would
    // open BEHIND our scrim and the tap would look like it did nothing.
    // Without this assertion the Settings row ships dead and silent.
    vi.useFakeTimers();
    let backdropAtAction: Element | null | undefined;
    let dialogAtAction: Element | null | undefined;
    const open = vi.fn(() => {
      backdropAtAction = document.querySelector(".cmp-backdrop");
      dialogAtAction = document.querySelector(".cmp-dialog");
    });
    registerHubEntry(entry("a.open", open));
    openTouchToolsHub();

    rows()[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    vi.advanceTimersByTime(0);

    expect(open).toHaveBeenCalledTimes(1);
    expect(backdropAtAction).toBeNull();
    expect(dialogAtAction).toBeNull();
  });

  test("a row whose open throws does not propagate, and logs", () => {
    vi.useFakeTimers();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    registerHubEntry(
      entry("a.open", () => {
        throw new Error("boom");
      }),
    );
    openTouchToolsHub();

    rows()[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(() => vi.advanceTimersByTime(0)).not.toThrow();
    expect(err).toHaveBeenCalled();
  });

  test("the Settings row executes Comfy.ShowSettingsDialog", () => {
    vi.useFakeTimers();
    const execute = vi.fn();
    vi.stubGlobal("app", { extensionManager: { command: { execute } } });
    openTouchToolsHub();

    const settings = rows().at(-1);
    expect(settings?.querySelector(".cmk-hub-label")?.textContent).toBe("Settings");
    settings?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    vi.advanceTimersByTime(0);

    expect(execute).toHaveBeenCalledWith("Comfy.ShowSettingsDialog");
  });
});

describe("installHubButton — the button's click behaviour", () => {
  test("single-entry short-circuit: one tool opens directly, two open the chooser", () => {
    const only = vi.fn();
    registerHubEntry(entry("a.open", only));
    const onClick = installHubButton().actionBarButtons?.[0]?.onClick;
    expect(onClick).toBeTypeOf("function");

    onClick?.();
    expect(only).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".cmp-dialog")).toBeNull(); // no chooser at all

    registerHubEntry(entry("b.open"));
    onClick?.();
    expect(only).toHaveBeenCalledTimes(1); // not re-opened
    expect(document.querySelectorAll(".cmp-dialog")).toHaveLength(1);
    expect(labelsOf(rows())).toEqual(["a.open", "b.open", "Settings"]);
  });
});

describe("openTouchToolsHub — back guard", () => {
  test("arms a sentinel on open", () => {
    openTouchToolsHub();
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy.mock.calls[0]?.[0]).toEqual({ cmpBackGuard: true });
  });

  test("the row hand-off disposes WITHOUT popping; the ✕ path pops", () => {
    // Popping on hand-off would queue a traversal that could land after the
    // next modal's own pushState and eat its sentinel. One inert history entry
    // is strictly safer than that race.
    vi.useFakeTimers();
    registerHubEntry(entry("a.open"));
    openTouchToolsHub();
    rows()[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    vi.advanceTimersByTime(0);
    expect(backSpy).not.toHaveBeenCalled();

    // Fresh chooser, dismissed via the shell's own close button.
    openTouchToolsHub();
    const close = document.querySelector<HTMLButtonElement>(".cmp-close");
    expect(close).not.toBeNull();
    close?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(backSpy).toHaveBeenCalledTimes(1);
  });
});
