// gallery-file.test.ts — pure comparators + the sort-option contract.

import { describe, expect, test } from "vitest";

import { type GalleryFile, isValidSort, SORT_OPTIONS, sortFiles } from "../src/gallery-file.js";

const f = (name: string, extra: Partial<GalleryFile> = {}): GalleryFile => ({
  name,
  mtime: 0,
  ...extra,
});

describe("SORT_OPTIONS / isValidSort", () => {
  test("every option value validates", () => {
    for (const o of SORT_OPTIONS) expect(isValidSort(o.value)).toBe(true);
  });

  test("rejects unknown values", () => {
    expect(isValidSort("bogus:desc")).toBe(false);
    expect(isValidSort("")).toBe(false);
  });

  test("carries both directions of every key the two surfaces offered", () => {
    // The picker shipped 8 options and the node grid 10; the union is the
    // contract, because the surfaces share a :sort localStorage key and the
    // narrower validator silently dropped the wider surface's preference.
    const values = SORT_OPTIONS.map((o) => o.value);
    for (const v of [
      "mtime:desc",
      "mtime:asc",
      "name:asc",
      "name:desc",
      "size:desc",
      "size:asc",
      "pixels:desc",
      "pixels:asc",
      "rating:desc",
      "rating:asc",
    ]) {
      expect(values).toContain(v);
    }
  });

  test("values are unique", () => {
    const values = SORT_OPTIONS.map((o) => o.value);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("sortFiles", () => {
  test("does not mutate the input", () => {
    const files = [f("b"), f("a")];
    const out = sortFiles(files, "name", "asc");
    expect(files.map((x) => x.name)).toEqual(["b", "a"]);
    expect(out.map((x) => x.name)).toEqual(["a", "b"]);
  });

  test("name sorts naturally (10 after 9, not before)", () => {
    const out = sortFiles([f("img10.png"), f("img9.png"), f("img1.png")], "name", "asc");
    expect(out.map((x) => x.name)).toEqual(["img1.png", "img9.png", "img10.png"]);
  });

  test("mtime is the default key and descending the default direction", () => {
    const files = [f("old", { mtime: 1 }), f("new", { mtime: 3 }), f("mid", { mtime: 2 })];
    expect(sortFiles(files, "mtime", "desc").map((x) => x.name)).toEqual(["new", "mid", "old"]);
    expect(sortFiles(files, "anything-unknown", "desc").map((x) => x.name)).toEqual([
      "new",
      "mid",
      "old",
    ]);
  });

  test("size and pixels sort numerically", () => {
    const files = [
      f("small", { size: 10, width: 10, height: 10 }),
      f("big", { size: 900, width: 100, height: 100 }),
    ];
    expect(sortFiles(files, "size", "asc").map((x) => x.name)).toEqual(["small", "big"]);
    expect(sortFiles(files, "pixels", "desc").map((x) => x.name)).toEqual(["big", "small"]);
  });

  test("missing numeric fields count as 0 rather than throwing", () => {
    const out = sortFiles([f("known", { size: 5 }), f("unknown")], "size", "asc");
    expect(out.map((x) => x.name)).toEqual(["unknown", "known"]);
  });

  test("pixels treats a missing dimension as 0, not NaN", () => {
    const out = sortFiles(
      [f("half", { width: 100 }), f("full", { width: 2, height: 2 })],
      "pixels",
      "desc",
    );
    expect(out.map((x) => x.name)).toEqual(["full", "half"]);
  });

  test("numeric ties break on name, so equal-mtime batches hold a stable order", () => {
    // A batch render writes many files within one clock tick; without the
    // tie-break they arrive in whatever order the listing happened to have.
    const files = [f("c", { mtime: 7 }), f("a", { mtime: 7 }), f("b", { mtime: 7 })];
    expect(sortFiles(files, "mtime", "asc").map((x) => x.name)).toEqual(["a", "b", "c"]);
  });

  test("rating sorts and treats unrated as 0", () => {
    const files = [f("five", { rating: 5 }), f("none"), f("two", { rating: 2 })];
    expect(sortFiles(files, "rating", "desc").map((x) => x.name)).toEqual(["five", "two", "none"]);
  });

  test("carries pack-local extra fields through (generic, not widened)", () => {
    interface Row extends GalleryFile {
      subpath?: string;
      packOnly: number;
    }
    const rows: Row[] = [
      { name: "b", mtime: 1, subpath: "x/y", packOnly: 1 },
      { name: "a", mtime: 2, subpath: "", packOnly: 2 },
    ];
    const out = sortFiles(rows, "name", "asc");
    expect(out[0]?.packOnly).toBe(2);
    expect(out[0]?.subpath).toBe("");
    expect(out[1]?.subpath).toBe("x/y");
  });
});
