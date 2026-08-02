// gallery-file.ts — the listing-row shape the gallery packs share, plus the
// sort comparators and option list built on it.
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
