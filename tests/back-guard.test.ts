// back-guard.test.ts — history bookkeeping around the modal back button.
// jsdom's history.back() navigates asynchronously, so pushState/back are spied
// and popstate is dispatched by hand; this test is about the ARMING logic, not
// about jsdom's navigation fidelity.
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { installBackGuard } from "../src/back-guard.js";

let pushSpy: ReturnType<typeof vi.spyOn>;
let backSpy: ReturnType<typeof vi.spyOn>;
let disposers: (() => void)[] = [];

const pop = (): void => {
  window.dispatchEvent(new PopStateEvent("popstate"));
};

/** Install and register for teardown — a guard left listening across tests
 *  would answer the NEXT test's popstate too (it does; that was a real
 *  cross-test failure before this helper existed). */
const install = (onBack: () => boolean): (() => void) => {
  const dispose = installBackGuard(onBack);
  disposers.push(dispose);
  return dispose;
};

beforeEach(() => {
  disposers = [];
  pushSpy = vi.spyOn(history, "pushState").mockImplementation(() => {});
  backSpy = vi.spyOn(history, "back").mockImplementation(() => {});
});

afterEach(() => {
  for (const d of disposers) d();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("installBackGuard", () => {
  test("arms a sentinel entry on install", () => {
    install(() => true);
    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy.mock.calls[0]?.[0]).toEqual({ cmpBackGuard: true });
  });

  test("a handled back re-arms and does not tear down", () => {
    const onBack = vi.fn(() => true);
    install(onBack);
    pushSpy.mockClear();

    pop();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledTimes(1); // re-armed

    pop();
    expect(onBack).toHaveBeenCalledTimes(2); // still listening
  });

  test("an unhandled back stops listening", () => {
    const onBack = vi.fn(() => false);
    install(onBack);

    pop();
    expect(onBack).toHaveBeenCalledTimes(1);

    pop();
    expect(onBack).toHaveBeenCalledTimes(1); // listener removed
  });

  test("closing via back does NOT pop again — the sentinel is already consumed", () => {
    // This is the bug the shared bookkeeping exists to prevent: an
    // unconditional history.back() on teardown eats a REAL history entry and
    // navigates the user off ComfyUI, which is what the guard is for.
    const dispose = install(() => false);
    pop();
    expect(backSpy).not.toHaveBeenCalled();

    dispose(); // the caller's onClose still runs
    expect(backSpy).not.toHaveBeenCalled();
  });

  test("closing via the ✕ pops the still-armed sentinel exactly once", () => {
    const dispose = install(() => true);
    dispose();
    expect(backSpy).toHaveBeenCalledTimes(1);

    dispose(); // idempotent
    expect(backSpy).toHaveBeenCalledTimes(1);
  });

  test("re-entrant dispose from inside onBack is safe", () => {
    // The realistic shape: onBack calls modal.close(), whose onClose calls the
    // disposer, all while still inside the popstate handler.
    let dispose: () => void = () => {};
    const onBack = vi.fn(() => {
      dispose();
      return false;
    });
    dispose = install(onBack);

    expect(() => pop()).not.toThrow();
    expect(backSpy).not.toHaveBeenCalled();
    pop();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test("after disposal the listener is gone", () => {
    const onBack = vi.fn(() => true);
    const dispose = install(onBack);
    dispose();
    pop();
    expect(onBack).not.toHaveBeenCalled();
  });

  test("a throwing handler is contained and treated as unhandled", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const onBack = vi.fn(() => {
      throw new Error("boom");
    });
    install(onBack);

    expect(() => pop()).not.toThrow();
    expect(err).toHaveBeenCalled();
    pop();
    expect(onBack).toHaveBeenCalledTimes(1); // torn down, not left half-armed
  });

  test("no window (node / SSR): returns a callable no-op", () => {
    vi.stubGlobal("window", undefined);
    let dispose: (() => void) | undefined;
    expect(() => {
      dispose = installBackGuard(() => true);
    }).not.toThrow();
    expect(() => dispose?.()).not.toThrow();
  });
});
