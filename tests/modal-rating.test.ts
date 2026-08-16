// modal-rating.test.ts — the pure helpers from src/modal-rating.ts, in the node
// environment.
//
// `applyStars` (DOM) and `postRating` (fetch) are covered directly in
// tests/modal-rating-dom.test.ts (jsdom).

import { describe, expect, test } from "vitest";

import { nextRating, ratingOf, ratingRequestBody, starsHTML } from "../src/modal-rating.js";

describe("nextRating", () => {
  test("clicking a higher star sets it", () => {
    expect(nextRating(2, 4)).toBe(4);
  });
  test("clicking a lower star sets it", () => {
    expect(nextRating(4, 2)).toBe(2);
  });
  test("clicking the current top star clears to 0", () => {
    expect(nextRating(3, 3)).toBe(0);
  });
});

describe("ratingOf", () => {
  test("missing rating is 0", () => {
    expect(ratingOf({})).toBe(0);
  });
  test("zero / negative is 0", () => {
    expect(ratingOf({ rating: 0 })).toBe(0);
    expect(ratingOf({ rating: -2 })).toBe(0);
  });
  test("clamps to 5", () => {
    expect(ratingOf({ rating: 9 })).toBe(5);
  });
  test("passes through 1..5", () => {
    expect(ratingOf({ rating: 3 })).toBe(3);
  });
  test("floors fractional ratings", () => {
    expect(ratingOf({ rating: 3.7 })).toBe(3);
  });
});

describe("ratingRequestBody", () => {
  test("sandboxed types send type + subfolder", () => {
    const addr = { type: "output", subfolder: "sub", absDir: "/ignored", name: "foo.png" };
    expect(ratingRequestBody(addr, 4)).toEqual({
      type: "output",
      subfolder: "sub",
      name: "foo.png",
      rating: 4,
    });
  });
  test("path type sends the absolute dir as path", () => {
    const addr = { type: "path", subfolder: "ignored", absDir: "/abs/dir", name: "foo.png" };
    expect(ratingRequestBody(addr, 2)).toEqual({
      type: "path",
      path: "/abs/dir",
      name: "foo.png",
      rating: 2,
    });
  });
});

describe("starsHTML", () => {
  test("marks the first N stars as on", () => {
    const html = starsHTML("ip", 3);
    const onCount = (html.match(/is-on/g) || []).length;
    expect(onCount).toBe(3);
    expect(html).toContain('data-rating="3"');
    expect((html.match(/data-val=/g) || []).length).toBe(5);
  });
  test("unrated has no on stars", () => {
    expect(starsHTML("gl", 0)).not.toContain("is-on");
  });
  test("prefix namespaces the CSS classes", () => {
    const html = starsHTML("ib", 1);
    expect(html).toContain('class="ib-stars"');
    expect(html).toContain('class="ib-star is-on"');
  });
});
