// model-picker-registry.test.ts — coverage for the cross-pack model-picker
// registry. Pure logic, no DOM, so it runs in the default node env.
//
// The registry lives on the shared runtime rendezvous (a Symbol.for-keyed
// global), so each test clears the picker list first to stay isolated.

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  getModelPickers,
  type ModelPicker,
  type ModelPickerControl,
  registerModelPicker,
  resolveModelPicker,
} from "../src/model-picker-registry.js";

// A trivial control factory — the registry never calls create() during
// resolution, so a stub el suffices for the picker shape.
const control = (): ModelPickerControl => ({
  el: {} as HTMLElement,
  getValue: () => "",
  hasChanged: () => false,
});

const picker = (id: string, supports: ModelPicker["supports"], priority?: number): ModelPicker => ({
  id,
  priority,
  supports,
  create: control,
});

function clearPickers(): void {
  // getModelPickers returns the live array reference on the shared runtime.
  const list = getModelPickers() as ModelPicker[];
  list.length = 0;
}

beforeEach(clearPickers);

describe("registerModelPicker", () => {
  test("registers a picker so it becomes resolvable", () => {
    registerModelPicker(picker("gallery", (c) => c === "loras"));
    expect(getModelPickers()).toHaveLength(1);
    expect(resolveModelPicker("loras")?.id).toBe("gallery");
  });

  test("is idempotent by id — re-register replaces in place, no duplicates", () => {
    registerModelPicker(picker("gallery", () => false));
    registerModelPicker(picker("gallery", (c) => c === "loras"));
    expect(getModelPickers()).toHaveLength(1);
    // The replacement's supports() wins.
    expect(resolveModelPicker("loras")?.id).toBe("gallery");
  });
});

describe("resolveModelPicker", () => {
  test("returns null when nothing matches (additive-fallback contract)", () => {
    registerModelPicker(picker("gallery", (c) => c === "loras"));
    expect(resolveModelPicker("checkpoints")).toBeNull();
  });

  test("returns null when nothing is registered at all", () => {
    expect(resolveModelPicker("loras")).toBeNull();
  });

  test("highest priority wins among multiple matches", () => {
    registerModelPicker(picker("low", () => true, 1));
    registerModelPicker(picker("high", () => true, 10));
    registerModelPicker(picker("mid", () => true, 5));
    expect(resolveModelPicker("loras")?.id).toBe("high");
  });

  test("ties resolve to the earliest registered", () => {
    registerModelPicker(picker("first", () => true, 5));
    registerModelPicker(picker("second", () => true, 5));
    expect(resolveModelPicker("loras")?.id).toBe("first");
  });

  test("missing priority is treated as 0", () => {
    registerModelPicker(picker("default", () => true));
    registerModelPicker(picker("negative", () => true, -1));
    expect(resolveModelPicker("loras")?.id).toBe("default");
  });

  test("a supports() that throws is swallowed and treated as no-match", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerModelPicker(
      picker("boom", () => {
        throw new Error("picker exploded");
      }),
    );
    registerModelPicker(picker("safe", (c) => c === "loras"));
    // The throwing picker does not break resolution; the safe one still wins.
    expect(resolveModelPicker("loras")?.id).toBe("safe");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test("passes the exact category string through to supports()", () => {
    const seen: string[] = [];
    registerModelPicker(
      picker("spy", (c) => {
        seen.push(c);
        return false;
      }),
    );
    resolveModelPicker("diffusion_models");
    expect(seen).toEqual(["diffusion_models"]);
  });
});

// createSummary is OPTIONAL: a picker that offers no metadata strip and a host
// that never asks for one must each keep working. These pin both halves.
describe("createSummary (optional)", () => {
  test("a picker without createSummary resolves fine and reports it absent", () => {
    registerModelPicker(picker("bare", () => true));
    const p = resolveModelPicker("loras") as ModelPicker;
    expect(p.createSummary).toBeUndefined();
  });

  test("a picker with createSummary receives the category and value", () => {
    let seen: { category: string; value: string } | null = null;
    registerModelPicker({
      ...picker("rich", () => true),
      createSummary: (req) => {
        seen = { ...req };
        return {} as HTMLElement;
      },
    });
    const p = resolveModelPicker("loras") as ModelPicker;
    p.createSummary?.({ category: "loras", value: "flux/realism.safetensors" });
    expect(seen).toEqual({ category: "loras", value: "flux/realism.safetensors" });
  });
});

// The registry shares one runtime object with field-registry. A pack running an
// older inlined kit can create that object before `modelPickers` existed; the
// accessor must backfill rather than hand back undefined.
describe("shared-runtime backfill", () => {
  test("a KitRuntime created without modelPickers is repaired on access", () => {
    const key = Symbol.for("laurigates.comfyModalKit");
    const g = globalThis as unknown as Record<symbol, Record<string, unknown> | undefined>;
    const saved = g[key];
    // Simulate an older pack's inlined kit constructing the rendezvous.
    g[key] = { fieldProviders: [], activeModal: null, pointerClaim: null };
    try {
      expect(() => registerModelPicker(picker("gallery", () => true))).not.toThrow();
      expect(resolveModelPicker("loras")?.id).toBe("gallery");
    } finally {
      g[key] = saved;
    }
  });
});
