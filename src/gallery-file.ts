// gallery-file.ts — the listing-row shape the gallery packs share, plus the
// sort comparators, the media-extension sets, the address helper, the metadata
// display order and the flat-view preference store built on it.
//
// comfyui-gallery-loader (modal picker + inline node grid) and
// comfyui-image-browser all return the same row from their `/list` endpoints
// and all carried their own byte-identical `sortFiles` — three copies whose
// only difference was a parameter name (`getter` vs `extract`). The rows had
// not diverged, so per ADR-0002 the comparators belong here.
//
// The option LISTS had drifted (8 in the picker, 10 in the node grid), which
// is not a divergence in the model but a live bug waiting to happen: the two
// surfaces share a `:sort` localStorage key, so a preference set in the
// surface with more options is silently rejected by the one with fewer.
// SORT_OPTIONS is the union, and `isValidSort` is the single validator.
//
// WHAT IS AND IS NOT HERE. Everything below was surveyed comment-stripped
// against both packs before being lifted, and only the halves that were already
// equivalent came across. Two neighbours deliberately did NOT:
//
//   - `fetchBasePaths` / `fetchMetadata` — comfyui-image-browser passes
//     `{ cache: "no-cache" }` on four of its fetches and comfyui-gallery-loader
//     passes it on none. That is a real behavioural divergence, not formatting,
//     and which side is right is a decision someone has to make rather than one
//     an extraction should quietly settle. Tracked as a follow-up.
//   - The `safe-tag.ts` write path (`tagRequestBody`, `markSensitiveHTML`).
//     Diverged ON PURPOSE — see the note on `sensitiveKeyword` in safe-view.ts.
//
// Anything a pack's endpoint URL, CSS prefix or storage namespace reaches into
// stays a PARAMETER here. `createViewStore` is the one that matters: hard-coding
// either pack's localStorage key would orphan the other pack's stored
// preference on adoption, which is the exact class of silent breakage the
// extraction exists to prevent.

/** One row of a directory listing, as the gallery packs' `/list` returns it. */
export interface GalleryFile {
  name: string;
  /** Epoch seconds. */
  mtime: number;
  /** Lowercased, leading-dot (".png"). */
  ext?: string;
  /** Bytes. */
  size?: number;
  width?: number;
  height?: number;
  /** 0..5; 0 or absent means unrated. */
  rating?: number;
  /**
   * Present ONLY in a recursive ("flat") listing: the file's directory
   * relative to the requested subfolder, forward-slashed, `""` for a file at
   * the top level. A non-recursive listing omits the key entirely, so
   * `"subpath" in f` distinguishes "top-level file in a flat listing" from
   * "folder listing".
   */
  subpath?: string;
}

/** One entry in a sort `<select>`. */
export interface SortOption {
  /** `"<key>:<dir>"`, e.g. `"mtime:desc"`. */
  value: string;
  label: string;
}

/**
 * The union of the sort orders the gallery surfaces offer, in menu order.
 * Packs build their own `<select>` from this — the kit emits no markup for a
 * control the pack styles.
 */
export const SORT_OPTIONS: readonly SortOption[] = [
  { value: "mtime:desc", label: "Newest" },
  { value: "mtime:asc", label: "Oldest" },
  { value: "name:asc", label: "Name A→Z" },
  { value: "name:desc", label: "Name Z→A" },
  { value: "size:desc", label: "Largest file" },
  { value: "size:asc", label: "Smallest file" },
  { value: "pixels:desc", label: "Largest resolution" },
  { value: "pixels:asc", label: "Smallest resolution" },
  { value: "rating:desc", label: "Highest rating" },
  { value: "rating:asc", label: "Lowest rating" },
];

const VALID_SORTS: ReadonlySet<string> = new Set(SORT_OPTIONS.map((o) => o.value));

/** True if `value` is a `"<key>:<dir>"` this kit's comparators understand. */
export function isValidSort(value: string): boolean {
  return VALID_SORTS.has(value);
}

/**
 * Sort a copy of `files` by `key` (`name` | `size` | `pixels` | `rating`,
 * anything else falls back to `mtime`) in direction `dir` (`"asc"` or, for
 * anything else, descending).
 *
 * Numeric keys tie-break on name so equal-mtime files — a batch render writes
 * many within one clock tick — hold a stable, meaningful order rather than
 * whatever the listing happened to arrive in. Returns a new array; the caller's
 * cached listing is never mutated.
 */
export function sortFiles<T extends GalleryFile>(files: T[], key: string, dir: string): T[] {
  const mul = dir === "asc" ? 1 : -1;
  const nameCmp = (a: T, b: T) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  const numCmp = (extract: (f: T) => number | undefined) => (a: T, b: T) =>
    (extract(a) ?? 0) - (extract(b) ?? 0) || nameCmp(a, b);
  let cmp: (a: T, b: T) => number;
  switch (key) {
    case "name":
      cmp = nameCmp;
      break;
    case "size":
      cmp = numCmp((f) => f.size);
      break;
    case "pixels":
      cmp = numCmp((f) => (f.width && f.height ? f.width * f.height : 0));
      break;
    case "rating":
      cmp = numCmp((f) => f.rating);
      break;
    default:
      cmp = numCmp((f) => f.mtime);
      break;
  }
  return [...files].sort((a, b) => mul * cmp(a, b));
}

// ---------------------------------------------------------------------------
// Media families
// ---------------------------------------------------------------------------

/**
 * Extensions the packs render as a still `<img>`. Lowercased, leading dot.
 *
 * `.gif` is here rather than in {@link VIDEO_EXTS} on purpose: it renders as a
 * still thumbnail, which is correct for a grid even though it animates in a
 * viewer.
 *
 * This is the FRONTEND's notion of "is this an image". A pack's backend has its
 * own list and a pack may narrow this one further (comfyui-image-browser's
 * `META_VIDEO_EXTS` is a deliberate subset of the video set, because only some
 * containers have a metadata reader). Widening either set here widens it for
 * both packs, so add an extension only when both grids can actually render it.
 */
export const IMG_EXTS: ReadonlySet<string> = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".bmp",
  ".tiff",
  ".tif",
  ".avif",
]);

/** Extensions the packs render as a `<video>`. Lowercased, leading dot. */
export const VIDEO_EXTS: ReadonlySet<string> = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".avi",
  ".m4v",
  ".mpg",
  ".mpeg",
]);

/**
 * The three ComfyUI roots a write may target. Both packs' backends restrict
 * `/delete`, `/rename`, `/move`, `/rating` and `/tag` to exactly these, so the
 * frontend gate must name the same three or it ships a control the server 400s.
 *
 * Typed `readonly string[]`, not a literal tuple, because the packs' own
 * location unions are wider and differ (`"path"`, `"pinned"`) — a tuple's
 * `.includes()` would reject their location type outright. Narrowing is the
 * caller's business; agreeing on the three names is the kit's.
 *
 * `"pinned"` is a VIEW, never a root: its grid spans several, so a per-card
 * control there must gate on the CARD's own type, not the location's.
 */
export const SANDBOXED_TYPES: readonly string[] = ["input", "output", "temp"];

// ---------------------------------------------------------------------------
// Absolute-path addressing
// ---------------------------------------------------------------------------

/**
 * Join a filename onto an absolute directory, for the packs' `?path=` mode.
 *
 * Tolerates a missing or trailing-slashed `dir` and never emits a doubled
 * separator: `("/a/b/", "c.png")` and `("/a/b", "c.png")` both give
 * `/a/b/c.png`, and an empty dir gives `/c.png` rather than a relative path.
 */
export function joinAbs(dir: string, name: string): string {
  const d = (dir || "/").replace(/\/+$/, "");
  return d === "" ? `/${name}` : `${d}/${name}`;
}

// ---------------------------------------------------------------------------
// Embedded generation metadata — display order
// ---------------------------------------------------------------------------

/** A summary key both packs' `/metadata` endpoints may return. */
export type MetaField =
  | "positive"
  | "negative"
  | "model"
  | "seed"
  | "steps"
  | "cfg"
  | "sampler"
  | "scheduler";

/** One rendered metadata row: a recognised field with a non-empty value. */
export interface MetaRow {
  key: MetaField;
  label: string;
  value: string;
}

/**
 * Fixed display order for the metadata overlay. Prompts first (they are what
 * actually gets copied), then the model, then the numerics.
 *
 * Deliberately NOT the response's own key order — that is JSON insertion order
 * and varies with whichever tool wrote the file, so rendering it directly makes
 * the same image lay out differently depending on its provenance.
 */
export const META_FIELDS: readonly { key: MetaField; label: string }[] = [
  { key: "positive", label: "Positive" },
  { key: "negative", label: "Negative" },
  { key: "model", label: "Model" },
  { key: "seed", label: "Seed" },
  { key: "steps", label: "Steps" },
  { key: "cfg", label: "CFG" },
  { key: "sampler", label: "Sampler" },
  { key: "scheduler", label: "Scheduler" },
];

/**
 * Walk {@link META_FIELDS} and drop anything missing or whitespace-only, so an
 * unknown field never renders as a bare "Negative:" row with a Copy button that
 * copies nothing.
 *
 * Values are `String()`-coerced defensively: the backends stringify everything,
 * but a future numeric key must not put `[object Object]` in front of the user.
 */
export function metaRows(
  summary: Partial<Record<MetaField, unknown>> | null | undefined,
): MetaRow[] {
  const rows: MetaRow[] = [];
  if (!summary || typeof summary !== "object") return rows;
  const bag = summary as Record<string, unknown>;
  for (const { key, label } of META_FIELDS) {
    const v = bag[key];
    if (v === undefined || v === null) continue;
    const value = String(v);
    if (!value.trim()) continue;
    rows.push({ key, label, value });
  }
  return rows;
}

/**
 * The "Copy all" payload. Multi-line prompts stay verbatim — no re-indent, no
 * quoting — so the text can be pasted straight back into a prompt box.
 */
export function metaClipboardText(rows: readonly MetaRow[]): string {
  return rows.map((r) => `${r.label}: ${r.value}`).join("\n");
}

// ---------------------------------------------------------------------------
// Flat-view preference
// ---------------------------------------------------------------------------

/** Folder view (one directory) or flat view (the whole subtree, one grid). */
export type ViewMode = "folder" | "flat";

/** The stored preference, plus whether it had to be recovered on read. */
export interface SavedView {
  mode: ViewMode;
  /** True when a crashed flat load was detected and the mode forced to folder. */
  recovered: boolean;
}

/** The three operations a pack performs on its stored flat-view preference. */
export interface ViewStore {
  /** Read the preference, recovering from an interrupted flat load. */
  load(): SavedView;
  /** Persist the preference. */
  save(mode: ViewMode): void;
  /** Raise (or clear) the "a flat load is in flight" breadcrumb. */
  markPending(pending: boolean): void;
}

/**
 * The flat-view preference store, namespaced per pack.
 *
 * `namespace` is the pack's localStorage prefix — `"comfyui-gallery-loader"` /
 * `"comfyui-image-browser"` — and is a PARAMETER rather than a constant because
 * it is the one thing that genuinely differs between the two copies this was
 * lifted from. Baking either pack's key in would make the other pack, on
 * adoption, read a key it never wrote: the user's stored preference silently
 * orphaned, with the UI looking fine. The two packs must NOT share one key
 * either — they are separate surfaces over different roots and a user may
 * reasonably want flat view in one and not the other.
 *
 * THE PENDING BREADCRUMB IS THE POINT. A flat load over a large tree can kill
 * the tab; without the breadcrumb the persisted preference then reopens
 * straight into the same load, with no way to reach the toggle that would turn
 * it off. So `markPending(true)` is raised before the load and cleared once the
 * grid has painted, and finding it still raised at open time forces folder view
 * (reported as `recovered`, so the caller can say why). That is the only
 * self-service escape from the trap.
 *
 * Every access is wrapped: private mode and disabled storage throw on read as
 * well as write, and losing a view preference must never take the modal with
 * it. A failed read answers the same as a never-written one.
 */
export function createViewStore(namespace: string): ViewStore {
  const viewKey = `${namespace}:view`;
  const pendingKey = `${namespace}:view-pending`;
  return {
    load(): SavedView {
      try {
        if (localStorage.getItem(pendingKey) === "1") {
          localStorage.removeItem(pendingKey);
          localStorage.setItem(viewKey, "folder");
          return { mode: "folder", recovered: true };
        }
        return {
          mode: localStorage.getItem(viewKey) === "flat" ? "flat" : "folder",
          recovered: false,
        };
      } catch {
        // Private mode / disabled storage — non-fatal.
        return { mode: "folder", recovered: false };
      }
    },
    save(mode: ViewMode): void {
      try {
        localStorage.setItem(viewKey, mode);
      } catch {
        // Non-fatal.
      }
    },
    markPending(pending: boolean): void {
      try {
        if (pending) localStorage.setItem(pendingKey, "1");
        else localStorage.removeItem(pendingKey);
      } catch {
        // Non-fatal.
      }
    },
  };
}
