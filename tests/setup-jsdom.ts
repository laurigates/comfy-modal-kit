// Vitest setup: restore `localStorage` in the jsdom-environment files.
//
// Node 22+ defines its OWN global `localStorage` accessor, which evaluates to
// `undefined` unless the process was started with `--localstorage-file`. Vitest
// populates the jsdom window's properties onto `globalThis` but SKIPS any name
// already defined there — so jsdom's real Storage never lands, and a jsdom test
// file dies on the first access:
//
//     TypeError: Cannot read properties of undefined (reading 'clear')
//
// Observed here on Node v26.5.0 with vitest 4.1.8 / jsdom 29, the first time
// this kit needed localStorage under jsdom (the flat-view store). The identical
// shim already ships in comfyui-gallery-loader (tests/js/setup-jsdom.js), which
// hit it first.
//
// A browser always has localStorage, so installing a Storage-shaped shim
// restores the environment the packs actually run in rather than papering over
// a behaviour difference. It runs for the node-environment files too, where it
// is inert: nothing under `environment: "node"` in this suite touches storage,
// and a test that wants a THROWING storage substitutes its own global rather
// than relying on this one's shape.

if (typeof globalThis.localStorage === "undefined") {
  const makeStorage = (): Storage => {
    const map = new Map<string, string>();
    return {
      get length() {
        return map.size;
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => (map.has(String(k)) ? (map.get(String(k)) as string) : null),
      setItem: (k: string, v: string) => {
        map.set(String(k), String(v));
      },
      removeItem: (k: string) => {
        map.delete(String(k));
      },
      clear: () => {
        map.clear();
      },
    } as Storage;
  };
  for (const name of ["localStorage", "sessionStorage"]) {
    Object.defineProperty(globalThis, name, {
      value: makeStorage(),
      configurable: true,
      writable: true,
    });
  }
}
