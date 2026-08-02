// lazy-media.test.ts — the observer contract. Needs a DOM for querySelectorAll
// and element properties; IntersectionObserver is stubbed because jsdom has
// none (which also lets us drive intersections deterministically).
//
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { installLazyMedia } from "../src/lazy-media.js";

interface FakeObserver {
  root: Element | null;
  rootMargin: string | undefined;
  observed: Element[];
  unobserved: Element[];
  disconnected: boolean;
  fire: (els: Element[], isIntersecting?: boolean) => void;
}

let observers: FakeObserver[] = [];

function stubIO(): void {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(
        cb: (entries: { target: Element; isIntersecting: boolean }[]) => void,
        opts?: { root?: Element; rootMargin?: string },
      ) {
        const rec: FakeObserver = {
          root: opts?.root ?? null,
          rootMargin: opts?.rootMargin,
          observed: [],
          unobserved: [],
          disconnected: false,
          fire: (els, isIntersecting = true) =>
            cb(els.map((target) => ({ target, isIntersecting }))),
        };
        observers.push(rec);
        this._rec = rec;
      }
      _rec: FakeObserver;
      observe(el: Element) {
        this._rec.observed.push(el);
      }
      unobserve(el: Element) {
        this._rec.unobserved.push(el);
      }
      disconnect() {
        this._rec.disconnected = true;
      }
    },
  );
}

function mount(html: string): { scroller: HTMLElement; grid: HTMLElement } {
  document.body.innerHTML = `<div id="scroller"><div id="grid">${html}</div></div>`;
  return {
    scroller: document.getElementById("scroller") as HTMLElement,
    grid: document.getElementById("grid") as HTMLElement,
  };
}

beforeEach(() => {
  observers = [];
  stubIO();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("installLazyMedia", () => {
  test("observes every data-src element against the given root", () => {
    const { scroller, grid } = mount(
      `<img data-src="a.png"><img data-src="b.png"><video data-src="c.mp4"></video>`,
    );
    installLazyMedia(grid, { root: scroller });

    expect(observers).toHaveLength(1);
    const io = observers[0] as FakeObserver;
    expect(io.observed).toHaveLength(3);
    // The root is the scroller the caller named — never inferred from the
    // container, which is the whole reason the option is required.
    expect(io.root).toBe(scroller);
    expect(io.rootMargin).toBe("300px");
  });

  test("does not fall back to the container when a root is passed", () => {
    const { scroller, grid } = mount(`<img data-src="a.png">`);
    installLazyMedia(grid, { root: scroller });
    expect((observers[0] as FakeObserver).root).not.toBe(grid);
  });

  test("promotes data-src to src on intersection and stops observing", () => {
    const { scroller, grid } = mount(`<img data-src="a.png">`);
    installLazyMedia(grid, { root: scroller });
    const img = grid.querySelector("img") as HTMLImageElement;

    (observers[0] as FakeObserver).fire([img]);

    expect(img.getAttribute("src")).toBe("a.png");
    expect(img.hasAttribute("data-src")).toBe(false);
    expect((observers[0] as FakeObserver).unobserved).toContain(img);
  });

  test("upgrades a video's preload to metadata only when it intersects", () => {
    const { scroller, grid } = mount(`<video data-src="c.mp4" preload="none"></video>`);
    installLazyMedia(grid, { root: scroller });
    const vid = grid.querySelector("video") as HTMLVideoElement;

    expect(vid.preload).toBe("none");
    (observers[0] as FakeObserver).fire([vid]);
    expect(vid.preload).toBe("metadata");
    expect(vid.getAttribute("src")).toBe("c.mp4");
  });

  test("ignores non-intersecting entries", () => {
    const { scroller, grid } = mount(`<img data-src="a.png">`);
    installLazyMedia(grid, { root: scroller });
    const img = grid.querySelector("img") as HTMLImageElement;

    (observers[0] as FakeObserver).fire([img], false);

    expect(img.hasAttribute("src")).toBe(false);
    expect(img.getAttribute("data-src")).toBe("a.png");
  });

  test("the disposer disconnects — this is what stops the per-render leak", () => {
    const { scroller, grid } = mount(`<img data-src="a.png">`);
    const dispose = installLazyMedia(grid, { root: scroller });
    expect((observers[0] as FakeObserver).disconnected).toBe(false);
    dispose();
    expect((observers[0] as FakeObserver).disconnected).toBe(true);
  });

  test("a second install does not implicitly dispose the first (caller's job)", () => {
    const { scroller, grid } = mount(`<img data-src="a.png">`);
    const dispose1 = installLazyMedia(grid, { root: scroller });
    installLazyMedia(grid, { root: scroller });
    expect(observers).toHaveLength(2);
    dispose1();
    expect((observers[0] as FakeObserver).disconnected).toBe(true);
    expect((observers[1] as FakeObserver).disconnected).toBe(false);
  });

  test("honours rootMargin and selector overrides", () => {
    const { scroller, grid } = mount(`<img data-src="a.png"><img class="skip" data-src="b.png">`);
    installLazyMedia(grid, {
      root: scroller,
      rootMargin: "50px",
      selector: "img[data-src]:not(.skip)",
    });
    const io = observers[0] as FakeObserver;
    expect(io.rootMargin).toBe("50px");
    expect(io.observed).toHaveLength(1);
  });

  test("no matching elements: no observer, disposer is still callable", () => {
    const { scroller, grid } = mount(`<img src="already.png">`);
    const dispose = installLazyMedia(grid, { root: scroller });
    expect(observers).toHaveLength(0);
    expect(() => dispose()).not.toThrow();
  });

  test("no IntersectionObserver: no-op disposer instead of a throw", () => {
    const { scroller, grid } = mount(`<img data-src="a.png">`);
    vi.stubGlobal("IntersectionObserver", undefined);
    let dispose: (() => void) | undefined;
    expect(() => {
      dispose = installLazyMedia(grid, { root: scroller });
    }).not.toThrow();
    expect(() => dispose?.()).not.toThrow();
    // Nothing was promoted — the caller degrades to unloaded media, not a crash.
    expect(grid.querySelector("img")?.hasAttribute("src")).toBe(false);
  });
});
