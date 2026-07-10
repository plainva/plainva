/**
 * Tiny fuzzy-subsequence scorer for the quick switcher (P3.3) — no dependency.
 * "prjplan" matches "Project Plan": every query character must appear in order
 * in the target; word starts, camelCase humps, consecutive hits and early
 * matches score higher. Returns null when the query is not a subsequence.
 */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase();
  const tLower = target.toLowerCase();
  if (!q) return 0;
  if (q.length > tLower.length) return null;

  let score = 0;
  let ti = 0;
  let prevHit = -2;
  let firstHit = -1;

  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    let found = -1;
    while (ti < tLower.length) {
      if (tLower[ti] === c) {
        found = ti;
        ti++;
        break;
      }
      ti++;
    }
    if (found < 0) return null;
    if (firstHit < 0) firstHit = found;

    score += 1;
    if (found === prevHit + 1) score += 3; // consecutive run
    const prevChar = found > 0 ? target[found - 1] : " ";
    if (/[\s\-_/.\\]/.test(prevChar)) {
      score += 2; // word start
    } else if (target[found] !== tLower[found] && prevChar === prevChar.toLowerCase()) {
      score += 2; // camelCase hump
    }
    prevHit = found;
  }

  // Prefer early matches and targets without a long unmatched tail.
  score -= Math.min(10, Math.floor(firstHit / 3));
  score -= Math.min(5, Math.floor((tLower.length - q.length) / 20));
  return score;
}

export interface FuzzyHit<T> {
  item: T;
  score: number;
}

/** Scores `items` against `query` using the best of the extracted keys. */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  keysOf: (item: T) => string[],
  limit: number
): FuzzyHit<T>[] {
  const hits: FuzzyHit<T>[] = [];
  for (const item of items) {
    let best: number | null = null;
    const keys = keysOf(item);
    for (let k = 0; k < keys.length; k++) {
      const s = fuzzyScore(query, keys[k]);
      if (s === null) continue;
      // The first key (usually the title) wins ties over path-only matches.
      const weighted = s + (k === 0 ? 2 : 0);
      if (best === null || weighted > best) best = weighted;
    }
    if (best !== null) hits.push({ item, score: best });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
