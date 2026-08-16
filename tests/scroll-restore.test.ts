// scroll-restore.test.ts — the BOOKKEEPING half of the scroll restorer.
//
// WHAT THIS TIER CAN AND CANNOT ASSERT. jsdom performs no layout: it accepts
// `scrollTop = 500` on a zero-height element and reads it back verbatim,
// attached or not. So it cannot observe the three behaviours the module exists
// for — the clamp at assignment, the 0 a real engine answers from a detached
// node, and momentum. Those belong to a real-browser tier
// (comfyui-image-browser/tests/e2e, comfyui-gallery-loader/tests/e2e).
//
// What IS assertable here is the module's own decision-making, provided the
// engine behaviours are SIMULATED explicitly rather than assumed: `makeHost`
// below installs a clamping `scrollTop` and a detach-aware read, so the
// assertions are about which value this module keeps and which callbacks it
// cancels — never about jsdom's layout, which has none.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  createScrollMemory,
  installScrollRestore,
  NATIVE_SCROLL_KEYS,
  SCROLL_RESTORE_FRAMES,
} from "../src/scroll-restore.js";

/** Pending rAF callbacks, drained one frame at a time by `frame()`. */
let rafQueue: Map<number, FrameRequestCallback>;
let rafSeq: number;

function frame(): void {
  const pending = [...rafQueue.entries()];
  rafQueue.clear();
  for (const [, cb] of pending) cb(0);
}

beforeEach(() => {
  rafQueue = new Map();
  rafSeq = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafSeq += 1;
    rafQueue.set(rafSeq, cb);
    return rafSeq;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    rafQueue.delete(id);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/**
 * A scroller that behaves like a real engine in the two ways jsdom does not:
 * `scrollTop` CLAMPS to `scrollHeight - clientHeight` at the instant of
 * assignment, and reads back 0 once the element is out of the document.
 */
function makeHost(opts?: { clientHeight?: number; scrollHeight?: number }): HTMLElement {
  const el = document.createElement("div");
  const clientHeight = opts?.clientHeight ?? 800;
  let scrollHeight = opts?.scrollHeight ?? 10000;
  let raw = 0;
  Object.defineProperty(el, "clientHeight", { get: () => clientHeight });
  Object.defineProperty(el, "scrollHeight", {
    get: () => scrollHeight,
    set: (v: number) => {
      scrollHeight = v;
      raw = Math.min(raw, Math.max(0, scrollHeight - clientHeight));
    },
  });
  Object.defineProperty(el, "scrollTop", {
    get: () => (el.isConnected ? raw : 0),
    set: (v: number) => {
      raw = Math.max(0, Math.min(v, Math.max(0, scrollHeight - clientHeight)));
    },
  });
  document.body.appendChild(el);
  return el;
}

describe("installScrollRestore — reading the offset", () => {
  test("set() records what the ENGINE kept, not what was asked for", () => {
    const host = makeHost({ clientHeight: 800, scrollHeight: 10000 }); // max 9200
    const r = installScrollRestore(host);

    r.set(50000);

    expect(host.scrollTop).toBe(9200);

    // The load-bearing assertion is the one AFTER the detach, and it must not
    // be preceded by a `current()` call: while attached, `current()` takes a
    // live read and REFRESHES the mirror, which repairs a mirror holding the
    // requested 50000 before it can be observed. (Measured — this assertion
    // was vacuous in exactly that way until `just mutation-check` reported the
    // set()-trusts-its-argument mutation as MISSED.) Trusting the argument
    // stores an offset that never existed, and the close path is where that
    // value gets written into scroll memory.
    host.remove();
    expect(r.current()).toBe(9200);
    r.dispose();
  });

  test("current() falls back to the mirror once the host is DETACHED", () => {
    const host = makeHost();
    const r = installScrollRestore(host);
    r.set(3000);
    expect(r.current()).toBe(3000);

    // This is the close path: the shell removes the dialog and only THEN calls
    // onClose, so a consumer remembering the offset there reads a node that is
    // out of the document.
    host.remove();

    expect(host.scrollTop).toBe(0); // what the element itself now answers
    expect(r.current()).toBe(3000); // what the restorer still knows
    r.dispose();
  });

  test("sync() refreshes the mirror after a mutator that bypassed set()", () => {
    const host = makeHost();
    const r = installScrollRestore(host);
    r.set(1000);

    // scrollIntoView's stand-in: the element moved, and the `scroll` event that
    // would refresh the mirror is dispatched at the frame's rendering step —
    // after this task.
    host.scrollTop = 4321;
    expect(r.current()).toBe(4321); // attached, so the live read is the truth

    host.remove();
    expect(r.current()).toBe(4321);
    r.dispose();
  });

  test("a scroll event refreshes the mirror while attached", () => {
    const host = makeHost();
    const r = installScrollRestore(host);
    host.scrollTop = 777;
    host.dispatchEvent(new Event("scroll"));
    host.remove();
    expect(r.current()).toBe(777);
    r.dispose();
  });
});

describe("installScrollRestore — the re-assert loop", () => {
  test("a target of 0 is finished by the one synchronous assignment", () => {
    const host = makeHost();
    const r = installScrollRestore(host);
    r.set(5000);

    r.restore(0);

    expect(host.scrollTop).toBe(0);
    // Nothing scheduled: the top cannot be clamped, and a loop here would
    // defend the top against a new search/sort the user is about to scroll.
    expect(rafQueue.size).toBe(0);
    r.dispose();
  });

  test("re-asserts against the clamp bound IN FORCE AT EACH FRAME", () => {
    // The grid is short while thumbnails are still placeholders (max 1200), and
    // grows to its final height a few frames later. A single write would be
    // clamped to 1200 and stay there — this is mechanism 2.
    const host = makeHost({ clientHeight: 800, scrollHeight: 2000 });
    const r = installScrollRestore(host);

    r.restore(9000);
    expect(host.scrollTop).toBe(1200); // clamped by the layout in force NOW

    host.scrollHeight = 12000; // thumbnails landed
    frame();

    expect(host.scrollTop).toBe(9000);
    expect(r.current()).toBe(9000);
    r.dispose();
  });

  test("settles at the bottom when the target is genuinely out of reach", () => {
    // The folder got shorter — files deleted, or a filter narrowed it.
    const host = makeHost({ clientHeight: 800, scrollHeight: 2000 });
    const r = installScrollRestore(host);

    r.restore(9000);
    for (let i = 0; i < SCROLL_RESTORE_FRAMES + 2; i++) frame();

    expect(host.scrollTop).toBe(1200); // the bottom, not a fight
    expect(rafQueue.size).toBe(0); // and nothing left scheduled
    r.dispose();
  });

  test("stops after `frames` frames and leaves nothing scheduled", () => {
    const host = makeHost();
    const r = installScrollRestore(host, { frames: 3 });

    r.restore(5000);
    expect(rafQueue.size).toBe(1);
    frame();
    frame();
    expect(rafQueue.size).toBe(1);
    frame(); // third and last
    expect(rafQueue.size).toBe(0);
    r.dispose();
  });

  test("a detached host ends the loop rather than writing to a dead node", () => {
    const host = makeHost();
    const r = installScrollRestore(host, { frames: 5 });
    r.restore(5000);

    host.remove();
    frame();

    expect(rafQueue.size).toBe(0);
    r.dispose();
  });
});

describe("installScrollRestore — the user outranks a pending restore", () => {
  // Every case here asserts BOTH that the loop stopped AND that the position
  // the user reached survives. Asserting only the first passes against a
  // restorer that cancels and then writes once more.
  for (const ev of ["pointerdown", "wheel", "touchstart"]) {
    test(`${ev} on the scroller ends the restore`, () => {
      const host = makeHost({ clientHeight: 800, scrollHeight: 2000 });
      const r = installScrollRestore(host);
      r.restore(9000);

      host.dispatchEvent(new Event(ev, { bubbles: true }));
      // Cancelled AT THE GESTURE, not merely flagged for the next frame: the
      // flag alone leaves one scheduled callback that will still run against a
      // gesture already in flight. Flag-only leaves this at 1.
      expect(rafQueue.size).toBe(0);

      host.scrollHeight = 12000; // the grid grew, so the loop COULD have won
      frame();

      expect(rafQueue.size).toBe(0);
      expect(host.scrollTop).toBe(1200); // where the gesture left it
      r.dispose();
    });
  }

  test("a frame ALREADY DISPATCHED when the gesture lands still stands down", () => {
    // cancel() removes a callback that is merely queued; the `userTookOver`
    // check in `step` is what covers a frame the engine has already committed
    // to running. Simulated by holding the callback before the gesture (which
    // cancels the queued copy) and invoking it afterwards — the two together
    // are why a flick is never followed by one more corrective write.
    const host = makeHost({ clientHeight: 800, scrollHeight: 2000 });
    const r = installScrollRestore(host);
    r.restore(9000);
    const committed = [...rafQueue.values()][0] as FrameRequestCallback;

    host.dispatchEvent(new Event("wheel"));
    host.scrollHeight = 12000;
    committed(0);

    expect(host.scrollTop).toBe(1200);
    expect(rafQueue.size).toBe(0); // and it did not re-schedule itself either
    r.dispose();
  });

  test("a gesture from a card that stops propagation is still seen (capture)", () => {
    const host = makeHost({ clientHeight: 800, scrollHeight: 2000 });
    const card = document.createElement("div");
    host.appendChild(card);
    card.addEventListener("pointerdown", (e) => e.stopPropagation());
    const r = installScrollRestore(host);
    r.restore(9000);

    card.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    host.scrollHeight = 12000;
    frame();

    expect(rafQueue.size).toBe(0);
    expect(host.scrollTop).toBe(1200);
    r.dispose();
  });

  test("a native scroll key ends the restore — measured to SWALLOW the key otherwise", () => {
    const host = makeHost({ clientHeight: 800, scrollHeight: 2000 });
    const r = installScrollRestore(host);
    r.restore(9000);

    // On `window`, not the host: focus sits on <body>, so a host-level listener
    // never sees the key at all.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
    host.scrollHeight = 12000;
    frame();

    expect(rafQueue.size).toBe(0);
    expect(host.scrollTop).toBe(1200);
    r.dispose();
  });

  test("a key that scrolls NOTHING does not disarm the restore", () => {
    // Space is bound (and preventDefault'd) by packs in this family for the
    // selection toggle. Listing it would drop the restore on a keypress that
    // moves no pixels — the paired positive for the case above.
    const host = makeHost({ clientHeight: 800, scrollHeight: 2000 });
    const r = installScrollRestore(host);
    r.restore(9000);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: " " }));
    host.scrollHeight = 12000;
    frame();

    expect(host.scrollTop).toBe(9000);
    expect(NATIVE_SCROLL_KEYS.has(" ")).toBe(false);
    r.dispose();
  });

  test("a scroll key TYPED IN A FIELD moves the caret, not the view", () => {
    // The packs autofocus a search input, so without this every keystroke of a
    // filter would disarm the restore.
    const host = makeHost({ clientHeight: 800, scrollHeight: 2000 });
    let typing = true;
    const r = installScrollRestore(host, { isTypingTarget: () => typing });
    r.restore(9000);

    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    host.scrollHeight = 12000;
    frame();
    expect(host.scrollTop).toBe(9000); // restore survived

    // …and the same key outside the field does disarm it.
    typing = false;
    r.restore(9000);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    host.scrollTop = 42;
    frame();
    expect(host.scrollTop).toBe(42);
    r.dispose();
  });

  test("the default isTypingTarget reads the focused element", () => {
    const host = makeHost({ clientHeight: 800, scrollHeight: 2000 });
    const input = document.createElement("input");
    document.body.appendChild(input);
    const r = installScrollRestore(host);

    input.focus();
    r.restore(9000);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
    host.scrollHeight = 12000;
    frame();
    expect(host.scrollTop).toBe(9000);

    input.blur();
    r.restore(9000);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "PageDown" }));
    host.scrollTop = 7;
    frame();
    expect(host.scrollTop).toBe(7);
    r.dispose();
  });

  test("a NEW restore re-arms after the user took over", () => {
    const host = makeHost({ clientHeight: 800, scrollHeight: 2000 });
    const r = installScrollRestore(host);
    r.restore(9000);
    host.dispatchEvent(new Event("wheel"));

    // A fresh render is a fresh intent — otherwise one flick would disable
    // restoration for the rest of the modal's life.
    r.restore(9000);
    host.scrollHeight = 12000;
    frame();

    expect(host.scrollTop).toBe(9000);
    r.dispose();
  });
});

describe("installScrollRestore — teardown", () => {
  test("dispose() cancels the loop and drops every listener", () => {
    const host = makeHost({ clientHeight: 800, scrollHeight: 2000 });
    const r = installScrollRestore(host);
    r.restore(9000);

    r.dispose();
    expect(rafQueue.size).toBe(0);

    // Nothing scheduled or subscribed may outlive the modal: a kept keydown
    // listener would cancel restores for a scroller that no longer exists, and
    // a kept scroll listener keeps the detached host alive.
    const parked = r.current(); // 1200 — clamped by the layout in force
    host.scrollTop = 111;
    host.dispatchEvent(new Event("scroll"));
    host.remove();
    // Still the pre-dispose value: the scroll listener is gone, so the move to
    // 111 was never mirrored. With the listener left attached this reads 111.
    expect(r.current()).toBe(parked);
    expect(parked).toBe(1200);

    // And a post-dispose keydown must not throw or resurrect anything.
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "End" }));
  });

  test("cancel() is idempotent", () => {
    const host = makeHost();
    const r = installScrollRestore(host);
    r.restore(5000);
    r.cancel();
    r.cancel();
    expect(rafQueue.size).toBe(0);
    r.dispose();
  });
});

describe("createScrollMemory", () => {
  test("an unvisited location reads 0 — a first visit starts at the top", () => {
    const mem = createScrollMemory();
    expect(mem.get("output:")).toBe(0);
    expect(mem.size).toBe(0);
  });

  test("remembers per key and overwrites in place", () => {
    const mem = createScrollMemory();
    mem.remember("output:2026-08", 3100);
    mem.remember("output:", 40);
    expect(mem.get("output:2026-08")).toBe(3100);
    expect(mem.get("output:")).toBe(40);

    mem.remember("output:2026-08", 0);
    expect(mem.get("output:2026-08")).toBe(0);
    expect(mem.size).toBe(2);
  });

  test("forget() drops a slot so a re-created folder starts at the top", () => {
    const mem = createScrollMemory();
    mem.remember("output:gone", 900);
    mem.forget("output:gone");
    expect(mem.get("output:gone")).toBe(0);
    expect(mem.size).toBe(0);
    // Forgetting an absent key is a no-op, not a throw.
    mem.forget("output:never");
  });
});
