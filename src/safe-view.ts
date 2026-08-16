// safe-view.ts — the family's sensitive-content blur/hide filter.
//
// The gallery packs render generation output as thumbnail grids, on a phone,
// often with someone else in the room. Safe View matches a user keyword list
// against a file's name, the folders above it, and its XMP keyword tags, and
// blurs the thumbnails and spoiler-blocks the names of anything that matches.
//
// THIS IS A DISCRETION FEATURE, NOT ACCESS CONTROL. The blur is CSS — one
// devtools override away from gone — and the blurred bytes are still fetched
// and still sit in the browser cache. It defeats a shoulder, not an adversary.
// Say so wherever this is documented; a reader who mistakes it for protection
// will trust it with something it cannot protect.
//
// WHY THE KIT OWNS THIS. Two packs render the same files (comfyui-image-browser
// and comfyui-gallery-loader), and the filter has to agree between them or the
// same image is blurred in one grid and plain in the other. Sharing the matcher
// is not enough — they must also share the SETTINGS, which they do by both
// registering the same setting ids: `addSetting` skips a duplicate id with a
// console.warn and returns (settingStore.ts:281), so one row appears in the
// dialog, one value is stored, and ComfyUI persists it server-side to
// `user/default/comfy.settings.json` — which makes the preference cross-pack
// AND cross-device for free, with no config endpoint of our own. The cost is
// one benign console warning from whichever pack loses the import race; that
// race is the same nondeterministic `Promise.all` election `installHubButton`
// already documents and accepts.
//
// TOKEN MATCHING, NOT SUBSTRING. Every haystack is split on non-alphanumerics
// and compared as WHOLE tokens. `nsfw` therefore matches `output/nsfw/…`,
// `my_nsfw_pic.png` and an `nsfw` XMP keyword — while a short keyword like
// `ass` does NOT match `assets/` or `classic.png`. Substring matching produces
// a false-positive class that silently blurs unrelated work, and the user has
// no way to tell a deliberate match from an accidental one because both look
// identical: a blurred card. The setting's tooltip states the token rule.

import { registerHubToggle } from "./hub-registry.js";
import { getKit } from "./kit-global.js";
import { notify } from "./modal-notify.js";
import { ensureStyleOnce } from "./style-inject.js";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/**
 * The Safe View setting ids. FROZEN — persistence keys on the `id` alone
 * (settingStore.ts:78/142/157/199), so renaming one silently orphans the
 * user's stored value while leaving the dialog looking fine.
 *
 * The `TouchTools.` prefix (rather than a per-pack one) is deliberate: this is
 * a family-level preference that two packs share, and the id IS the sharing
 * mechanism.
 */
export const SAFE_VIEW_SETTINGS = {
  enabled: "TouchTools.SafeView.Enabled",
  keywords: "TouchTools.SafeView.Keywords",
  hide: "TouchTools.SafeView.Hide",
  blurNames: "TouchTools.SafeView.BlurNames",
  matchPrompt: "TouchTools.SafeView.MatchPrompt",
} as const;

/**
 * The single default keyword. It matches the convention already in use in this
 * workspace (`output/nsfw/<date>/`) and is inert for anyone who does not use
 * it — with no match, the filter is a no-op, which is what makes shipping it
 * enabled-by-default safe.
 */
export const SAFE_VIEW_DEFAULT_KEYWORDS = "nsfw";

/** Glyph for the packs' own toolbar toggles. Filtering ON — matches are hidden. */
export const SAFE_VIEW_GLYPH_ON = "🙈";
/** Glyph for the packs' own toolbar toggles. Filtering OFF — nothing hidden. */
export const SAFE_VIEW_GLYPH_OFF = "👁";

/**
 * One entry of `registerExtension`'s `settings` array, structurally. Declared
 * locally because this kit deliberately does not depend on
 * `@comfyorg/comfyui-frontend-types`; a consuming pack may need a cast at the
 * registration boundary, exactly as it already does for the launcher fields.
 */
export interface SafeViewSettingParam {
  id: string;
  category: string[];
  sortOrder: number;
  name: string;
  tooltip: string;
  type: "boolean" | "text";
  defaultValue: boolean | string;
  onChange: (value: unknown) => void;
}

/**
 * The Safe View settings, ready to spread into a pack's `settings` array.
 *
 * BOTH gallery packs must spread THIS array rather than hand-writing the
 * definitions, which is the whole point: two hand-written copies of five
 * settings drift, and a drifted `defaultValue` or `tooltip` between two packs
 * registering the same id is invisible (whichever pack wins the import race
 * decides, and that race has no stable winner).
 *
 * Category arrays carry a DISTINCT third element each. Two settings sharing an
 * identical full category array silently collapse into one — `buildTree` reuses
 * the node at that path and unconditionally overwrites `parent.data`
 * (treeUtil.ts:24-38), so the first vanishes from the dialog while its value
 * stays stored. `sortOrder` descends because settings render in REVERSE
 * registration order (`flattenTree` pops a stack, treeUtil.ts:57-66).
 */
export function safeViewSettings(): SafeViewSettingParam[] {
  const fire = (): void => notifySafeViewChange();
  return [
    {
      id: SAFE_VIEW_SETTINGS.enabled,
      category: ["Touch Tools", "Safe View", "Enabled"],
      sortOrder: 100,
      name: "Safe View",
      tooltip:
        "Blur thumbnails and block out names for files and folders matching your keywords, in the Image Browser, the image picker and ComfyUI's own asset sidebar and lightbox. This is discretion, not security: the blur is CSS and the file is still downloaded, so it defeats someone glancing over your shoulder, not someone with your keyboard.",
      type: "boolean",
      defaultValue: true,
      onChange: fire,
    },
    {
      id: SAFE_VIEW_SETTINGS.keywords,
      category: ["Touch Tools", "Safe View", "Keywords"],
      sortOrder: 90,
      name: "Keywords",
      tooltip:
        "Comma- or space-separated. Matched as WHOLE WORDS against the file name, every folder above it, and the file's XMP keyword tags — so 'nsfw' matches output/nsfw/pic.png and my_nsfw_pic.png, while 'ass' does not match assets/ or classic.png. Case-insensitive. Empty means nothing is filtered.",
      type: "text",
      defaultValue: SAFE_VIEW_DEFAULT_KEYWORDS,
      onChange: fire,
    },
    {
      id: SAFE_VIEW_SETTINGS.hide,
      category: ["Touch Tools", "Safe View", "Hide"],
      sortOrder: 80,
      name: "Remove matches from the listing entirely",
      tooltip:
        "Off (default): matches stay in the grid, blurred, with a reveal button. On: matches are dropped server-side, so they never reach the browser and the listing count changes. Hiding is filtered above the newest-N cap, so a folder of mostly-sensitive files still returns a full page of the rest.",
      type: "boolean",
      defaultValue: false,
      onChange: fire,
    },
    {
      id: SAFE_VIEW_SETTINGS.blurNames,
      category: ["Touch Tools", "Safe View", "Names"],
      sortOrder: 70,
      name: "Block out names too",
      tooltip:
        "Replaces the file name, its folder label and its tooltip with a solid block. Off leaves names readable under a blurred thumbnail — which usually defeats the point, since the folder name is often what matched.",
      type: "boolean",
      defaultValue: true,
      onChange: fire,
    },
    {
      id: SAFE_VIEW_SETTINGS.matchPrompt,
      category: ["Touch Tools", "Safe View", "Prompt"],
      sortOrder: 60,
      name: "Also match the generation prompt and model",
      tooltip:
        "Off by default because it is expensive: every file's embedded metadata must be parsed and cached before its verdict is known, and a file with no verdict yet is blurred until the background scan reaches it. On a large library that means a mostly-blurred grid on first enable, clearing as the scan progresses.",
      type: "boolean",
      defaultValue: false,
      onChange: fire,
    },
  ];
}

// ---------------------------------------------------------------------------
// Reading the live configuration
// ---------------------------------------------------------------------------

/** The frontend's setting store, structurally — the surface this module uses. */
export interface SafeViewSettingHost {
  get<T>(id: string): T | undefined;
  set(id: string, value: unknown): unknown;
}

/**
 * The app's setting store, or null when it is unavailable (node, a test, or
 * before the frontend has booted). Every read falls back to the documented
 * default rather than throwing — a filter that crashes the grid it was meant to
 * soften is worse than no filter.
 */
export function safeViewSettingHost(): SafeViewSettingHost | null {
  const host = globalThis as {
    app?: { extensionManager?: { setting?: SafeViewSettingHost } };
  };
  return host.app?.extensionManager?.setting ?? null;
}

/** A resolved snapshot of the filter's configuration. */
export interface SafeViewConfig {
  enabled: boolean;
  /** Normalized, deduped, lowercase keyword tokens. Empty means "filter nothing". */
  keywords: readonly string[];
  hide: boolean;
  blurNames: boolean;
  matchPrompt: boolean;
}

/** The configuration that applies when nothing has been stored (or read) yet. */
export const SAFE_VIEW_DEFAULTS: SafeViewConfig = Object.freeze({
  enabled: true,
  keywords: Object.freeze([SAFE_VIEW_DEFAULT_KEYWORDS]) as readonly string[],
  hide: false,
  blurNames: true,
  matchPrompt: false,
});

/**
 * Split a raw keyword setting into normalized tokens.
 *
 * Accepts commas and/or whitespace as separators, lowercases, and strips every
 * non-alphanumeric character from each keyword — because the matcher compares
 * against tokens produced by {@link tokenize}, and a keyword carrying
 * punctuation could never equal one of those. Deduped, order preserved.
 */
export function parseKeywords(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const piece of raw.split(/[\s,]+/)) {
    const kw = piece.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!kw || seen.has(kw)) continue;
    seen.add(kw);
    out.push(kw);
  }
  return out;
}

/**
 * Read the live configuration. Cheap (Map lookups), but call it ONCE per render
 * pass and hand the result to {@link isSensitive} — not once per card.
 */
export function readSafeViewConfig(host = safeViewSettingHost()): SafeViewConfig {
  if (!host) return SAFE_VIEW_DEFAULTS;
  const bool = (id: string, fallback: boolean): boolean => {
    const v = host.get<boolean>(id);
    return typeof v === "boolean" ? v : fallback;
  };
  const rawKeywords = host.get<string>(SAFE_VIEW_SETTINGS.keywords);
  return {
    enabled: bool(SAFE_VIEW_SETTINGS.enabled, SAFE_VIEW_DEFAULTS.enabled),
    // `undefined` means "never stored" -> the default. An empty STRING means the
    // user deliberately cleared it, and must stay empty (filter nothing) rather
    // than snapping back to the default keyword.
    keywords: rawKeywords === undefined ? SAFE_VIEW_DEFAULTS.keywords : parseKeywords(rawKeywords),
    hide: bool(SAFE_VIEW_SETTINGS.hide, SAFE_VIEW_DEFAULTS.hide),
    blurNames: bool(SAFE_VIEW_SETTINGS.blurNames, SAFE_VIEW_DEFAULTS.blurNames),
    matchPrompt: bool(SAFE_VIEW_SETTINGS.matchPrompt, SAFE_VIEW_DEFAULTS.matchPrompt),
  };
}

/** Whether the filter is on AND has something to match with. */
export function isSafeViewActive(cfg: SafeViewConfig = readSafeViewConfig()): boolean {
  return cfg.enabled && cfg.keywords.length > 0;
}

/**
 * The keyword the packs' 🙈 "mark sensitive" control writes into a file's
 * `dc:subject`: THE FIRST ONE THE USER CONFIGURED.
 *
 * There is deliberately NO HIDDEN DEFAULT. The filter matches the user's own
 * keyword list, so writing anything else — including the packaged
 * {@link SAFE_VIEW_DEFAULT_KEYWORDS} — produces a file that says "marked" and
 * is not hidden, which is the one outcome a discretion feature must never have.
 *
 * An EMPTY LIST returns `null`, and the caller must then not offer the control
 * at all rather than fall back to something. "Nothing is filtered" and "mark
 * this as filtered" are incoherent together; the honest UI is no button.
 *
 * The whole justification for "the first entry" is that {@link parseKeywords}
 * PRESERVES THE ORDER the user typed, so the first entry is the keyword they
 * named first — and that guarantee is kit-side, which is why this function
 * belongs here rather than in each pack. It lived as two hand-written copies in
 * `comfyui-image-browser/src/safe-tag.ts` and
 * `comfyui-gallery-loader/src/safe-tag.ts`, which write over the SAME FILES ON
 * DISK: had they ever disagreed, a tap in one pack would mark a file the other
 * pack's filter did not honour, and the failure is silent and asymmetric.
 * See laurigates/comfy-modal-kit#33.
 *
 * The REST of each pack's `safe-tag.ts` stays per-pack and must not follow this
 * one in: the route URL, the CSS class prefix and the address shape genuinely
 * differ, and `tagRequestBody` / `markSensitiveHTML` have DELIBERATELY diverged
 * (image-browser dropped the `type: "path"` arm, because a tag write is a write
 * and `/image_browser/tag` rejects `type=path` — its ADR-0002). Unifying those
 * would silently reverse a considered decision.
 */
export function sensitiveKeyword(cfg: SafeViewConfig): string | null {
  return cfg.keywords.length ? (cfg.keywords[0] as string) : null;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Split a haystack into lowercase alphanumeric tokens.
 *
 * Everything else is a separator, so `output/nsfw/2026-08-04`,
 * `my_nsfw_pic.png` and `NSFW` all yield an `nsfw` token, while `assets` yields
 * only `assets` (never `ass`).
 */
export function tokenize(input: unknown): string[] {
  if (typeof input !== "string" || input === "") return [];
  return input
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t !== "");
}

/**
 * The prompt-metadata tier's verdict for one file.
 *
 * - `true` / `false` — the backend has a cached verdict.
 * - `"unscanned"` — the file participates in the tier but has no cached text
 *   yet. Read as SENSITIVE: the fail-safe direction for an unknown is to hide,
 *   and the two cache warmers exist to make this rare in steady state.
 *
 * `undefined` is a fourth, different state: this target does not participate in
 * the tier at all (a folder card has no generation metadata). It is never
 * treated as sensitive. The string sentinel is deliberate — a `null`-vs-
 * `undefined` split carries exactly this distinction in a form nobody
 * remembers three months later.
 */
export type PromptVerdict = boolean | "unscanned";

/** One thing the filter can be asked about: a file card, or a folder card. */
export interface SafeViewTarget {
  /** File or folder name, e.g. `my_nsfw_pic.png`. */
  name: string;
  /**
   * Forward-slashed folder path above the item, e.g. `output/nsfw/2026-08-04`.
   * EVERY segment is matched, not just the last one.
   */
  path?: string;
  /** `dc:subject` keyword tags read from the file's XMP. */
  tags?: readonly string[];
  /** Prompt-tier verdict; omit entirely for targets outside the tier. */
  promptMatch?: PromptVerdict;
}

/**
 * Whether `target` matches the filter.
 *
 * A FOLDER IS MATCHED BY NAME ONLY. A folder card carries no metadata to read,
 * so a blandly-named folder full of sensitive files is not caught in folder
 * view — it IS caught in flat view, which lists the files themselves. Both
 * packs' READMEs state this limit rather than implying folder-level coverage.
 */
export function isSensitive(target: SafeViewTarget, cfg: SafeViewConfig): boolean {
  if (!cfg.enabled || cfg.keywords.length === 0) return false;

  const haystack = new Set<string>();
  for (const t of tokenize(target.name)) haystack.add(t);
  for (const t of tokenize(target.path)) haystack.add(t);
  for (const tag of target.tags ?? []) {
    for (const t of tokenize(tag)) haystack.add(t);
  }
  for (const kw of cfg.keywords) {
    if (haystack.has(kw)) return true;
  }

  // The opt-in tier is consulted only when it is switched on, so a stale
  // "unscanned" left on a row cannot blur anything while the tier is off.
  if (cfg.matchPrompt) {
    // `undefined` — a target outside the tier, e.g. a folder card — matches
    // neither arm, which is the point: conflating "no metadata to scan" with
    // "not scanned yet" would blur every folder the moment the tier came on.
    if (target.promptMatch === true) return true;
    if (target.promptMatch === "unscanned") return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-session reveal
// ---------------------------------------------------------------------------

/**
 * The set of addresses the user has explicitly revealed this session.
 *
 * Held for the MODAL SESSION and cleared on close and on tab/folder change: a
 * delete-triggered re-render must not re-blur the card you were looking at,
 * while navigating away resets. The key format lives here so the two packs
 * cannot drift on it — they address the same files.
 */
export interface RevealSet {
  /** Stable key for one file address. */
  key(type: string, subfolder: string, name: string): string;
  has(type: string, subfolder: string, name: string): boolean;
  reveal(type: string, subfolder: string, name: string): void;
  clear(): void;
  /** Number of revealed addresses — for tests and diagnostics. */
  readonly size: number;
}

/** Create an empty {@link RevealSet}. */
export function makeRevealSet(): RevealSet {
  const set = new Set<string>();
  const key = (type: string, subfolder: string, name: string): string =>
    `${type}:${subfolder}:${name}`;
  return {
    key,
    has: (t, s, n) => set.has(key(t, s, n)),
    reveal: (t, s, n) => {
      set.add(key(t, s, n));
    },
    clear: () => set.clear(),
    get size() {
      return set.size;
    },
  };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

const SAFE_VIEW_STYLE_ID = "cmk-safe-view-style";

/** Blur applied to a matched thumbnail. */
export const SAFE_VIEW_BLUR_CLASS = "cmk-sv-blur";
/** Solid spoiler block applied to a matched name or path label. */
export const SAFE_VIEW_SPOILER_CLASS = "cmk-sv-spoiler";
/** Attribute the original `title` is parked in while a label is spoilered. */
const SPOILER_TITLE_ATTR = "data-cmk-sv-title";

const SAFE_VIEW_CSS = `
.${SAFE_VIEW_BLUR_CLASS} {
    /* Scale past the edges: a blurred element otherwise fades toward its own
       border and leaks a readable silhouette of the content at the rim. */
    filter: blur(18px);
    transform: scale(1.08);
}
.${SAFE_VIEW_SPOILER_CLASS} {
    /* A SOLID BLOCK, never a text blur — blurred text stays readable at small
       sizes, which is exactly the size a phone grid renders names at. */
    background: #3a3a44;
    color: transparent;
    border-radius: 3px;
    user-select: none;
    -webkit-user-select: none;
    cursor: default;
}
.cmk-sv-reveal {
    position: absolute;
    top: 4px;
    left: 4px;
    z-index: 2;
    /* >=34px is the family's per-card control floor. */
    min-width: 34px;
    min-height: 34px;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    line-height: 1;
    background: rgba(20, 20, 26, 0.82);
    color: #e8e8ea;
    border: 1px solid #4a4a58;
    border-radius: 8px;
    cursor: pointer;
    touch-action: manipulation;
}
.cmk-sv-reveal:hover {
    background: rgba(40, 40, 52, 0.92);
}
`;

/** Inject the Safe View stylesheet once per document. */
export function ensureSafeViewStyle(): void {
  ensureStyleOnce(SAFE_VIEW_STYLE_ID, SAFE_VIEW_CSS);
}

/**
 * Apply or remove the blur on a thumbnail element.
 *
 * The blur arrives through an injected CLASS RULE, never `el.style` — which is
 * also why a test must assert `getComputedStyle(el).filter` and not
 * `el.style.filter`. The latter reads `""` here whether the code works or not.
 */
export function setBlurred(el: Element, blurred: boolean): void {
  ensureSafeViewStyle();
  el.classList.toggle(SAFE_VIEW_BLUR_CLASS, blurred);
}

/**
 * Spoiler (or un-spoiler) a name/path label.
 *
 * The class handles the visible text. The `title` attribute is REMOVED, not
 * styled: a native tooltip renders the name in full on hover regardless of any
 * CSS on the element, so a spoiler that only paints a block leaks the exact
 * string it was hiding to anyone whose pointer rests on the card. The original
 * is parked in a data attribute so un-spoilering restores it verbatim.
 */
export function setSpoilered(el: Element, spoilered: boolean): void {
  ensureSafeViewStyle();
  el.classList.toggle(SAFE_VIEW_SPOILER_CLASS, spoilered);
  if (spoilered) {
    const title = el.getAttribute("title");
    if (title !== null) {
      el.setAttribute(SPOILER_TITLE_ATTR, title);
      el.removeAttribute("title");
    }
  } else {
    const parked = el.getAttribute(SPOILER_TITLE_ATTR);
    if (parked !== null) {
      el.setAttribute("title", parked);
      el.removeAttribute(SPOILER_TITLE_ATTR);
    }
  }
}

/** Options for {@link makeRevealButton}. */
export interface RevealButtonOptions {
  /** Called when the user taps it. The caller re-renders the card. */
  onReveal: () => void;
  /** Accessible label. Defaults to a name-free string — see below. */
  label?: string;
}

/**
 * The per-card 👁 that reveals ONE card.
 *
 * Its accessible name must not carry the file name: a spoiler that blocks the
 * visible text while announcing the same string to a screen reader (and to
 * anything else that surfaces accessible names) has hidden nothing.
 */
export function makeRevealButton(opts: RevealButtonOptions): HTMLButtonElement {
  ensureSafeViewStyle();
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "cmk-sv-reveal";
  btn.textContent = SAFE_VIEW_GLYPH_OFF;
  btn.title = "Reveal";
  btn.setAttribute("aria-label", opts.label ?? "Reveal hidden item");
  btn.addEventListener("click", (e) => {
    // The card itself opens on click; revealing must not also open it.
    e.stopPropagation();
    e.preventDefault();
    opts.onReveal();
  });
  return btn;
}

// ---------------------------------------------------------------------------
// Cross-pack change notification
// ---------------------------------------------------------------------------

/**
 * Subscribe to Safe View configuration changes. Returns an unsubscribe.
 *
 * Listeners live on the shared rendezvous, so a listener registered by pack B
 * still fires when pack A's `onChange` runs — which matters because only ONE
 * pack's settings registration actually takes effect (the duplicate id is
 * skipped), and which pack that is has no stable winner.
 */
export function onSafeViewChange(listener: () => void): () => void {
  const list = getKit().safeViewListeners;
  list.push(listener);
  return () => {
    const i = list.indexOf(listener);
    if (i >= 0) list.splice(i, 1);
  };
}

/** Fire every subscriber. One throwing listener must not starve the rest. */
export function notifySafeViewChange(): void {
  for (const listener of [...getKit().safeViewListeners]) {
    try {
      listener();
    } catch (e) {
      console.error("[comfy-modal-kit] safe-view listener failed", e);
    }
  }
}

/**
 * Flip the global filter.
 *
 * Writing through the setting store fires the registered `onChange`, which is
 * what repaints every open surface — so this needs no repaint call of its own.
 * With an empty keyword list the toggle would be a visibly inert control, so it
 * says where to configure it instead of silently doing nothing.
 */
export function toggleSafeView(host: SafeViewSettingHost | null = safeViewSettingHost()): void {
  if (!host) return;
  const cfg = readSafeViewConfig(host);
  if (cfg.keywords.length === 0) {
    notify({
      severity: "warn",
      summary: "Safe View has no keywords",
      detail: "Add keywords in Settings → Touch Tools → Safe View → Keywords.",
    });
    return;
  }
  host.set(SAFE_VIEW_SETTINGS.enabled, !cfg.enabled);
}

/**
 * Register Safe View's row in the Touch Tools chooser.
 *
 * Called from each gallery pack's `setup()`. Idempotent by id, so both packs
 * calling it is harmless — and having the KIT build the row (rather than each
 * pack hand-writing one) is what stops two rows appearing with drifting labels
 * when both packs are installed.
 *
 * It registers as a TOGGLE, not a `HubEntry`: an entry would make
 * `getHubEntries().length === 2` for a user with one pack installed, costing
 * them the single-entry short-circuit and therefore an extra tap on every
 * launch. See hub-registry.ts.
 */
export function registerSafeViewHubToggle(): void {
  registerHubToggle({
    id: "safe-view.toggle",
    label: "Safe View",
    icon: "pi pi-eye-slash",
    description: "Blur sensitive thumbnails and names",
    priority: 100,
    get: () => isSafeViewActive(),
    set: () => toggleSafeView(),
  });
}
