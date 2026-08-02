// escape-html.test.ts — pure string function, no DOM needed.

import { describe, expect, test } from "vitest";

import { escapeHTML } from "../src/escape-html.js";

describe("escapeHTML", () => {
  test("escapes all five entities", () => {
    expect(escapeHTML(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });

  test("escapes the ampersand first so entities are not double-encoded", () => {
    // A naive replace order turns "<" into "&lt;" and then the "&" of that
    // into "&amp;lt;". One pass over the regex cannot, but lock it anyway.
    expect(escapeHTML("<a>")).toBe("&lt;a&gt;");
    expect(escapeHTML("&amp;")).toBe("&amp;amp;");
  });

  test("leaves safe text untouched", () => {
    expect(escapeHTML("ComfyUI_00001_.png")).toBe("ComfyUI_00001_.png");
    expect(escapeHTML("2026-08-02/renders")).toBe("2026-08-02/renders");
  });

  test("neutralises a script tag in a filename", () => {
    expect(escapeHTML(`<img src=x onerror="alert(1)">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(1)&quot;&gt;",
    );
  });

  test("coerces non-string input", () => {
    expect(escapeHTML(42)).toBe("42");
    expect(escapeHTML(null)).toBe("null");
    expect(escapeHTML(undefined)).toBe("undefined");
  });

  test("empty string round-trips", () => {
    expect(escapeHTML("")).toBe("");
  });
});
