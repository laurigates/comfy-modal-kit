// style-inject.ts — inject a <style> element once, deduped by DOM id.
//
// The "check for the id, create, append" idiom was vendored byte-identically
// across every consuming pack (and twice inside this kit). Deduping by DOM id
// rather than module state makes it naturally cross-bundle safe: each pack
// inlines its own kit copy, but they all share one document, so the second
// pack to call with the same id is a no-op.

/**
 * Inject `css` as a `<style id={id}>` in `document.head`, once. Subsequent
 * calls with the same id are no-ops (even from another pack's inlined kit
 * copy). Safe no-op when DOM is unavailable (node / SSR).
 */
export function ensureStyleOnce(id: string, css: string): void {
  if (typeof document === "undefined") return;
  if (document.getElementById(id)) return;
  const s = document.createElement("style");
  s.id = id;
  s.textContent = css;
  document.head.appendChild(s);
}
