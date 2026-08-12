// @vitest-environment jsdom
//
// hub-toggle.test.ts — the chooser's toggle rows, and the two contracts that
// make them a separate registry rather than a kind of HubEntry.
//
// WHAT THIS TIER CANNOT ASSERT: that the flipped row is legible as "On"/"Off"
// at a glance on a phone, and the real hit-box of the row. jsdom performs no
// layout — both belong to the live-smoke tier.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { installHubButton, openTouchToolsHub } from "../src/hub.js";
import {
  getHubEntries,
  type HubEntry,
  type HubToggle,
  registerHubEntry,
  registerHubToggle,
} from "../src/hub-registry.js";
import { getKit } from "../src/kit-global.js";
import { closeModalShell } from "../src/modal-shell.js";

const entry = (id: string, open: () => void = () => {}): HubEntry => ({
  id,
  label: id,
  icon: "pi pi-cog",
  open,
});

/** A toggle backed by a plain local boolean. */
function stubToggle(id: string, initial = false): HubToggle & { value: boolean } {
  const t = {
    id,
    label: id,
    icon: "pi pi-eye",
    description: `${id} description`,
    value: initial,
    get: () => t.value,
    set: (next: boolean) => {
      t.value = next;
    },
  };
  return t;
}

const rows = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>(".cmk-hub-row"));

const rowByLabel = (label: string): HTMLButtonElement => {
  const found = rows().find((r) => r.querySelector(".cmk-hub-label")?.textContent === label);
  if (!found) throw new Error(`no chooser row labelled "${label}"`);
  return found;
};

let pushSpy: ReturnType<typeof vi.spyOn>;
let backSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getKit().hubEntries.length = 0;
  getKit().hubToggles.length = 0;
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
  expect(pushSpy).toBeDefined();
  expect(backSpy).toBeDefined();
});

describe("registry separation", () => {
  test("a toggle does NOT appear in getHubEntries()", () => {
    registerHubEntry(entry("image-browser.open"));
    registerHubToggle(stubToggle("safe-view.toggle"));
    expect(getHubEntries().map((e) => e.id)).toEqual(["image-browser.open"]);
  });

  test("a toggle does NOT cost a single-pack user their one-tap launch", () => {
    // THE REGRESSION THIS SPLIT EXISTS FOR. `installHubButton`'s short-circuit
    // opens the lone registered tool directly instead of showing a one-row
    // menu. Registering Safe View as an ordinary HubEntry would make
    // `entries.length === 2` and silently take that tap back from every user
    // with exactly one pack installed.
    const opened: string[] = [];
    registerHubEntry(entry("image-browser.open", () => opened.push("image-browser")));
    registerHubToggle(stubToggle("safe-view.toggle"));

    const fields = installHubButton();
    fields.actionBarButtons?.[0]?.onClick();

    expect(opened).toEqual(["image-browser"]);
    // The chooser must not have opened at all.
    expect(rows()).toHaveLength(0);
  });

  test("re-registering the same toggle id replaces it rather than duplicating", () => {
    // Both gallery packs call registerSafeViewHubToggle() blindly; a second
    // registration must not put a second Safe View row in the chooser.
    registerHubToggle(stubToggle("safe-view.toggle"));
    registerHubToggle(stubToggle("safe-view.toggle"));
    registerHubEntry(entry("a.open"));
    registerHubEntry(entry("b.open"));
    openTouchToolsHub();
    expect(rows().filter((r) => r.getAttribute("role") === "switch")).toHaveLength(1);
  });

  test("toggles sort by priority, descending", () => {
    registerHubEntry(entry("a.open"));
    registerHubEntry(entry("b.open"));
    registerHubToggle({ ...stubToggle("low"), priority: 1 });
    registerHubToggle({ ...stubToggle("high"), priority: 10 });
    openTouchToolsHub();
    const switches = rows().filter((r) => r.getAttribute("role") === "switch");
    expect(switches.map((r) => r.querySelector(".cmk-hub-label")?.textContent)).toEqual([
      "high",
      "low",
    ]);
  });
});

describe("toggle rows in the chooser", () => {
  beforeEach(() => {
    // Two entries, so the single-entry short-circuit never fires and the
    // chooser genuinely opens.
    registerHubEntry(entry("a.open"));
    registerHubEntry(entry("b.open"));
  });

  test("renders below the tool rows", () => {
    registerHubToggle(stubToggle("safe-view.toggle"));
    openTouchToolsHub();
    const labels = rows().map((r) => r.querySelector(".cmk-hub-label")?.textContent);
    expect(labels.indexOf("safe-view.toggle")).toBeGreaterThan(labels.indexOf("b.open"));
    // ...and still above the trailing Settings row.
    expect(labels.indexOf("safe-view.toggle")).toBeLessThan(labels.indexOf("Settings"));
  });

  test("paints its CURRENT state on open, read at render time", () => {
    const t = stubToggle("safe-view.toggle", true);
    registerHubToggle(t);
    openTouchToolsHub();
    const row = rowByLabel("safe-view.toggle");
    expect(row.getAttribute("aria-checked")).toBe("true");
    expect(row.querySelector(".cmk-hub-state")?.textContent).toBe("On");
  });

  test("a tap flips the value and repaints IN PLACE — same node, chooser still up", () => {
    // Node IDENTITY, not a count. A rebuilt chooser also yields exactly one row
    // with the right label, so `toHaveLength(1)` passes whether the row
    // repaints in place or the whole modal is torn down and remounted — which
    // is precisely the difference the user feels.
    const t = stubToggle("safe-view.toggle", false);
    registerHubToggle(t);
    openTouchToolsHub();

    const row = rowByLabel("safe-view.toggle");
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(t.value).toBe(true);
    expect(rowByLabel("safe-view.toggle")).toBe(row);
    expect(row.getAttribute("aria-checked")).toBe("true");
    expect(row.querySelector(".cmk-hub-state")?.textContent).toBe("On");
    // The chooser did NOT close — the close-before-act rule is for rows that
    // OPEN something, and a toggle opens nothing.
    expect(document.querySelector(".cmp-dialog")).not.toBeNull();
  });

  test("flipping twice returns to the original state", () => {
    const t = stubToggle("safe-view.toggle", false);
    registerHubToggle(t);
    openTouchToolsHub();
    const row = rowByLabel("safe-view.toggle");
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(t.value).toBe(false);
    expect(row.getAttribute("aria-checked")).toBe("false");
  });

  test("repaints from get(), so a REJECTED write shows as unchanged", () => {
    // The value round-trips through ComfyUI's setting store, which may coerce
    // or refuse it. Painting `!previous` optimistically would show the user a
    // flip that did not happen.
    const stubborn: HubToggle = {
      id: "stubborn.toggle",
      label: "stubborn",
      icon: "pi pi-lock",
      get: () => false,
      set: () => {
        /* refuses every write */
      },
    };
    registerHubToggle(stubborn);
    openTouchToolsHub();
    const row = rowByLabel("stubborn");
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(row.getAttribute("aria-checked")).toBe("false");
    expect(row.querySelector(".cmk-hub-state")?.textContent).toBe("Off");
  });

  test("a throwing set() surfaces an error and leaves the chooser usable", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const boom: HubToggle = {
      id: "boom.toggle",
      label: "boom",
      icon: "pi pi-times",
      get: () => false,
      set: () => {
        throw new Error("nope");
      },
    };
    registerHubToggle(boom);
    openTouchToolsHub();
    const row = rowByLabel("boom");
    row.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(err).toHaveBeenCalled();
    expect(document.querySelector(".cmp-dialog")).not.toBeNull();
    err.mockRestore();
  });

  test("is announced as a switch, not as a plain button", () => {
    registerHubToggle(stubToggle("safe-view.toggle"));
    openTouchToolsHub();
    const row = rowByLabel("safe-view.toggle");
    expect(row.getAttribute("role")).toBe("switch");
    expect(row.getAttribute("aria-checked")).toBe("false");
  });
});
