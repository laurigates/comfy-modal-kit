// scroll-restore.ts — put a scroller back where the user left it, and make it
// STICK.
//
// Restoring a remembered offset is not one assignment. Four separate things
// break `host.scrollTop = n`, all measured in Chromium at a phone viewport
// while this mechanism lived in comfyui-image-browser:
//
//  1. THE READ AT CLOSE IS TAKEN FROM A DETACHED ELEMENT. The shell removes
//     the dialog and only THEN calls `onClose`, so a consumer remembering the
//     offset there reads a node that is out of the document — which every real
//     engine answers with 0. Measured: parked at 31185, the one read during
//     close reported `{value: 0, connected: false}`, so the memory stored 0 and
//     no later restore could undo it. The position was never SAVED, not lost.
//     Hence the passive mirror below, and `current()` rather than `.scrollTop`.
//  2. `scrollTop = n` CLAMPS to `scrollHeight - clientHeight` at the instant of
//     assignment, silently. Measured: 162370 requested on a 62370-max scroller
//     reads back 62370 in the same statement. A single write is therefore only
//     as good as the layout in force at that moment — and a grid of lazy
//     thumbnails has not reached its final height yet.
//  3. Momentum scrolling. iOS keeps decelerating a fling after the finger is
//     up, and an assignment mid-deceleration is unreliable. DEFENSIVE AND
//     UNVERIFIED: the browser suites behind this code are Chromium-only
//     (`-webkit-overflow-scrolling: touch` is inert outside WebKit), so the
//     re-assert loop is hardening against a reported behaviour, not something
//     measured here. It is free in Chromium — the loop finds the offset already
//     correct and writes nothing.
//  4. A restore that outlives the user's next gesture is worse than no restore.
//     A wrong offset is a nuisance; a scroller that fights a finger is broken.
//
// Hence: assign synchronously (the common case, and the one a lazy-media
// observer installed afterwards must see), then re-assert for a BOUNDED number
// of frames against the clamp bound in force at each of them, and stand down
// the moment the user touches the scroller.
//
// jsdom can see none of this. It performs no layout, so it accepts
// `scrollTop = 500` on a zero-height scroller and reads it back verbatim —
// detached or not. A jsdom test of this module can assert the BOOKKEEPING (what
// was stored, what was cancelled) and nothing else; clamping, the detached read
// and the re-assert loop belong to a real-browser tier.

/** Options for {@link installScrollRestore}. */
export interface ScrollRestoreOptions {
  /**
   * Frames a restore keeps re-asserting for. Default 12 (~200 ms at 60 Hz).
   *
   * BOUNDED on purpose: an open-ended loop (or an interval) would outlive the
   * modal the way a leaked IntersectionObserver does. Raise it only for a
   * deliberate reason — a browser test throttling the renderer, say — never to
   * paper over a layout that settles late.
   */
  frames?: number;
  /**
   * True while the user is typing, so a caret key is not mistaken for a scroll
   * gesture. Defaults to "the active element is a text field".
   *
   * A pack whose modal autofocuses a search field MUST get this right: without
   * it, every keystroke of a filter disarms the pending restore.
   */
  isTypingTarget?: () => boolean;
  /**
   * Where to listen for native scroll keys. Default `window`.
   *
   * Deliberately not the scroller: focus usually sits on `<body>`, so a
   * host-level keydown listener never sees the key at all.
   */
  keyTarget?: Pick<EventTarget, "addEventListener" | "removeEventListener">;
}

/** Handle returned by {@link installScrollRestore}. */
export interface ScrollRestorer {
  /** The scroller this restorer is bound to. */
  readonly host: HTMLElement;
  /**
   * Honest read of where the view is.
   *
   * While the host is in the document the element is the truth (and refreshes
   * the mirror); once detached — the close path, mechanism 1 above — only the
   * mirror is. **Use this on every read**, never `host.scrollTop`.
   */
  current(): number;
  /**
   * Assign an offset and record what the engine actually kept.
   *
   * Reads back rather than trusting the value passed: this is where a clamp
   * becomes visible, and the mirror must hold what the engine kept, not what
   * was asked for.
   */
  set(top: number): void;
  /**
   * Put the scroller at `target` and defend it for {@link
   * ScrollRestoreOptions.frames} frames.
   *
   * Contract:
   *  - the first assignment is SYNCHRONOUS, so callers — and any lazy-media
   *    observer installed after it — see the final viewport immediately;
   *  - `target <= 0` is finished by that one assignment: the top cannot be
   *    clamped and needs no defending (a new search, a new sort and a
   *    first visit to a folder all land at the top and must STAY there);
   *  - otherwise the offset is re-asserted once per frame, each time against
   *    the clamp bound in force at THAT frame;
   *  - a target that is genuinely out of reach — the folder got shorter
   *    because files were deleted, or a filter narrowed it — settles at the
   *    bottom rather than fighting for an offset that no longer exists;
   *  - any user input that scrolls, and the host detaching, end it early; and
   *    nothing is left scheduled afterwards either way.
   */
  restore(target: number): void;
  /** Stop a pending re-assert loop. Idempotent. */
  cancel(): void;
  /**
   * Refresh the mirror from the live element.
   *
   * Needed by any scroll mutator that bypasses {@link ScrollRestorer.set} —
   * `scrollIntoView()` is the usual one. The `scroll` event that would
   * otherwise refresh the mirror is dispatched at the frame's RENDERING step,
   * i.e. AFTER that frame's input events, so a close in the same frame (key
   * autorepeat plus a tap on ✕, or any long frame while thumbnails decode)
   * would remember a stale mirror: measured 12279 on screen, 0 stored.
   */
  sync(): void;
  /**
   * Drop every listener and cancel any pending loop.
   *
   * Call from the modal's `onClose`. Nothing scheduled or subscribed may
   * outlive the modal — the same rule the lazy-media observer follows.
   */
  dispose(): void;
}

/** Default for {@link ScrollRestoreOptions.frames} — ~200 ms at 60 Hz. */
export const SCROLL_RESTORE_FRAMES = 12;

/**
 * Keys that scroll a scroller natively.
 *
 * A keyboard scroll produces NONE of the pointer events, so without this the
 * re-assert loop fights it — and measurably does not merely delay the keypress
 * but swallows it: End pressed inside the restore window left the offset pinned
 * at the remembered 31185 across 8 samples spanning ~360 ms, while the
 * identical press once the window had expired reached the bottom at 62370.
 *
 * `Space` is absent on purpose. Packs in this family bind it (selection toggle)
 * and `preventDefault` it, so it scrolls nothing; listing it would disarm a
 * restore on a keypress that moves nothing. A pack that does NOT claim Space
 * can pass its own key set through `isTypingTarget` logic instead — or simply
 * accept that one key.
 */
export const NATIVE_SCROLL_KEYS: ReadonlySet<string> = new Set([
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

const GESTURE_EVENTS = ["pointerdown", "wheel", "touchstart"] as const;

function defaultIsTypingTarget(): boolean {
  const el = typeof document === "undefined" ? null : document.activeElement;
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/**
 * Bind a restorer to the element that actually SCROLLS.
 *
 * As with `installLazyMedia`'s `root`, the host must be the element carrying
 * the overflow clip — a modal shell's `.cmp-body`, or an inline grid that is
 * its own scroller. There is no default and no ancestor walk: only the call
 * site knows, and a helper that guessed would hide the mistake.
 */
export function installScrollRestore(
  host: HTMLElement,
  opts?: ScrollRestoreOptions,
): ScrollRestorer {
  const frames = Math.max(0, opts?.frames ?? SCROLL_RESTORE_FRAMES);
  const isTyping = opts?.isTypingTarget ?? defaultIsTypingTarget;
  const keyTarget = opts?.keyTarget ?? (typeof window === "undefined" ? null : window);

  // Mirror of host.scrollTop. The scroller keeps it fresh itself — `scroll`
  // fires for touch, wheel, keyboard and programmatic movement alike — so it is
  // still valid at teardown, when the element has already been detached and
  // answers 0.
  let liveScrollTop = 0;
  // Set by a user gesture: the user has taken the scroller, so a pending
  // restore stops re-asserting.
  let userTookOver = false;
  let raf = 0;

  const onScroll = (): void => {
    liveScrollTop = host.scrollTop;
  };
  host.addEventListener("scroll", onScroll, { passive: true });

  function cancel(): void {
    if (raf !== 0) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  }

  // The user's input outranks a pending restore, unconditionally. Cancel as
  // well as flag: `step` checks the flag, but it only gets to check it on the
  // NEXT frame, and one re-assert against a gesture already in flight is one
  // too many.
  function yieldScroller(): void {
    userTookOver = true;
    cancel();
  }

  for (const ev of GESTURE_EVENTS) {
    // Capture, so a card handler that stops propagation cannot hide the
    // gesture; passive, so registering on the scroller never costs the engine
    // its fast path (nothing here calls preventDefault).
    host.addEventListener(ev, yieldScroller, { passive: true, capture: true });
  }

  const onKey = (e: Event): void => {
    const key = (e as KeyboardEvent).key;
    // In a text field these keys move the caret, not the view.
    if (!NATIVE_SCROLL_KEYS.has(key) || isTyping()) return;
    yieldScroller();
  };
  keyTarget?.addEventListener("keydown", onKey, true);

  function current(): number {
    if (host.isConnected) liveScrollTop = host.scrollTop;
    return liveScrollTop;
  }

  function set(top: number): void {
    host.scrollTop = top;
    liveScrollTop = host.scrollTop;
  }

  function restore(target: number): void {
    cancel();
    userTookOver = false;
    set(target);
    if (target <= 0) return;
    // No layout box (jsdom, or a scroller that is not rendered) → nothing
    // clamps and there are no frames to correct in; the assignment above is the
    // whole behaviour, which is what keeps a bookkeeping test meaningful.
    if (typeof requestAnimationFrame !== "function" || host.clientHeight <= 0) return;
    if (frames <= 0) return;
    let n = 0;
    const step = (): void => {
      raf = 0;
      if (userTookOver || !host.isConnected) return;
      const max = Math.max(0, host.scrollHeight - host.clientHeight);
      const reachable = Math.min(target, max);
      // Sub-pixel differences are the engine's own rounding on a fractional
      // scroll position, not a lost restore — writing them back would fight the
      // compositor for nothing.
      if (Math.abs(host.scrollTop - reachable) > 1) set(reachable);
      if (++n >= frames) return;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  return {
    host,
    current,
    set,
    restore,
    cancel,
    sync(): void {
      liveScrollTop = host.scrollTop;
    },
    dispose(): void {
      cancel();
      host.removeEventListener("scroll", onScroll);
      for (const ev of GESTURE_EVENTS) {
        host.removeEventListener(ev, yieldScroller, true);
      }
      keyTarget?.removeEventListener("keydown", onKey, true);
    },
  };
}

/**
 * Per-location scroll offsets: "return each folder to where I left it".
 *
 * Hold ONE of these at MODULE scope, not per modal — that is what makes
 * closing and reopening the modal resume in place. It is deliberately NOT
 * persisted: an offset measured against a listing that may have changed while
 * the page was gone is a guess, and a page reload is a natural place to start
 * at the top.
 *
 * The key is the caller's business, but it must name every dimension that
 * changes the LIST: the root, the folder, and any view mode or filter that
 * makes the same folder a different (usually much shorter) listing. Sharing a
 * slot between two such listings restores an offset measured against the wrong
 * content height.
 */
export interface ScrollMemory {
  /** The remembered offset, or 0 for a location never visited. */
  get(key: string): number;
  /** Store `top` for `key`. Call BEFORE the location changes. */
  remember(key: string, top: number): void;
  /** Drop a slot — e.g. its folder was deleted, renamed or moved away. */
  forget(key: string): void;
  /** Slots currently held. For tests and diagnostics. */
  readonly size: number;
}

/** Create a {@link ScrollMemory}. */
export function createScrollMemory(): ScrollMemory {
  const slots = new Map<string, number>();
  return {
    get(key: string): number {
      return slots.get(key) ?? 0;
    },
    remember(key: string, top: number): void {
      slots.set(key, top);
    },
    forget(key: string): void {
      slots.delete(key);
    },
    get size(): number {
      return slots.size;
    },
  };
}
