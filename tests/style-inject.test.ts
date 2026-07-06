// style-inject.test.ts — coverage for ensureStyleOnce. DOM behaviour runs
// under jsdom (per-file annotation); the no-document path is exercised by
// stubbing `document` away.
//
// @vitest-environment jsdom

import { afterEach, describe, expect, test, vi } from "vitest";

import { ensureStyleOnce } from "../src/style-inject.js";

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
});

describe("ensureStyleOnce", () => {
  test("injects a style element with the given id and css", () => {
    ensureStyleOnce("test-style", ".a { color: red; }");
    const el = document.getElementById("test-style");
    expect(el).toBeInstanceOf(HTMLStyleElement);
    expect(el?.textContent).toBe(".a { color: red; }");
  });

  test("second call with the same id is a no-op (first css wins)", () => {
    ensureStyleOnce("test-style", ".a {}");
    ensureStyleOnce("test-style", ".b {}");
    const els = document.querySelectorAll("#test-style");
    expect(els).toHaveLength(1);
    expect(els[0]?.textContent).toBe(".a {}");
  });

  test("distinct ids both inject", () => {
    ensureStyleOnce("style-one", ".a {}");
    ensureStyleOnce("style-two", ".b {}");
    expect(document.getElementById("style-one")).not.toBeNull();
    expect(document.getElementById("style-two")).not.toBeNull();
  });

  test("no document (node / SSR): does not throw", () => {
    vi.stubGlobal("document", undefined);
    expect(() => ensureStyleOnce("x", ".a {}")).not.toThrow();
  });
});
