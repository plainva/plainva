/**
 * Read-only line diff for the mobile version/conflict sheets (M3E package G).
 * Classic LCS over lines — quadratic, so inputs are capped; notes are small.
 * The desktop keeps its richer @codemirror/merge editor; this is the touch
 * summary view, not a merge tool.
 */

export interface DiffLine {
  type: "same" | "add" | "del";
  text: string;
}

/** Inputs larger than this many lines skip the LCS and return null. */
export const LINE_DIFF_CAP = 2000;

export function lineDiff(a: string, b: string): DiffLine[] | null {
  const al = a.split("\n");
  const bl = b.split("\n");
  if (al.length > LINE_DIFF_CAP || bl.length > LINE_DIFF_CAP) return null;

  // LCS table (length-only, then backtrack).
  const n = al.length;
  const m = bl.length;
  const dp: Uint32Array[] = [];
  for (let i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (al[i] === bl[j]) {
      out.push({ type: "same", text: al[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: "del", text: al[i] });
      i++;
    } else {
      out.push({ type: "add", text: bl[j] });
      j++;
    }
  }
  while (i < n) out.push({ type: "del", text: al[i++] });
  while (j < m) out.push({ type: "add", text: bl[j++] });
  return out;
}

/** Collapse long same-runs to context around changes (for compact sheets). */
export function collapseContext(lines: DiffLine[], context = 2): Array<DiffLine | { type: "skip"; count: number }> {
  const keep = new Array<boolean>(lines.length).fill(false);
  lines.forEach((l, idx) => {
    if (l.type === "same") return;
    for (let k = Math.max(0, idx - context); k <= Math.min(lines.length - 1, idx + context); k++) keep[k] = true;
  });
  const out: Array<DiffLine | { type: "skip"; count: number }> = [];
  let skipped = 0;
  lines.forEach((l, idx) => {
    if (keep[idx] || l.type !== "same") {
      if (skipped > 0) {
        out.push({ type: "skip", count: skipped });
        skipped = 0;
      }
      out.push(l);
    } else skipped++;
  });
  if (skipped > 0) out.push({ type: "skip", count: skipped });
  return out;
}
