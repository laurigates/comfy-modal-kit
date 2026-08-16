// @vitest-environment jsdom
//
// modal-fuzzy-dom.test.ts — `highlightMatches`, the one helper in
// src/modal-fuzzy.ts that builds DOM.
//
// It was deferred for years on the premise that covering it "would add a
// heavyweight dev dependency for one helper". That premise died when jsdom
// landed for the coordinator / notify / overlay suites; this file is the
// correction (laurigates/comfy-modal-kit#27).
//
// Why it earns direct coverage rather than riding a pack's test: gallery-loader
// #85 wired it into the picker's card names and hit the offsetting subtlety —
// in flat view the SCORED haystack is `subpath/name` while the highlight is
// painted on the name element alone, so indices must be shifted by the prefix
// length and anything landing on the subpath dropped. The pack tests its own
// shifting. Nothing tested what the primitive does when a caller gets that
// arithmetic wrong, which is the OUT-OF-RANGE case below.
//
// TIER DISCIPLINE (.claude/rules/modal-pack-test-tiers.md): every assertion
// here is structural — node types, text content, class names. Whether
// `.cmp-match` is legible against the card background is a rendering question
// jsdom cannot answer and the live-smoke tier owns.

import { describe, expect, test } from "vitest";

import { fuzzyScore, highlightMatches } from "../src/modal-fuzzy.js";

/** The characters actually wrapped, in document order. */
const marked = (frag: DocumentFragment): string[] =>
  [...frag.querySelectorAll(".cmp-match")].map((el) => el.textContent ?? "");

describe("highlightMatches — the return type", () => {
  test("returns a DocumentFragment, so a caller appends without re-parsing", () => {
    // Not an HTML string. That is the property that makes a filename containing
    // markup safe by construction rather than by remembering to escape.
    const frag = highlightMatches("abc", [0]);
    expect(frag).toBeInstanceOf(DocumentFragment);
    expect(frag.nodeType).toBe(Node.DOCUMENT_FRAGMENT_NODE);
  });

  test("a filename containing markup stays TEXT", () => {
    const frag = highlightMatches("a<b>c.png", [0]);
    expect(frag.querySelectorAll("b").length).toBe(0);
    expect(frag.textContent).toBe("a<b>c.png");
  });
});

describe("highlightMatches — wraps exactly the matched characters", () => {
  test("only the named indices are wrapped, and in target order", () => {
    // Two-sided: the first assertion fails against a helper that wraps nothing,
    // the second against one that wraps everything.
    const frag = highlightMatches("abcde", [0, 2, 4]);
    expect(marked(frag)).toEqual(["a", "c", "e"]);
    expect(frag.querySelectorAll(".cmp-match").length).toBe(3);
  });

  test("one span per matched character, never a merged run", () => {
    // Adjacent matches are the common case (a cluster is what scores best), so
    // a run-merging implementation would look right on screen and break any
    // caller counting spans.
    expect(marked(highlightMatches("abcde", [1, 2]))).toEqual(["b", "c"]);
  });

  test("unordered indices still paint the right characters", () => {
    // The set is consulted per position, so the caller's ordering is irrelevant.
    expect(marked(highlightMatches("abcde", [4, 0]))).toEqual(["a", "e"]);
  });

  test("drives off a real fuzzyScore result, not hand-picked indices", () => {
    // The two halves are used together everywhere; asserting them apart lets an
    // index-convention change (0- vs 1-based) pass both suites separately.
    const scored = fuzzyScore("ace", "abcde");
    expect(scored).not.toBeNull();
    expect(marked(highlightMatches("abcde", scored?.matches))).toEqual(["a", "c", "e"]);
  });
});

describe("highlightMatches — textContent is the input, VERBATIM", () => {
  test("wrapped and unwrapped text reassemble to the original", () => {
    expect(highlightMatches("abcde", [0, 2, 4]).textContent).toBe("abcde");
  });

  test("whitespace, punctuation and unicode survive unchanged", () => {
    // The names this paints are real filenames: spaces, underscores, dots, and
    // whatever the user's OS allows. A helper that trimmed or normalised would
    // render a name the file does not have.
    const name = "  a_b — ünïcode  .png ";
    expect(highlightMatches(name, [2, 4]).textContent).toBe(name);
  });
});

describe("highlightMatches — degrades to plain text rather than throwing", () => {
  test("no indices yields one text node with the whole target", () => {
    for (const indices of [[], null, undefined]) {
      const frag = highlightMatches("abcde", indices);
      expect(frag.querySelectorAll(".cmp-match").length).toBe(0);
      expect(frag.textContent).toBe("abcde");
    }
  });

  test("OUT-OF-RANGE indices wrap nothing and keep the text intact", () => {
    // THE case that matters: a mis-offset caller (flat view's prefix shift) is
    // what produces these. Silently painting nothing is the right answer;
    // throwing would take the whole grid render down, and clamping would mark a
    // character the user never searched for.
    const frag = highlightMatches("abcde", [99, 100]);
    expect(frag.querySelectorAll(".cmp-match").length).toBe(0);
    expect(frag.textContent).toBe("abcde");
  });

  test("a NEGATIVE index is ignored the same way", () => {
    const frag = highlightMatches("abcde", [-1]);
    expect(frag.querySelectorAll(".cmp-match").length).toBe(0);
    expect(frag.textContent).toBe("abcde");
  });

  test("a partly out-of-range list still paints the in-range half", () => {
    // Two-sided against the two easy over-corrections: bailing out entirely on
    // any bad index (would mark nothing), and clamping bad indices into range
    // (would mark "e").
    const frag = highlightMatches("abcde", [1, 99]);
    expect(marked(frag)).toEqual(["b"]);
    expect(frag.textContent).toBe("abcde");
  });

  test("an empty target yields an empty fragment, not a stray node", () => {
    const frag = highlightMatches("", [0]);
    expect(frag.childNodes.length).toBe(0);
    expect(frag.textContent).toBe("");
  });
});
