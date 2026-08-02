// escape-html.ts — HTML-escape a value for interpolation into a markup string.
//
// The same twelve-line function was vendored byte-identically (modulo the name
// `escHTML` vs `escapeHTML`) in comfyui-image-browser, comfyui-gallery-loader's
// modal picker, and its inline node grid. There is no model here to diverge —
// it is a string→string map over a fixed five-character set — so it is the
// least controversial thing in the kit.

const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/**
 * Escape `&`, `<`, `>`, `"` and `'` so `s` is safe to interpolate into an
 * HTML string. Non-string input is coerced with `String()`, so `undefined`
 * renders as `"undefined"` rather than throwing — callers that want an empty
 * string for a missing value should use `?? ""` at the call site.
 */
export function escapeHTML(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => ENTITIES[c] as string);
}
