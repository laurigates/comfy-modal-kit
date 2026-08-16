// @vitest-environment jsdom
//
// gallery-view-store.test.ts — the flat-view preference and its crashed-load
// breadcrumb. jsdom, because the store is localStorage and nothing else.
//
// TIER DISCIPLINE (.claude/rules/modal-pack-test-tiers.md): everything here is
// bookkeeping, which is the one thing jsdom CAN answer honestly — its
// localStorage is a real Storage implementation, not a stub.
//
// WHAT THIS TIER CANNOT ASSERT:
//   - That a flat load over a large tree actually kills the tab. The breadcrumb
//     exists for a failure mode with no test at any tier here; it was observed
//     on the GPU box against a real output tree.
//   - That a pack raises the breadcrumb before its load and clears it after the
//     grid paints. The ORDER is the pack's wiring, not the store's — a pack that
//     never calls markPending gets a store that works and a trap that stays.

import { beforeEach, describe, expect, test, vi } from "vitest";

import { createViewStore } from "../src/gallery-file.js";

const GL = "comfyui-gallery-loader";
const IB = "comfyui-image-browser";

beforeEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("createViewStore — round trip", () => {
  test("saves and reads back both modes", () => {
    // Two-sided: a store hard-wired to answer "folder" passes the first half
    // and fails the second.
    const s = createViewStore(GL);
    s.save("flat");
    expect(s.load()).toEqual({ mode: "flat", recovered: false });
    s.save("folder");
    expect(s.load()).toEqual({ mode: "folder", recovered: false });
  });

  test("never written reads as folder", () => {
    expect(createViewStore(GL).load()).toEqual({ mode: "folder", recovered: false });
  });

  test("a stale or hand-edited value falls back to folder", () => {
    // Whitelist on read: only the literal "flat" turns flat view on, so a value
    // left by an older build cannot reach the listing as an unknown mode.
    localStorage.setItem(`${GL}:view`, "FLAT");
    expect(createViewStore(GL).load().mode).toBe("folder");
    localStorage.setItem(`${GL}:view`, "flat");
    expect(createViewStore(GL).load().mode).toBe("flat");
  });
});

describe("createViewStore — the namespace is the whole reason this is a factory", () => {
  test("two packs' stores do not see each other's preference", () => {
    // The load-bearing assertion of the extraction. Hard-coding either pack's
    // key would make the OTHER pack, on adoption, read a key it never wrote —
    // the user's stored preference silently orphaned with the UI looking fine.
    const gl = createViewStore(GL);
    const ib = createViewStore(IB);
    gl.save("flat");
    expect(gl.load().mode).toBe("flat");
    expect(ib.load().mode).toBe("folder");
    ib.save("flat");
    gl.save("folder");
    expect(ib.load().mode).toBe("flat");
    expect(gl.load().mode).toBe("folder");
  });

  test("the keys are the ones the packs already shipped", () => {
    // Adoption must find the value the pack's own code wrote before the bump.
    // Asserting the literal is what makes that a contract rather than a hope.
    const gl = createViewStore(GL);
    gl.save("flat");
    gl.markPending(true);
    expect(localStorage.getItem("comfyui-gallery-loader:view")).toBe("flat");
    expect(localStorage.getItem("comfyui-gallery-loader:view-pending")).toBe("1");
    localStorage.clear();
    const ib = createViewStore(IB);
    ib.save("flat");
    ib.markPending(true);
    expect(localStorage.getItem("comfyui-image-browser:view")).toBe("flat");
    expect(localStorage.getItem("comfyui-image-browser:view-pending")).toBe("1");
  });

  test("markPending is namespaced too — one pack's crash does not recover the other", () => {
    const gl = createViewStore(GL);
    const ib = createViewStore(IB);
    gl.save("flat");
    ib.save("flat");
    gl.markPending(true);
    expect(ib.load()).toEqual({ mode: "flat", recovered: false });
    expect(gl.load()).toEqual({ mode: "folder", recovered: true });
  });
});

describe("createViewStore — the crashed-flat-load breadcrumb", () => {
  test("a breadcrumb still raised at open forces folder view and says so", () => {
    const s = createViewStore(GL);
    s.save("flat");
    s.markPending(true);
    expect(s.load()).toEqual({ mode: "folder", recovered: true });
  });

  test("recovery is ONE-SHOT: it rewrites the preference, so the next open is clean", () => {
    // Without the rewrite the persisted "flat" survives and every subsequent
    // open recovers again — the user is told something went wrong forever, and
    // a genuinely wanted flat view can never be re-enabled from a cold start.
    const s = createViewStore(GL);
    s.save("flat");
    s.markPending(true);
    expect(s.load().recovered).toBe(true);
    expect(s.load()).toEqual({ mode: "folder", recovered: false });
    expect(localStorage.getItem(`${GL}:view`)).toBe("folder");
    expect(localStorage.getItem(`${GL}:view-pending`)).toBe(null);
  });

  test("a cleared breadcrumb leaves the flat preference alone", () => {
    // The two-sided half of the recovery case: a completed flat load must
    // reopen flat, not be recovered out of the mode the user chose.
    const s = createViewStore(GL);
    s.save("flat");
    s.markPending(true);
    s.markPending(false);
    expect(s.load()).toEqual({ mode: "flat", recovered: false });
  });
});

describe("createViewStore — storage that throws", () => {
  // Substitutes the whole global rather than spying on Storage.prototype: under
  // the Node-22+ shim in tests/setup-jsdom.ts the global is not necessarily a
  // Storage instance, so a prototype spy would silently intercept nothing and
  // these tests would pass without ever entering the catch.
  const throwing = (): Storage =>
    ({
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
      clear: () => {
        throw new Error("SecurityError");
      },
    }) as Storage;

  test("the substitution really throws — otherwise these two assert nothing", () => {
    // The control. Without it, a stub that quietly worked would make both cases
    // below pass against a store with no try/catch at all.
    vi.stubGlobal("localStorage", throwing());
    expect(() => localStorage.getItem("x")).toThrow();
    expect(() => localStorage.setItem("x", "y")).toThrow();
    vi.unstubAllGlobals();
  });

  test("a throwing read answers folder rather than taking the modal down", () => {
    // Private mode and disabled storage throw on read as well as write. Losing
    // a view preference is survivable; an exception out of the open path is not.
    vi.stubGlobal("localStorage", throwing());
    expect(createViewStore(GL).load()).toEqual({ mode: "folder", recovered: false });
    vi.unstubAllGlobals();
  });

  test("a throwing write is swallowed by save and markPending alike", () => {
    vi.stubGlobal("localStorage", throwing());
    const s = createViewStore(GL);
    expect(() => s.save("flat")).not.toThrow();
    expect(() => s.markPending(true)).not.toThrow();
    expect(() => s.markPending(false)).not.toThrow();
    vi.unstubAllGlobals();
  });
});
