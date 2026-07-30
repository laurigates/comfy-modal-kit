// modal-chrome.test.ts — the chrome registry's DOM-free contract.
//
// Deliberately NOT annotated with an environment: the registry runs on every
// pointerdown and must be robust with no `window`/`document` at all (SSR-ish
// import, a pack imported into a node test harness), and the guard install must
// stay a no-op there. The DOM-backed exemption behaviour lives in
// modal-coordinator.test.ts under jsdom.

import { describe, expect, test } from "vitest";

import { getKit } from "../src/kit-global.js";
import {
  installPointerGuard,
  isModalChrome,
  registerModalChrome,
  unregisterModalChrome,
} from "../src/modal-coordinator.js";

describe("isModalChrome without a DOM", () => {
  test("null and a shapeless node are simply not chrome (no throw)", () => {
    expect(isModalChrome(null)).toBe(false);
    expect(() => isModalChrome({} as Node)).not.toThrow();
    expect(isModalChrome({} as Node)).toBe(false);
  });
});

describe("installPointerGuard outside a browser", () => {
  test("is a no-op and leaves the shared flag unset", () => {
    expect(typeof window).toBe("undefined"); // the point of the node env here
    installPointerGuard();
    expect(getKit().pointerGuardInstalled).toBeFalsy();
  });
});

describe("chrome registry", () => {
  test("is DOM-shape-agnostic: anything with contains() participates", () => {
    const needle = { nodeType: 1 } as unknown as Node;
    const stub = {
      contains: (n: Node) => n === needle,
      setAttribute: () => {},
    } as unknown as HTMLElement;

    registerModalChrome(stub);
    expect(isModalChrome(needle)).toBe(true);

    unregisterModalChrome(stub);
    expect(isModalChrome(needle)).toBe(false);
  });

  test("registering twice does not duplicate, so one unregister fully clears it", () => {
    const needle = { nodeType: 1 } as unknown as Node;
    const stub = {
      contains: (n: Node) => n === needle,
      setAttribute: () => {},
    } as unknown as HTMLElement;

    registerModalChrome(stub);
    registerModalChrome(stub);
    expect(getKit().modalChrome.filter((el) => el === stub)).toHaveLength(1);
    unregisterModalChrome(stub);
    expect(isModalChrome(needle)).toBe(false);
  });
});
