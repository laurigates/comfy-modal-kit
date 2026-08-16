// safe-view.test.ts — the matcher, the keyword parser, the config reader and
// the reveal set. Pure functions, node environment.
//
// WHAT THIS TIER CANNOT ASSERT (see safe-view-dom.test.ts for the DOM half, and
// `comfyui-plugin:comfyui-pack-live-smoke` on the GPU box for the rest):
//
//   - That a blurred thumbnail is actually unreadable. Blur radius vs. thumbnail
//     size is a perceptual question no test tier here can answer; 18px against a
//     ~150px card was chosen by eye and belongs to the browser tier.
//   - That the settings render as ONE row shared by both packs. That is
//     ComfyUI's `addSetting` duplicate-id behaviour, not ours.
//   - Whether ComfyUI's setting store persists the value server-side.

import { describe, expect, test, vi } from "vitest";
import { getKit } from "../src/kit-global.js";
import {
  isSafeViewActive,
  isSensitive,
  makeRevealSet,
  notifySafeViewChange,
  onSafeViewChange,
  parseKeywords,
  readSafeViewConfig,
  SAFE_VIEW_DEFAULT_KEYWORDS,
  SAFE_VIEW_DEFAULTS,
  SAFE_VIEW_SETTINGS,
  type SafeViewConfig,
  type SafeViewSettingHost,
  safeViewSettings,
  sensitiveKeyword,
  toggleSafeView,
  tokenize,
} from "../src/safe-view.js";

/** A config with everything default except the keywords under test. */
const cfg = (over: Partial<SafeViewConfig> = {}): SafeViewConfig => ({
  ...SAFE_VIEW_DEFAULTS,
  ...over,
});

/** An in-memory stand-in for ComfyUI's setting store. */
function fakeHost(initial: Record<string, unknown> = {}): SafeViewSettingHost & {
  values: Record<string, unknown>;
} {
  const values: Record<string, unknown> = { ...initial };
  return {
    values,
    get<T>(id: string): T | undefined {
      return values[id] as T | undefined;
    },
    set(id: string, value: unknown) {
      values[id] = value;
      return value;
    },
  };
}

describe("tokenize", () => {
  test("splits on every non-alphanumeric and lowercases", () => {
    expect(tokenize("output/nsfw/2026-08-04")).toEqual(["output", "nsfw", "2026", "08", "04"]);
    expect(tokenize("my_NSFW_pic.png")).toEqual(["my", "nsfw", "pic", "png"]);
  });

  test("keeps a compound word whole — this is what makes matching non-substring", () => {
    // If this ever returned ["ass", "ets"], the `assets/` false positive below
    // would come back. The two assertions are the same claim from both ends.
    expect(tokenize("assets")).toEqual(["assets"]);
    expect(tokenize("classic.png")).toEqual(["classic", "png"]);
  });

  test("non-strings and empty input yield no tokens", () => {
    expect(tokenize(undefined)).toEqual([]);
    expect(tokenize(null)).toEqual([]);
    expect(tokenize("")).toEqual([]);
    expect(tokenize("///")).toEqual([]);
  });
});

describe("parseKeywords", () => {
  test("accepts commas, whitespace, or both", () => {
    expect(parseKeywords("nsfw, private  secret")).toEqual(["nsfw", "private", "secret"]);
  });

  test("lowercases, strips punctuation, and dedupes", () => {
    // All three normalize to the same token, so exactly one survives.
    expect(parseKeywords("NSFW, nsfw, n-s-f-w!")).toEqual(["nsfw"]);
    expect(parseKeywords("private, NSFW")).toEqual(["private", "nsfw"]);
  });

  test("an empty or non-string setting yields no keywords", () => {
    expect(parseKeywords("")).toEqual([]);
    expect(parseKeywords("   ,  , ")).toEqual([]);
    expect(parseKeywords(undefined)).toEqual([]);
    expect(parseKeywords(42)).toEqual([]);
  });
});

describe("isSensitive — the corpus control", () => {
  // A KNOWN-GOOD CONTROL SET. A matcher run over only-matching paths is green
  // by construction and asserts nothing about false positives; the non-matching
  // half is what has to stay non-matching, and `assets/` is the specific
  // regression this design exists to prevent.
  const MATCH = [
    { name: "pic.png", path: "output/nsfw/2026-08-04" },
    { name: "my_nsfw_pic.png", path: "output/2026-08-04" },
    { name: "NSFW.png", path: "output" },
    { name: "clip.webm", path: "output/NSFW" },
    { name: "a.png", path: "output/hold/nsfw/deep/nested" },
  ];
  const NO_MATCH = [
    { name: "logo.png", path: "output/assets" },
    { name: "classic.png", path: "output/2026-08-04" },
    { name: "assessment.png", path: "output/passes" },
    { name: "workflow.png", path: "input" },
    { name: "nsfwish.png", path: "output" },
  ];

  test("every matching path in the corpus matches", () => {
    for (const t of MATCH) {
      expect(isSensitive(t, cfg({ keywords: ["nsfw"] })), `${t.path}/${t.name}`).toBe(true);
    }
  });

  test("every non-matching path in the corpus stays clean", () => {
    for (const t of NO_MATCH) {
      expect(isSensitive(t, cfg({ keywords: ["nsfw"] })), `${t.path}/${t.name}`).toBe(false);
    }
  });

  test("a short keyword does NOT match a longer word containing it", () => {
    // The named regression: substring matching would blur every `assets/`
    // folder and every `classic.png` in the library.
    const short = cfg({ keywords: ["ass"] });
    expect(isSensitive({ name: "logo.png", path: "output/assets" }, short)).toBe(false);
    expect(isSensitive({ name: "classic.png", path: "output" }, short)).toBe(false);
    // ...but it still matches the whole token, so the keyword is not inert.
    expect(isSensitive({ name: "a.png", path: "output/ass" }, short)).toBe(true);
  });
});

describe("isSensitive — haystacks and switches", () => {
  test("matches an XMP keyword tag", () => {
    const t = { name: "plain.png", path: "output", tags: ["portrait", "NSFW"] };
    expect(isSensitive(t, cfg({ keywords: ["nsfw"] }))).toBe(true);
  });

  test("disabled or keyword-less config matches nothing", () => {
    const t = { name: "nsfw.png", path: "output/nsfw" };
    expect(isSensitive(t, cfg({ keywords: ["nsfw"], enabled: false }))).toBe(false);
    expect(isSensitive(t, cfg({ keywords: [] }))).toBe(false);
  });

  test("the prompt tier is consulted only when switched on", () => {
    const t = { name: "plain.png", path: "output", promptMatch: true as const };
    expect(isSensitive(t, cfg({ keywords: ["nsfw"], matchPrompt: false }))).toBe(false);
    expect(isSensitive(t, cfg({ keywords: ["nsfw"], matchPrompt: true }))).toBe(true);
  });

  test("an unscanned file fails SAFE — unknown reads as sensitive", () => {
    const t = { name: "plain.png", path: "output", promptMatch: "unscanned" as const };
    expect(isSensitive(t, cfg({ keywords: ["nsfw"], matchPrompt: true }))).toBe(true);
  });

  test("a target outside the tier is never blurred by it", () => {
    // `undefined` (a folder card — no generation metadata to scan) must not be
    // confused with "unscanned". Conflating them blurs every folder the moment
    // the prompt tier is switched on.
    const folder = { name: "2026-08-04", path: "output" };
    expect(isSensitive(folder, cfg({ keywords: ["nsfw"], matchPrompt: true }))).toBe(false);
  });
});

describe("readSafeViewConfig", () => {
  test("falls back to documented defaults with no host", () => {
    expect(readSafeViewConfig(null)).toEqual(SAFE_VIEW_DEFAULTS);
  });

  test("an unstored keyword setting yields the default keyword", () => {
    expect(readSafeViewConfig(fakeHost()).keywords).toEqual(["nsfw"]);
  });

  test("a deliberately CLEARED keyword setting stays empty", () => {
    // The distinction that matters: `undefined` is "never stored" and takes the
    // default; `""` is the user emptying the box, and must not snap back to
    // `nsfw` — which would make the field impossible to clear.
    const host = fakeHost({ [SAFE_VIEW_SETTINGS.keywords]: "" });
    expect(readSafeViewConfig(host).keywords).toEqual([]);
    expect(isSafeViewActive(readSafeViewConfig(host))).toBe(false);
  });

  test("reads each stored value", () => {
    const host = fakeHost({
      [SAFE_VIEW_SETTINGS.enabled]: false,
      [SAFE_VIEW_SETTINGS.keywords]: "private",
      [SAFE_VIEW_SETTINGS.hide]: true,
      [SAFE_VIEW_SETTINGS.blurNames]: false,
      [SAFE_VIEW_SETTINGS.matchPrompt]: true,
    });
    expect(readSafeViewConfig(host)).toEqual({
      enabled: false,
      keywords: ["private"],
      hide: true,
      blurNames: false,
      matchPrompt: true,
    });
  });

  test("a non-boolean stored value falls back rather than coercing", () => {
    const host = fakeHost({ [SAFE_VIEW_SETTINGS.enabled]: "yes" });
    expect(readSafeViewConfig(host).enabled).toBe(SAFE_VIEW_DEFAULTS.enabled);
  });
});

describe("sensitiveKeyword", () => {
  test("writes the FIRST keyword the user configured", () => {
    // Lifted from comfyui-gallery-loader/tests/js/safe-tag.test.js, which
    // covered the pack's hand-written copy. Not a packaged constant: the filter
    // matches the user's own list, so any other choice could write a mark their
    // filter does not honour.
    expect(sensitiveKeyword(cfg({ keywords: ["private", "nsfw"] }))).toBe("private");
  });

  test("is null for an empty keyword list — no hidden default", () => {
    // Two-sided with the case above, in the same shape: an implementation
    // hard-wired to `return null` passes this and fails that one, and one
    // hard-wired to SAFE_VIEW_DEFAULT_KEYWORDS passes neither.
    expect(sensitiveKeyword(cfg({ keywords: [] }))).toBe(null);
    expect(sensitiveKeyword(cfg({ keywords: [] }))).not.toBe(SAFE_VIEW_DEFAULT_KEYWORDS);
  });

  test("reads the order parseKeywords preserved, which is the whole justification", () => {
    // The pack copies took "the first entry" on faith. Here the guarantee it
    // rests on is kit-side, so assert the pair end to end rather than the
    // indexing alone.
    const keywords = parseKeywords("Private, NSFW  boudoir");
    expect(keywords).toEqual(["private", "nsfw", "boudoir"]);
    expect(sensitiveKeyword(cfg({ keywords }))).toBe("private");
  });
});

describe("toggleSafeView", () => {
  test("flips the stored enabled value", () => {
    const host = fakeHost({
      [SAFE_VIEW_SETTINGS.enabled]: true,
      [SAFE_VIEW_SETTINGS.keywords]: "nsfw",
    });
    toggleSafeView(host);
    expect(host.values[SAFE_VIEW_SETTINGS.enabled]).toBe(false);
    toggleSafeView(host);
    expect(host.values[SAFE_VIEW_SETTINGS.enabled]).toBe(true);
  });

  test("with no keywords it writes NOTHING and says where to configure", () => {
    // A toggle that silently does nothing is the worst shape a control can
    // take; the user cannot tell it from a broken one.
    const host = fakeHost({
      [SAFE_VIEW_SETTINGS.enabled]: true,
      [SAFE_VIEW_SETTINGS.keywords]: "",
    });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    toggleSafeView(host);
    expect(host.values[SAFE_VIEW_SETTINGS.enabled]).toBe(true);
    // notify() degrades to console.info when there is no DOM (modal-notify.ts:
    // 257-258), which is this tier. That it renders a copyable toast in a
    // browser is asserted by modal-notify's own jsdom suite, not here.
    expect(info).toHaveBeenCalledWith(expect.stringContaining("Safe View has no keywords"));
    info.mockRestore();
  });
});

describe("makeRevealSet", () => {
  test("reveals one address without revealing its neighbours", () => {
    const set = makeRevealSet();
    set.reveal("output", "nsfw", "a.png");
    expect(set.has("output", "nsfw", "a.png")).toBe(true);
    expect(set.has("output", "nsfw", "b.png")).toBe(false);
    // Same name under a different root is a DIFFERENT file.
    expect(set.has("input", "nsfw", "a.png")).toBe(false);
  });

  test("revealing twice is idempotent", () => {
    const set = makeRevealSet();
    set.reveal("output", "", "a.png");
    set.reveal("output", "", "a.png");
    expect(set.size).toBe(1);
  });

  test("clear() drops everything", () => {
    const set = makeRevealSet();
    set.reveal("output", "", "a.png");
    set.clear();
    expect(set.size).toBe(0);
    expect(set.has("output", "", "a.png")).toBe(false);
  });
});

describe("safeViewSettings", () => {
  const settings = safeViewSettings();

  test("every setting has a DISTINCT full category array", () => {
    // Two settings sharing an identical full category array silently collapse
    // into one (treeUtil.ts:24-38) — the first vanishes from the dialog while
    // its value stays stored, which looks exactly like a lost preference.
    const paths = settings.map((s) => s.category.join(" > "));
    expect(new Set(paths).size).toBe(settings.length);
  });

  test("every setting shares the family's top-level category", () => {
    for (const s of settings) expect(s.category[0]).toBe("Touch Tools");
  });

  test("sortOrder descends, so the dialog shows registration order", () => {
    const orders = settings.map((s) => s.sortOrder);
    expect(orders).toEqual([...orders].sort((a, b) => b - a));
    expect(new Set(orders).size).toBe(orders.length);
  });

  test("the frozen ids are exactly the five documented ones", () => {
    expect(settings.map((s) => s.id)).toEqual([
      "TouchTools.SafeView.Enabled",
      "TouchTools.SafeView.Keywords",
      "TouchTools.SafeView.Hide",
      "TouchTools.SafeView.BlurNames",
      "TouchTools.SafeView.MatchPrompt",
    ]);
  });

  test("defaults match the documented table", () => {
    expect(settings.map((s) => s.defaultValue)).toEqual([true, "nsfw", false, true, false]);
  });

  test("onChange fires the cross-pack listeners", () => {
    const seen: string[] = [];
    const off = onSafeViewChange(() => seen.push("hit"));
    for (const s of settings) s.onChange(s.defaultValue);
    off();
    expect(seen).toHaveLength(settings.length);
  });
});

describe("onSafeViewChange", () => {
  test("unsubscribing stops delivery", () => {
    const seen: string[] = [];
    const off = onSafeViewChange(() => seen.push("a"));
    notifySafeViewChange();
    off();
    notifySafeViewChange();
    expect(seen).toEqual(["a"]);
  });

  test("one throwing listener does not starve the rest", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const seen: string[] = [];
    const offA = onSafeViewChange(() => {
      throw new Error("boom");
    });
    const offB = onSafeViewChange(() => seen.push("b"));
    notifySafeViewChange();
    offA();
    offB();
    expect(seen).toEqual(["b"]);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  test("listeners live on the shared rendezvous, not in module state", () => {
    // This is what makes the cross-pack case work: only ONE pack's settings
    // registration takes effect, so the pack whose onChange fires is often not
    // the pack whose grid needs repainting.
    const before = getKit().safeViewListeners.length;
    const off = onSafeViewChange(() => {});
    expect(getKit().safeViewListeners.length).toBe(before + 1);
    off();
    expect(getKit().safeViewListeners.length).toBe(before);
  });
});
