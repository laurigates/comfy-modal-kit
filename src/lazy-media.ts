// lazy-media.ts — defer <img>/<video> loading until the element scrolls near
// the viewport, via one IntersectionObserver per render.
//
// Three packs carried a copy of this (comfyui-image-browser, and both of
// comfyui-gallery-loader's surfaces) and every difference between them was a
// defect: one leaked an observer per render — each leaked observer still
// holding every detached card — and one never grew the <video> branch. The one
// legitimate difference is the root, and that is a parameter, not a model.
//
// WHY `root` IS REQUIRED, WITH NO DEFAULT AND NO ANCESTOR-WALK FALLBACK:
// the root must be the element that actually SCROLLS. Rooting on a container
// with no overflow clip makes the root rectangle that container's whole
// bounding box, so every element reports as intersecting on the first callback
// and the "lazy" load fires for the entire listing at once — one request per
// file plus a live <video> per clip. Measured in comfyui-image-browser: 400/400
// off-screen cards intersect with the grid as root vs 20/400 with the real
// scroller. That is survivable in a folder view of tens of files and OOMs the
// tab in a flat view of thousands.
//
// Both packs got this wrong once, and the two surfaces genuinely differ — the
// modal picker's grid sits inside the shell's `.cmp-body`, while the inline
// node grid IS its own scroller. Only the call site knows. A helper that
// guessed would hide the third occurrence behind a shared abstraction where it
// is harder to see, so this one stays explicit.

/** Options for {@link installLazyMedia}. */
export interface LazyMediaOptions {
  /**
   * REQUIRED. The element that actually scrolls — never the grid unless the
   * grid itself has the overflow clip. See the note above; this is not a
   * stylistic choice.
   */
  root: Element;
  /** Margin around the root when computing intersections. Default "300px". */
  rootMargin?: string;
  /** What to observe. Default `"img[data-src], video[data-src]"`. */
  selector?: string;
}

const DEFAULT_SELECTOR = "img[data-src], video[data-src]";

/**
 * Observe `data-src` media under `container` and promote each to `src` as it
 * comes within `rootMargin` of `root`, then stop observing it.
 *
 * A `<video>` is additionally switched from `preload="none"` to
 * `preload="metadata"` at that point, so an off-screen clip costs nothing.
 *
 * Returns a disposer. **Call it before the next render** (or on teardown) —
 * dropping the reference without disposing leaks an observer that still
 * references every card it was watching. Where there is no
 * `IntersectionObserver` (node, jsdom without a stub) nothing is observed and
 * the disposer is a no-op, so callers need no environment guard of their own.
 */
export function installLazyMedia(container: Element, opts: LazyMediaOptions): () => void {
  const noop = () => {};
  if (typeof IntersectionObserver === "undefined") return noop;
  const els = container.querySelectorAll(opts.selector ?? DEFAULT_SELECTOR);
  if (!els.length) return noop;

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        const el = e.target as HTMLImageElement | HTMLVideoElement;
        const src = (el as HTMLElement).dataset.src;
        if (src) {
          if (el.tagName === "VIDEO") (el as HTMLVideoElement).preload = "metadata";
          el.src = src;
          el.removeAttribute("data-src");
        }
        io.unobserve(el);
      }
    },
    { root: opts.root, rootMargin: opts.rootMargin ?? "300px" },
  );
  for (const el of els) io.observe(el);
  return () => io.disconnect();
}
