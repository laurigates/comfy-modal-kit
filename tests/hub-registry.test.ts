// hub-registry.test.ts — the Touch Tools hub registry and the button election.
//
// Node env by design: everything asserted here is data on the shared runtime
// rendezvous, not DOM. The chooser's DOM lives in hub-chooser.test.ts (jsdom).
//
// Reading getKit() directly from a test is the established precedent for
// asserting rendezvous state — see tests/modal-coordinator.test.ts:257.

import { beforeEach, describe, expect, test, vi } from "vitest";
import { installHubButton, makeHubEntry } from "../src/hub.js";
import { getHubEntries, type HubEntry, registerHubEntry } from "../src/hub-registry.js";
import { getKit } from "../src/kit-global.js";

const entry = (id: string, priority?: number, open: () => void = () => {}): HubEntry => ({
  id,
  label: id,
  icon: "pi pi-cog",
  ...(priority === undefined ? {} : { priority }),
  open,
});

beforeEach(() => {
  getKit().hubEntries.length = 0;
  getKit().hubLauncherInstalled = false;
});

describe("registerHubEntry / getHubEntries", () => {
  test("registers an entry", () => {
    registerHubEntry(entry("a.open"));
    expect(getHubEntries().map((e) => e.id)).toEqual(["a.open"]);
  });

  test("re-registering an id replaces in place rather than appending", () => {
    const first = entry("a.open");
    const second = { ...entry("a.open"), label: "Second" };
    registerHubEntry(first);
    registerHubEntry(entry("b.open"));
    registerHubEntry(second);

    const ids = getHubEntries().map((e) => e.id);
    expect(ids).toEqual(["a.open", "b.open"]); // length 1 per id, order preserved
    expect(getHubEntries().find((e) => e.id === "a.open")?.label).toBe("Second");
  });

  test("orders by priority descending", () => {
    registerHubEntry(entry("low.open", 1));
    registerHubEntry(entry("high.open", 10));
    registerHubEntry(entry("mid.open", 5));
    expect(getHubEntries().map((e) => e.id)).toEqual(["high.open", "mid.open", "low.open"]);
  });

  test("equal priority keeps registration order (stable sort)", () => {
    registerHubEntry(entry("first.open", 5));
    registerHubEntry(entry("second.open", 5));
    registerHubEntry(entry("third.open", 5));
    expect(getHubEntries().map((e) => e.id)).toEqual(["first.open", "second.open", "third.open"]);
  });

  test("an empty registry returns an empty list", () => {
    expect(getHubEntries()).toEqual([]);
  });

  test("ADR-0003 pin: a rendezvous built by an older kit copy is backfilled, not crashed", () => {
    // Whichever pack's inlined copy loads FIRST constructs the rendezvous, and
    // an older copy's constructor has no `hubEntries` field. Without the
    // backfill in kit-global.ts this is `undefined.findIndex` — the exact
    // ADR-0003 crash.
    delete (getKit() as unknown as { hubEntries?: HubEntry[] }).hubEntries;
    expect(() => registerHubEntry(entry("a.open"))).not.toThrow();
    expect(getHubEntries().map((e) => e.id)).toEqual(["a.open"]);
  });
});

describe("installHubButton", () => {
  test("the first caller gets the one button; every later caller gets nothing", () => {
    const first = installHubButton();
    expect(first.actionBarButtons).toHaveLength(1);
    expect(getKit().hubLauncherInstalled).toBe(true);

    const second = installHubButton();
    expect(second.actionBarButtons).toBeUndefined();
    expect(Object.keys(second)).toEqual([]);
  });

  test("key-disjointness: returns actionBarButtons ONLY, never commands/menuCommands", () => {
    // The objection-C guard. If this function also returned `commands` or
    // `menuCommands`, a pack spreading `...entry, ...installHubButton()` would
    // have those keys clobbered by the later spread: the Extensions-menu row
    // vanishes (menuItemStore.ts:90-97 filters menuCommand.commands against
    // extension.commands ids) and a user keybinding on the orphaned id is
    // re-added at boot with no isRegistered gate (keybindingService.ts:116-124),
    // squatting its combo and throwing on press (commandStore.ts:110).
    const keys = Object.keys(installHubButton());
    expect(keys).toEqual(["actionBarButtons"]);
    expect(keys).not.toContain("commands");
    expect(keys).not.toContain("menuCommands");
  });

  test("the button carries the !important size override the topbar requires", () => {
    // Plain `h-11` is stripped by tailwind-merge against the component's
    // hard-coded `h-7 rounded-full` (ActionBarButtons.vue:14); only the
    // !important form survives the merge and wins the cascade.
    expect(installHubButton().actionBarButtons?.[0]?.class).toBe("!h-11 !min-w-11");
  });
});

describe("makeHubEntry", () => {
  test("emits command + menu entry but NO action-bar button", () => {
    const open = vi.fn();
    const built = makeHubEntry({
      id: "image-browser.open",
      label: "Image Browser",
      icon: "pi pi-images",
      description: "Browse & manage input/output images",
      priority: 10,
      open,
    });

    expect(built.actionBarButtons).toBeUndefined();
    expect(built.commands.map((c) => c.id)).toEqual(["image-browser.open"]);
    expect(built.menuCommands[0]?.commands).toEqual(["image-browser.open"]);
    expect(built.hubEntry).toMatchObject({
      id: "image-browser.open",
      label: "Image Browser",
      icon: "pi pi-images",
      description: "Browse & manage input/output images",
      priority: 10,
    });

    built.hubEntry.open();
    expect(open).toHaveBeenCalledTimes(1);
  });

  test("hubEntry.open shares the launcher's guard: a throwing opener is swallowed", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const built = makeHubEntry({
      id: "a.open",
      label: "A",
      icon: "pi pi-cog",
      open: () => {
        throw new Error("boom");
      },
    });
    expect(() => built.hubEntry.open()).not.toThrow();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
