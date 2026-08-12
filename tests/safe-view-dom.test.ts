// @vitest-environment jsdom
//
// safe-view-dom.test.ts — the blur, the name spoiler and the per-card reveal
// button.
//
// TIER DISCIPLINE (.claude/rules/modal-pack-test-tiers.md), and every one of
// these was a live trap in this feature:
//
//   - The blur arrives through an INJECTED CLASS RULE, so `el.style.filter` is
//     `""` whether the code works or not. Everything here reads
//     `getComputedStyle`, and the resolved-cascade probe below fails loudly if
//     a jsdom upgrade ever stops resolving `filter` — otherwise these
//     assertions would quietly start reporting the harness instead of the code.
//   - The `title` attribute must be ABSENT, not empty: a native tooltip renders
//     regardless of CSS, so `toBe("")` would pass against a card that still
//     leaks the filename on hover.
//   - The reveal click is dispatched ON THE BUTTON, inside the card. A
//     document-level dispatch never reaches a listener bound below it, so
//     "the card did not open" would be true by construction — with or without
//     the stopPropagation under test.
//
// WHAT THIS TIER CANNOT ASSERT: whether 18px of blur actually makes a ~150px
// thumbnail unreadable, and whether the reveal button clears the family's 34px
// touch-target floor. jsdom performs no layout and no rendering; both belong to
// the live-smoke tier on the GPU box.

import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  ensureSafeViewStyle,
  makeRevealButton,
  SAFE_VIEW_BLUR_CLASS,
  SAFE_VIEW_SPOILER_CLASS,
  setBlurred,
  setSpoilered,
} from "../src/safe-view.js";

beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

afterEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "";
});

const mount = <T extends HTMLElement>(el: T): T => {
  document.body.append(el);
  return el;
};

describe("the harness itself", () => {
  test("jsdom resolves `filter` from an injected class rule", () => {
    // THE HARNESS CHECK. Every blur assertion below is only meaningful if jsdom
    // actually resolves this property out of the stylesheet — it silently drops
    // values it cannot represent (anything containing min()/calc(), notably),
    // and a dropped value reads as "" which is indistinguishable from a bug.
    // If this test ever goes red, the blur assertions must move to a
    // stylesheet-source scan, not be deleted.
    ensureSafeViewStyle();
    const el = mount(document.createElement("div"));
    el.classList.add(SAFE_VIEW_BLUR_CLASS);
    expect(getComputedStyle(el).filter).toBe("blur(18px)");
  });
});

describe("setBlurred", () => {
  test("applies a real blur through the resolved cascade", () => {
    const img = mount(document.createElement("img"));
    expect(getComputedStyle(img).filter).not.toBe("blur(18px)");
    setBlurred(img, true);
    expect(getComputedStyle(img).filter).toBe("blur(18px)");
  });

  test("removing it restores the unfiltered element", () => {
    const img = mount(document.createElement("img"));
    setBlurred(img, true);
    setBlurred(img, false);
    expect(getComputedStyle(img).filter).not.toBe("blur(18px)");
    expect(img.classList.contains(SAFE_VIEW_BLUR_CLASS)).toBe(false);
  });

  test("injects its stylesheet itself, so a caller cannot forget to", () => {
    const img = mount(document.createElement("img"));
    setBlurred(img, true);
    expect(document.getElementById("cmk-safe-view-style")).not.toBeNull();
  });
});

describe("setSpoilered", () => {
  test("REMOVES the title attribute rather than blanking it", () => {
    // The leak this exists to close: `filter: blur()` on the label does nothing
    // about the native tooltip, which renders the exact string in full on
    // hover. Asserting `.title === ""` would pass against that bug, because
    // reading `.title` off an element with no such attribute also yields "".
    const label = mount(document.createElement("span"));
    label.setAttribute("title", "my_nsfw_pic.png — 1024×1024");
    setSpoilered(label, true);
    expect(label.hasAttribute("title")).toBe(false);
  });

  test("restores the original title verbatim when un-spoilered", () => {
    const original = "my_nsfw_pic.png — 1024×1024 — 2026-08-04 12:00";
    const label = mount(document.createElement("span"));
    label.setAttribute("title", original);
    setSpoilered(label, true);
    setSpoilered(label, false);
    expect(label.getAttribute("title")).toBe(original);
  });

  test("paints a solid block with transparent text, not a text blur", () => {
    // Blurred text stays readable at the size a phone grid renders names at,
    // so the spoiler must be opaque. `color: transparent` plus a background is
    // the whole mechanism, and both halves are asserted: a background alone
    // would still show the glyphs on top of it.
    const label = mount(document.createElement("span"));
    setSpoilered(label, true);
    const style = getComputedStyle(label);
    // `transparent` computes to the fully-transparent rgba, not the keyword.
    expect(style.color).toBe("rgba(0, 0, 0, 0)");
    expect(style.backgroundColor).toBe("rgb(58, 58, 68)");
    expect(style.filter).not.toBe("blur(18px)");
  });

  test("spoilering an element with no title is a no-op on the attribute", () => {
    const label = mount(document.createElement("span"));
    setSpoilered(label, true);
    expect(label.hasAttribute("title")).toBe(false);
    setSpoilered(label, false);
    // Nothing was parked, so nothing is invented on the way back.
    expect(label.hasAttribute("title")).toBe(false);
    expect(label.classList.contains(SAFE_VIEW_SPOILER_CLASS)).toBe(false);
  });

  test("a second spoiler pass does not park the placeholder as the title", () => {
    // Regression guard for the obvious refactor: parking unconditionally would
    // overwrite the stashed original with `null`/"" on the second call, and the
    // real title would be unrecoverable.
    const label = mount(document.createElement("span"));
    label.setAttribute("title", "secret.png");
    setSpoilered(label, true);
    setSpoilered(label, true);
    setSpoilered(label, false);
    expect(label.getAttribute("title")).toBe("secret.png");
  });
});

describe("makeRevealButton", () => {
  test("its click does NOT also open the card underneath", () => {
    // Dispatched on the BUTTON, where a real tap lands — not on `document`.
    // A document-level dispatch never reaches the card's own listener, so this
    // assertion would hold with the stopPropagation removed and would prove
    // nothing. Verified by removing it: the card handler then fires and this
    // goes red.
    const card = mount(document.createElement("div"));
    const opened: string[] = [];
    card.addEventListener("click", () => opened.push("card"));

    const revealed: string[] = [];
    const btn = makeRevealButton({ onReveal: () => revealed.push("reveal") });
    card.append(btn);

    btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(revealed).toEqual(["reveal"]);
    expect(opened).toEqual([]);
  });

  test("its accessible name carries no filename", () => {
    // A spoiler that blocks the visible text while announcing the same string
    // through the accessibility tree has hidden nothing.
    const btn = makeRevealButton({ onReveal: () => {} });
    expect(btn.getAttribute("aria-label")).toBe("Reveal hidden item");
    expect(btn.textContent).toBe("👁");
  });

  test("is a non-submitting button", () => {
    // A bare <button> inside a form defaults to type=submit.
    expect(makeRevealButton({ onReveal: () => {} }).type).toBe("button");
  });
});
