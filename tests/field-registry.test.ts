// field-registry.test.ts — coverage for the cross-pack field-provider
// registry. Pure logic, no DOM, so it runs in the default node env.
//
// The registry lives on the shared runtime rendezvous (a Symbol.for-keyed
// global), so each test clears the provider list first to stay isolated.

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  type FieldControl,
  type FieldProvider,
  type FieldWidgetLike,
  getFieldProviders,
  registerFieldProvider,
  resolveFieldProvider,
} from "../src/field-registry.js";

// A trivial control factory — the registry never calls create() during
// resolution, so a stub el suffices for the provider shape.
const control = (): FieldControl => ({
  el: {} as HTMLElement,
  getValue: () => null,
  hasChanged: () => false,
});

const provider = (id: string, match: FieldProvider["match"], priority?: number): FieldProvider => ({
  id,
  priority,
  match,
  create: control,
});

const widget = (name: string): FieldWidgetLike => ({ name });

function clearProviders(): void {
  // getFieldProviders returns the live array reference on the shared runtime.
  const list = getFieldProviders() as FieldProvider[];
  list.length = 0;
}

beforeEach(clearProviders);

describe("registerFieldProvider", () => {
  test("registers a provider so it becomes resolvable", () => {
    registerFieldProvider(provider("seed", (w) => w.name === "seed"));
    expect(getFieldProviders()).toHaveLength(1);
    expect(resolveFieldProvider(widget("seed"), null)?.id).toBe("seed");
  });

  test("is idempotent by id — re-register replaces in place, no duplicates", () => {
    registerFieldProvider(provider("seed", () => false));
    registerFieldProvider(provider("seed", (w) => w.name === "seed"));
    expect(getFieldProviders()).toHaveLength(1);
    // The replacement's match wins.
    expect(resolveFieldProvider(widget("seed"), null)?.id).toBe("seed");
  });
});

describe("resolveFieldProvider", () => {
  test("returns null when nothing matches (additive-fallback contract)", () => {
    registerFieldProvider(provider("seed", (w) => w.name === "seed"));
    expect(resolveFieldProvider(widget("sampler_name"), null)).toBeNull();
  });

  test("highest priority wins among multiple matches", () => {
    registerFieldProvider(provider("low", () => true, 1));
    registerFieldProvider(provider("high", () => true, 10));
    registerFieldProvider(provider("mid", () => true, 5));
    expect(resolveFieldProvider(widget("seed"), null)?.id).toBe("high");
  });

  test("ties resolve to the earliest registered", () => {
    registerFieldProvider(provider("first", () => true, 5));
    registerFieldProvider(provider("second", () => true, 5));
    expect(resolveFieldProvider(widget("seed"), null)?.id).toBe("first");
  });

  test("missing priority is treated as 0", () => {
    registerFieldProvider(provider("default", () => true));
    registerFieldProvider(provider("negative", () => true, -1));
    expect(resolveFieldProvider(widget("seed"), null)?.id).toBe("default");
  });

  test("a match() that throws is swallowed and treated as no-match", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerFieldProvider(
      provider("boom", () => {
        throw new Error("provider exploded");
      }),
    );
    registerFieldProvider(provider("safe", (w) => w.name === "seed"));
    // The throwing provider does not break resolution; the safe one still wins.
    expect(resolveFieldProvider(widget("seed"), null)?.id).toBe("safe");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("passes the node through to match()", () => {
    const node = { type: "KSampler" };
    let seen: unknown;
    registerFieldProvider(
      provider("spy", (_w, n) => {
        seen = n;
        return true;
      }),
    );
    resolveFieldProvider(widget("seed"), node);
    expect(seen).toBe(node);
  });
});
