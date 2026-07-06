// widget-button.test.ts — coverage for the Strategy-B button-widget helper.
// Pure object manipulation; runs in the default node env.

import { describe, expect, test, vi } from "vitest";

import { appendButtonWidget, type ButtonWidgetHost } from "../src/widget-button.js";

interface FakeWidget {
  label: string;
  serialize?: boolean;
  options?: { serialize: boolean };
  callback?: () => void;
}

function fakeNode(existing: FakeWidget[] = []): ButtonWidgetHost & {
  widgets: FakeWidget[];
  dirtyCalls: Array<[boolean, boolean]>;
} {
  const node = {
    widgets: [...existing],
    dirtyCalls: [] as Array<[boolean, boolean]>,
    addWidget(
      _type: "button",
      label: string,
      _value: null,
      callback: () => void,
      options: { serialize: boolean },
    ) {
      const w: FakeWidget = { label, options, callback };
      node.widgets.push(w);
      return w;
    },
    setDirtyCanvas(fg: boolean, bg: boolean) {
      node.dirtyCalls.push([fg, bg]);
    },
  };
  return node;
}

describe("appendButtonWidget", () => {
  test("adds a button with serialize:false in options AND on the widget", () => {
    const node = fakeNode();
    appendButtonWidget(node, "📁 Browse", () => {});
    expect(node.widgets).toHaveLength(1);
    const btn = node.widgets[0];
    expect(btn?.label).toBe("📁 Browse");
    expect(btn?.options?.serialize).toBe(false);
    expect(btn?.serialize).toBe(false);
  });

  test("moves the button to the end if addWidget did not append it last", () => {
    const real: FakeWidget = { label: "seed" };
    const node = fakeNode([real]);
    // Simulate an addWidget that inserts at the front.
    node.addWidget = (_type, label, _value, callback, options) => {
      const w: FakeWidget = { label, options, callback };
      node.widgets.unshift(w);
      return w;
    };
    appendButtonWidget(node, "⤢ Edit", () => {});
    expect(node.widgets.map((w) => w.label)).toEqual(["seed", "⤢ Edit"]);
  });

  test("marks the canvas dirty", () => {
    const node = fakeNode();
    appendButtonWidget(node, "b", () => {});
    expect(node.dirtyCalls).toEqual([[true, true]]);
  });

  test("a throwing onClick is swallowed with a warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const node = fakeNode();
    appendButtonWidget(
      node,
      "b",
      () => {
        throw new Error("boom");
      },
      { logPrefix: "test-pack" },
    );
    expect(() => node.widgets[0]?.callback?.()).not.toThrow();
    expect(warn).toHaveBeenCalledWith("[test-pack] open from button failed", expect.any(Error));
    warn.mockRestore();
  });

  test("a throwing addWidget is swallowed with a warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const node: ButtonWidgetHost = {
      addWidget() {
        throw new Error("no widgets here");
      },
    };
    expect(() => appendButtonWidget(node, "b", () => {})).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "[comfy-modal-kit] addWidget(button) failed",
      expect.any(Error),
    );
    warn.mockRestore();
  });

  test("a node without addWidget is a no-op", () => {
    expect(() => appendButtonWidget({}, "b", () => {})).not.toThrow();
  });
});
