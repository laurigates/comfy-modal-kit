// gallery-file.test.ts — pure comparators, the sort-option contract, the media
// families, the absolute-path join and the metadata display order.
//
// The flat-view preference store needs localStorage and lives in
// tests/gallery-view-store.test.ts (jsdom).
//
// WHAT THIS TIER CANNOT ASSERT: whether either pack's grid actually renders a
// `.avif` or plays a `.mkv`. The sets say what the packs AGREE to treat as an
// image or a video; whether a given browser can decode it is a browser-tier
// question (`comfyui-plugin:comfyui-pack-live-smoke`).

import { describe, expect, test } from "vitest";

import {
  type GalleryFile,
  IMG_EXTS,
  isValidSort,
  joinAbs,
  META_FIELDS,
  type MetaRow,
  metaClipboardText,
  metaRows,
  SANDBOXED_TYPES,
  SORT_OPTIONS,
  sortFiles,
  VIDEO_EXTS,
} from "../src/gallery-file.js";

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

describe("IMG_EXTS / VIDEO_EXTS", () => {
  test("the two families are disjoint, and .gif is an IMAGE", () => {
    // Two-sided on the one entry that could plausibly go either way: .gif is in
    // VHS's video list and in ours, and the grid renders it as a still <img>.
    // A set that swallowed it into VIDEO_EXTS would put a <video> element on
    // every animated thumbnail in the listing.
    expect(IMG_EXTS.has(".gif")).toBe(true);
    expect(VIDEO_EXTS.has(".gif")).toBe(false);
    expect(VIDEO_EXTS.has(".mp4")).toBe(true);
    expect(IMG_EXTS.has(".mp4")).toBe(false);
    for (const ext of IMG_EXTS) expect(VIDEO_EXTS.has(ext)).toBe(false);
  });

  test("carries exactly the extensions both packs shipped", () => {
    // The literal sets, not a count: a count passes against a set that swapped
    // one extension for another, which is precisely the drift this extraction
    // exists to stop.
    expect([...IMG_EXTS].sort()).toEqual(
      [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".tif", ".avif"].sort(),
    );
    expect([...VIDEO_EXTS].sort()).toEqual(
      [".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v", ".mpg", ".mpeg"].sort(),
    );
  });

  test("every entry is lowercase with a leading dot", () => {
    // The packs lowercase the file's extension before the lookup, so an entry
    // that lost its dot or carried a capital would simply never match — a
    // silent hole rather than an error.
    for (const ext of [...IMG_EXTS, ...VIDEO_EXTS]) {
      expect(ext).toBe(ext.toLowerCase());
      expect(ext.startsWith(".")).toBe(true);
    }
  });
});

describe("SANDBOXED_TYPES", () => {
  test("names the three write-eligible roots and NOT the browse-only ones", () => {
    // Two-sided in one test: a list hard-wired to [] passes the second half
    // alone, and one hard-wired to every known location passes the first half
    // alone. Both halves together only pass for the real three.
    expect([...SANDBOXED_TYPES]).toEqual(["input", "output", "temp"]);
    expect(SANDBOXED_TYPES.includes("path")).toBe(false);
    expect(SANDBOXED_TYPES.includes("pinned")).toBe(false);
  });
});

describe("joinAbs", () => {
  test("joins with exactly one separator, trailing slash or not", () => {
    expect(joinAbs("/a/b", "c.png")).toBe("/a/b/c.png");
    expect(joinAbs("/a/b/", "c.png")).toBe("/a/b/c.png");
    expect(joinAbs("/a/b///", "c.png")).toBe("/a/b/c.png");
  });

  test("an empty or root dir still yields an ABSOLUTE path", () => {
    // The two-sided half: a helper that only ever stripped slashes would answer
    // "c.png" here — a relative path the ?path= endpoints resolve against the
    // server's cwd rather than rejecting.
    expect(joinAbs("", "c.png")).toBe("/c.png");
    expect(joinAbs("/", "c.png")).toBe("/c.png");
  });
});

describe("META_FIELDS / metaRows", () => {
  test("the display order is prompts, model, then numerics", () => {
    expect(META_FIELDS.map((f) => f.key)).toEqual([
      "positive",
      "negative",
      "model",
      "seed",
      "steps",
      "cfg",
      "sampler",
      "scheduler",
    ]);
  });

  test("rows follow META_FIELDS, NOT the response's own key order", () => {
    // The whole reason META_FIELDS exists. The summary below is built in
    // reverse, which is a real shape: JSON insertion order varies with whichever
    // tool wrote the file, so rendering it directly lays the same image out
    // differently depending on its provenance.
    const summary = { scheduler: "karras", seed: 42, positive: "a cat" };
    expect(metaRows(summary).map((r) => r.key)).toEqual(["positive", "seed", "scheduler"]);
  });

  test("drops missing / null / whitespace-only values but keeps real ones", () => {
    // Two-sided on the same input: an implementation hard-wired to return []
    // passes the drops and fails the keep.
    const rows = metaRows({
      positive: "a cat",
      negative: "   ",
      model: null,
      seed: undefined,
      steps: 20,
    });
    expect(rows.map((r) => r.key)).toEqual(["positive", "steps"]);
    expect(rows.map((r) => r.value)).toEqual(["a cat", "20"]);
  });

  test("0 is a real value and survives (it is not 'missing')", () => {
    // A falsy-value filter would drop `cfg: 0` and `seed: 0`, and a seed of 0 is
    // both legal and common.
    expect(metaRows({ seed: 0, cfg: 0 }).map((r) => r.value)).toEqual(["0", "0"]);
  });

  test("a non-object summary yields no rows rather than throwing", () => {
    expect(metaRows(null)).toEqual([]);
    expect(metaRows(undefined)).toEqual([]);
  });

  test("labels are carried from META_FIELDS, not re-derived from the key", () => {
    // "cfg" -> "CFG" and "positive" -> "Positive" are not the same
    // transformation, so a row that capitalised its own key would ship "Cfg".
    const byKey = new Map(metaRows({ cfg: 7, positive: "x" }).map((r) => [r.key, r.label]));
    expect(byKey.get("cfg")).toBe("CFG");
    expect(byKey.get("positive")).toBe("Positive");
  });
});

describe("metaClipboardText", () => {
  test("one 'Label: value' per line", () => {
    const rows: MetaRow[] = [
      { key: "positive", label: "Positive", value: "a cat" },
      { key: "seed", label: "Seed", value: "42" },
    ];
    expect(metaClipboardText(rows)).toBe("Positive: a cat\nSeed: 42");
  });

  test("a multi-line prompt stays VERBATIM — no re-indent, no quoting", () => {
    // The payload is meant to paste straight back into a prompt box, so any
    // normalisation here silently edits the user's prompt.
    const rows: MetaRow[] = [
      { key: "positive", label: "Positive", value: "line one\n  line two\n\nline four" },
    ];
    expect(metaClipboardText(rows)).toBe("Positive: line one\n  line two\n\nline four");
  });

  test("no rows is an empty string, not a stray newline", () => {
    expect(metaClipboardText([])).toBe("");
  });
});
