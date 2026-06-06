// modal-fuzzy.ts — fzf-lite-style fuzzy matcher for picker rows.
//
// Greedy left-to-right subsequence with scoring bonuses for matches at
// start-of-string and after separators (_/-/space/dot/slash/CamelCase
// boundaries). Consecutive matches earn an escalating bonus (clusters win).
// AND-token semantics: a space in the query splits into tokens; every
// token must match somewhere on the row.
//
// Single-sourced into @laurigates/comfy-modal-kit. Self-contained — no other
// imports. Pure logic apart from highlightMatches, which builds DOM.

/** Result of scoring a single token against a target string. */
export interface FuzzyScoreResult {
  /** Cumulative match score; higher is a better match. */
  score: number;
  /** Indices into `target` where the query characters matched. */
  matches: number[];
}

/** Result of ranking a candidate row against a query across fields. */
export interface FuzzyRankResult {
  /** Aggregate score across all AND-tokens. */
  score: number;
  /** Deduplicated, ascending indices that landed on the primary field. */
  primaryMatches: number[];
}

/**
 * Score a single token against a target string.
 *
 * @param query  Lowercased token, no spaces.
 * @param target Raw target string (case-insensitive matched, but CamelCase
 *               boundaries in the original casing earn a bonus).
 * @returns null if the query is not a subsequence of target; otherwise the
 *          score and the indices (into `target`) where matches landed.
 */
export function fuzzyScore(query: string, target: string): FuzzyScoreResult | null {
  if (!query) return { score: 0, matches: [] };
  if (!target) return null;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const matches: number[] = [];
  let qi = 0;
  let score = 0;
  let consecutive = 0;
  let prevMatchIdx = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) {
      consecutive = 0;
      continue;
    }
    let charScore = 1;
    if (ti === 0) {
      charScore += 5;
    } else {
      const prev = t[ti - 1];
      const orig = target[ti];
      if (prev === "_" || prev === "-" || prev === " " || prev === "." || prev === "/") {
        charScore += 4;
      } else if (
        prev !== undefined &&
        prev >= "a" &&
        prev <= "z" &&
        orig !== undefined &&
        orig >= "A" &&
        orig <= "Z"
      ) {
        charScore += 3;
      }
    }
    if (ti === prevMatchIdx + 1) {
      consecutive++;
      charScore += consecutive * 2;
    } else {
      consecutive = 0;
    }
    score += charScore;
    matches.push(ti);
    prevMatchIdx = ti;
    qi++;
  }

  if (qi < q.length) return null;
  // Tie-break: shorter targets win.
  score -= target.length * 0.01;
  return { score, matches };
}

/**
 * Rank a candidate row against a query across multiple fields.
 *
 * Splits the query on whitespace into AND-tokens. Each token must match at
 * least one field. The first field is the "primary" (e.g. the displayed
 * name) and its match score is weighted `primaryWeight` × heavier than the
 * other fields, so a hit on the name beats a hit on the summary.
 *
 * @param query
 * @param fields        First field is primary.
 * @param primaryWeight Multiplier applied to a hit on the primary field.
 * @returns null if any token fails to match any field; otherwise the
 *          aggregate score and the primary-field match indices.
 */
export function fuzzyRank(
  query: string,
  fields: (string | null | undefined)[],
  primaryWeight = 10,
): FuzzyRankResult | null {
  if (!query) return { score: 0, primaryMatches: [] };
  const tokens = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { score: 0, primaryMatches: [] };

  const primary = fields[0] || "";
  const rest = fields.slice(1).filter((f): f is string => Boolean(f));

  let totalScore = 0;
  const primaryMatchSet = new Set<number>();

  for (const token of tokens) {
    const primaryResult = fuzzyScore(token, primary);
    let best: { score: number; matches: number[]; onPrimary: boolean } | null = primaryResult
      ? {
          score: primaryResult.score * primaryWeight,
          matches: primaryResult.matches,
          onPrimary: true,
        }
      : null;
    for (const field of rest) {
      const r = fuzzyScore(token, field);
      if (r && (!best || r.score > best.score)) {
        best = { score: r.score, matches: r.matches, onPrimary: false };
      }
    }
    if (!best) return null;
    totalScore += best.score;
    if (best.onPrimary) {
      for (const i of best.matches) primaryMatchSet.add(i);
    }
  }

  return {
    score: totalScore,
    primaryMatches: [...primaryMatchSet].sort((a, b) => a - b),
  };
}

/**
 * Wrap matched characters in `target` with <span class="cmp-match">…</span>,
 * leaving the rest as escaped text. Returns a DocumentFragment ready to
 * append. Use the match indices from fuzzyScore/fuzzyRank.
 *
 * @param target
 * @param matchIndices Indices into `target` to highlight.
 * @returns A DocumentFragment ready to append.
 */
export function highlightMatches(
  target: string,
  matchIndices: number[] | null | undefined,
): DocumentFragment {
  const frag = document.createDocumentFragment();
  if (!target) return frag;
  const set = new Set(matchIndices || []);
  if (!set.size) {
    frag.appendChild(document.createTextNode(target));
    return frag;
  }
  for (let i = 0; i < target.length; i++) {
    const ch = target[i] as string;
    if (set.has(i)) {
      const m = document.createElement("span");
      m.className = "cmp-match";
      m.textContent = ch;
      frag.appendChild(m);
    } else {
      frag.appendChild(document.createTextNode(ch));
    }
  }
  return frag;
}
