// launcher.test.ts — coverage for makeLauncher / FAMILY_MENU_PATH. Field
// building is pure; the safe-open failure path raises a notify() toast, so
// this file runs under jsdom.
//
// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";

import { FAMILY_MENU_PATH, makeLauncher } from "../src/launcher.js";

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
  vi.restoreAllMocks();
});

describe("makeLauncher", () => {
  test("builds command, menu entry, and action-bar button from one declaration", () => {
    const open = vi.fn();
    const fields = makeLauncher({
      id: "image-browser.open",
      label: "Image Browser",
      icon: "pi pi-images",
      tooltip: "Browse & manage images",
      open,
    });

    expect(fields.commands).toEqual([
      {
        id: "image-browser.open",
        label: "Image Browser",
        icon: "pi pi-images",
        function: expect.any(Function),
      },
    ]);
    expect(fields.menuCommands).toEqual([
      { path: [...FAMILY_MENU_PATH], commands: ["image-browser.open"] },
    ]);
    expect(fields.actionBarButtons).toEqual([
      { icon: "pi pi-images", tooltip: "Browse & manage images", onClick: expect.any(Function) },
    ]);

    fields.commands[0]?.function();
    fields.actionBarButtons?.[0]?.onClick();
    expect(open).toHaveBeenCalledTimes(2);
  });

  test("defaults: FAMILY_MENU_PATH placement and label as tooltip", () => {
    const fields = makeLauncher({ id: "a.open", label: "A", icon: "pi pi-cog", open: () => {} });
    expect(fields.menuCommands[0]?.path).toEqual(["Extensions", "Touch Tools"]);
    expect(fields.actionBarButtons?.[0]?.tooltip).toBe("A");
  });

  test("menuPath override applies and is copied (not aliased)", () => {
    const path = ["Extensions", "Elsewhere"];
    const fields = makeLauncher({
      id: "a.open",
      label: "A",
      icon: "i",
      open: () => {},
      menuPath: path,
    });
    expect(fields.menuCommands[0]?.path).toEqual(path);
    expect(fields.menuCommands[0]?.path).not.toBe(path);
  });

  test("actionBar:false omits the button; object form overrides label/tooltip", () => {
    const none = makeLauncher({
      id: "a.open",
      label: "A",
      icon: "i",
      open: () => {},
      actionBar: false,
    });
    expect(none.actionBarButtons).toBeUndefined();

    const custom = makeLauncher({
      id: "a.open",
      label: "A",
      icon: "i",
      open: () => {},
      actionBar: { label: "Bar label", tooltip: "Bar tip" },
    });
    expect(custom.actionBarButtons?.[0]).toMatchObject({ label: "Bar label", tooltip: "Bar tip" });
  });

  test("safe-open: a throwing opener does not propagate and raises an error toast", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const fields = makeLauncher({
      id: "a.open",
      label: "A",
      icon: "i",
      failSummary: "Could not open A",
      open: () => {
        throw new Error("boom");
      },
    });
    expect(() => fields.commands[0]?.function()).not.toThrow();
    expect(err).toHaveBeenCalled();
    const toast = document.querySelector(".cmn-toast, [class^='cmn-']");
    expect(toast).not.toBeNull();
    expect(document.body.textContent).toContain("Could not open A");
  });

  test("non-kebab command id warns but still builds", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fields = makeLauncher({
      id: "TouchManager.Open",
      label: "T",
      icon: "i",
      open: () => {},
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("TouchManager.Open"));
    expect(fields.commands[0]?.id).toBe("TouchManager.Open");
    warn.mockRestore();
  });

  test("conforming kebab ids do not warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    makeLauncher({ id: "touch-shim.dock-actionbar", label: "T", icon: "i", open: () => {} });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
