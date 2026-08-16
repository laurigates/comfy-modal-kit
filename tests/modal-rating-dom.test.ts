// @vitest-environment jsdom
//
// modal-rating-dom.test.ts — `applyStars` (the only DOM-mutating helper in
// src/modal-rating.ts) and `postRating` (its network half).
//
// Both were deferred to "the consuming packs' smoke matrices" on the same stale
// premise as highlightMatches: that a DOM meant a heavyweight dependency. jsdom
// has been a devDependency since the coordinator suites landed
// (laurigates/comfy-modal-kit#27).
//
// Why they earn direct coverage: both gallery packs call `applyStars` on every
// OPTIMISTIC rating write and again on every ROLLBACK, so its down-repaint is
// the rollback. A helper that only ever added `is-on` would look perfect in a
// smoke test — you tap up, the stars light — and leave the failed write showing
// a rating the file does not carry. `postRating` is what decides a rollback
// happens at all, and `{ok: false}` on a 200 is the shape the packs' endpoints
// actually return for a refused write.
//
// TIER DISCIPLINE (.claude/rules/modal-pack-test-tiers.md): class lists, the
// data attribute and the promise outcome are all structural, which is what
// jsdom answers honestly. Whether a 34px star is tappable, and whether the
// XMP write really landed on disk, belong to the live-smoke tier.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { applyStars, postRating, starsHTML } from "../src/modal-rating.js";

/** A star row built the way the packs build it — from `starsHTML`, not by hand. */
function makeRow(prefix: string, rating: number): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = starsHTML(prefix, rating);
  return host.firstElementChild as HTMLElement;
}

/** Which stars currently read as lit, 1-indexed. */
const lit = (row: HTMLElement): number[] =>
  [...row.querySelectorAll<HTMLElement>("[data-val]")]
    .filter((s) => s.classList.contains("is-on"))
    .map((s) => Number(s.dataset.val));

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("applyStars — repaints in BOTH directions", () => {
  test("repaints UP", () => {
    const row = makeRow("ip", 1);
    expect(lit(row)).toEqual([1]);
    applyStars(row, 4);
    expect(lit(row)).toEqual([1, 2, 3, 4]);
  });

  test("repaints DOWN — the rollback path", () => {
    // The half a tap-and-look smoke test cannot see. An implementation that only
    // ever ADDS `is-on` passes the up case and leaves a failed write showing a
    // rating the file does not carry.
    const row = makeRow("ip", 4);
    expect(lit(row)).toEqual([1, 2, 3, 4]);
    applyStars(row, 1);
    expect(lit(row)).toEqual([1]);
  });

  test("clears to zero", () => {
    const row = makeRow("gl", 3);
    applyStars(row, 0);
    expect(lit(row)).toEqual([]);
  });
});

describe("applyStars — data-rating stays in sync with is-on", () => {
  test("the attribute and the lit count agree after every repaint", () => {
    // They are read by different consumers — the attribute by the packs' click
    // handler (it is where `nextRating`'s "current" comes from), the classes by
    // the user's eye. If they drift, tapping the top star stops clearing and
    // there is nothing on screen to explain why.
    const row = makeRow("ib", 0);
    for (const r of [5, 2, 0, 3, 1]) {
      applyStars(row, r);
      expect(row.dataset.rating).toBe(String(r));
      expect(lit(row).length).toBe(r);
    }
  });
});

describe("applyStars — clamps out-of-range input", () => {
  test("above the top star clamps to 5, in the attribute too", () => {
    const row = makeRow("ip", 0);
    applyStars(row, 9);
    expect(lit(row)).toEqual([1, 2, 3, 4, 5]);
    expect(row.dataset.rating).toBe("5");
  });

  test("negative and fractional go through ratingOf, not through raw assignment", () => {
    const row = makeRow("ip", 3);
    applyStars(row, -2);
    expect(lit(row)).toEqual([]);
    expect(row.dataset.rating).toBe("0");
    applyStars(row, 3.7);
    expect(lit(row)).toEqual([1, 2, 3]);
    expect(row.dataset.rating).toBe("3");
  });
});

describe("applyStars — touches only the row it was given", () => {
  test("a sibling row in the same grid is untouched", () => {
    // The packs repaint one card out of a grid of hundreds. A querySelector that
    // escaped the row would repaint every card to the last rating written.
    const a = makeRow("ip", 1);
    const b = makeRow("ip", 4);
    document.body.append(a, b);
    applyStars(a, 5);
    expect(lit(a)).toEqual([1, 2, 3, 4, 5]);
    expect(lit(b)).toEqual([1, 2, 3, 4]);
    expect(b.dataset.rating).toBe("4");
  });
});

describe("postRating", () => {
  const addr = { type: "output", subfolder: "sub", absDir: "/ignored", name: "foo.png" };

  /** A `fetch` stub that records its one call and answers `body`. */
  function stubFetch(init: { ok?: boolean; status?: number; body?: unknown }) {
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, reqInit: RequestInit) => {
        calls.push({ url, init: reqInit });
        return Promise.resolve({
          ok: init.ok ?? true,
          status: init.status ?? 200,
          json: () => Promise.resolve(init.body ?? { ok: true }),
        });
      }),
    );
    return calls;
  }

  test("POSTs the request body to the pack's own URL", () => {
    const calls = stubFetch({ body: { ok: true, rating: 4 } });
    return postRating("/gallery_loader/rating", addr, 4).then(() => {
      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("/gallery_loader/rating");
      expect(calls[0]?.init.method).toBe("POST");
      expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
        type: "output",
        subfolder: "sub",
        name: "foo.png",
        rating: 4,
      });
    });
  });

  test("resolves to the SERVER's rating, not the one that was sent", () => {
    // The positive half. A caller painting the optimistic value would show a
    // rating the file does not carry whenever the server coerced the write.
    stubFetch({ body: { ok: true, rating: 3 } });
    return expect(postRating("/x/rating", addr, 5)).resolves.toBe(3);
  });

  test("falls back to the sent rating when the server echoes no number", () => {
    stubFetch({ body: { ok: true } });
    return expect(postRating("/x/rating", addr, 2)).resolves.toBe(2);
  });

  test("REJECTS on {ok: false} despite a 200 — this is what arms the rollback", () => {
    // The refusal shape both packs' endpoints actually return: HTTP 200 with
    // `ok:false` and a reason. Resolving here would leave the optimistic paint
    // standing over a write that never happened, and `applyStars`' down-repaint
    // above would never run.
    stubFetch({ ok: true, status: 200, body: { ok: false, error: "read-only file" } });
    return expect(postRating("/x/rating", addr, 4)).rejects.toThrow("read-only file");
  });

  test("a refusal with no message still rejects, with a usable default", () => {
    stubFetch({ ok: true, status: 200, body: { ok: false } });
    return expect(postRating("/x/rating", addr, 4)).rejects.toThrow("rating failed");
  });

  test("rejects on a non-2xx, naming the status", () => {
    stubFetch({ ok: false, status: 500, body: { ok: true, rating: 5 } });
    return expect(postRating("/x/rating", addr, 4)).rejects.toThrow("HTTP 500");
  });

  test("a path-type address posts the absolute dir", () => {
    const calls = stubFetch({ body: { ok: true, rating: 1 } });
    const pathAddr = { type: "path", subfolder: "ignored", absDir: "/abs/dir", name: "foo.png" };
    return postRating("/x/rating", pathAddr, 1).then(() => {
      expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
        type: "path",
        path: "/abs/dir",
        name: "foo.png",
        rating: 1,
      });
    });
  });
});
