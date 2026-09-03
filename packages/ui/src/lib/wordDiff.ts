/**
 * A word-level diff for a suggestion card (K5): what was struck, what came in.
 *
 * `lineDiff` answers the version comparison; a proposal is one passage, and a
 * reader wants to see the changed WORDS, not two blocks under each other. The
 * tokens are words and the whitespace between them, so a change never eats
 * the spacing around it. Beyond the cap the result is the plain pair - a
 * suggestion that long is not read word by word anyway.
 */
export interface WordDiffSegment {
  kind: "same" | "del" | "ins";
  text: string;
}

export const WORD_DIFF_CAP = 400;

function tokens(text: string): string[] {
  // A word carries the whitespace after it: with the spaces as tokens of
  // their own, two deleted words would match through the space between them
  // and the diff would read "Ende" / "des" / "Jahres" in three pieces.
  return text.match(/\S+\s*|\s+/g) ?? [];
}

export function wordDiff(before: string, after: string): WordDiffSegment[] {
  if (before === after) return before ? [{ kind: "same", text: before }] : [];
  const a = tokens(before);
  const b = tokens(after);
  if (a.length > WORD_DIFF_CAP || b.length > WORD_DIFF_CAP) {
    return [...(before ? [{ kind: "del" as const, text: before }] : []), ...(after ? [{ kind: "ins" as const, text: after }] : [])];
  }
  const n = a.length;
  const m = b.length;
  const dp: Uint16Array[] = [];
  for (let i = 0; i <= n; i += 1) dp.push(new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: WordDiffSegment[] = [];
  const push = (kind: WordDiffSegment["kind"], text: string) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += text;
    else out.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { push("same", a[i]); i += 1; j += 1; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("del", a[i]); i += 1; }
    else { push("ins", b[j]); j += 1; }
  }
  while (i < n) { push("del", a[i]); i += 1; }
  while (j < m) { push("ins", b[j]); j += 1; }
  // Whitespace that only ever sat between two changed words reads better as
  // part of the change than as an untouched sliver between a red and a green.
  return out.filter((segment) => segment.text.length > 0);
}
