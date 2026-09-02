/**
 * Shared model for comparing two versions of a note — the version history
 * and a sync-conflict copy alike (feedback round 2026-09-01, A6 / P2).
 *
 * The rule that carries both shells and both entry points: the LEFT side is
 * always what the note holds right now, the RIGHT side is always the other
 * version (an older snapshot, or the copy the sync preserved). The sides
 * never swap meaning. From that follows the colour: red on the left is what
 * disappears if you take the right side, green on the right is what would
 * come in. The colour does not say who is right — it says what the decision
 * costs.
 *
 * Before this, three implementations had grown apart: the desktop history put
 * the OLD version on the left, the conflict modal put the CURRENT file on the
 * left, and the phone called the line diff with its own argument order. This
 * module pins the order once; `compareLines` is the only way the shells diff.
 */
import { collapseContext, lineDiff, type DiffLine } from "./lineDiff";

export type CompareLine = DiffLine | { type: "skip"; count: number };

/**
 * Lines of the comparison, left = `inNote`, right = `other`: a `del` line is
 * only in the note (lost if the other side is taken), an `add` line only in
 * the other version (gained). Null when either side is beyond the diff cap —
 * the caller says so instead of showing nothing.
 */
export function compareLines(inNote: string, other: string, context = 2): CompareLine[] | null {
  const d = lineDiff(normalize(inNote), normalize(other));
  return d ? collapseContext(d, context) : null;
}

export interface CompareStats {
  /** Lines only in the other version: they come in if it is taken. */
  added: number;
  /** Lines only in the note: they are lost if the other version is taken. */
  removed: number;
  same: number;
  /** Number of changed regions (runs of add/del lines). */
  hunks: number;
}

/** Counts what taking the right side would cost and bring. Null beyond the diff cap. */
export function compareStats(inNote: string, other: string): CompareStats | null {
  const d = lineDiff(normalize(inNote), normalize(other));
  if (!d) return null;
  const stats: CompareStats = { added: 0, removed: 0, same: 0, hunks: 0 };
  let inHunk = false;
  for (const line of d) {
    if (line.type === "same") {
      stats.same++;
      inHunk = false;
      continue;
    }
    if (!inHunk) {
      stats.hunks++;
      inHunk = true;
    }
    if (line.type === "add") stats.added++;
    else stats.removed++;
  }
  return stats;
}

/** Line count of a text the way the diff sees it. */
export function lineCount(text: string): number {
  return normalize(text).split("\n").length;
}

function normalize(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

/**
 * The instant a conflict copy was preserved, read from its name
 * (`<base>.CONFLICT-2026-07-05T12-30-00-000Z<ext>`). Null when the name does
 * not carry one.
 */
export function conflictCopyStamp(conflictPath: string): Date | null {
  const m = conflictPath.match(/\.CONFLICT-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s, +ms));
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** `2026-09-02 14-35` — the stamp a sibling copy carries in its name. */
export function versionStamp(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}-${pad2(date.getMinutes())}`;
}

/**
 * The path a version is laid down under next to its note — `Note (Version
 * 2026-09-02 14-35).md`, numbered on collision. One grammar for "restore as
 * copy" and "keep both": the name says what the file is and when it is from,
 * which `.CONFLICT-…` never did.
 */
export async function versionCopyPath(path: string, date: Date, exists: (candidate: string) => Promise<boolean>): Promise<string> {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const stamp = versionStamp(date);
  let candidate = `${dir}${stem} (Version ${stamp})${ext}`;
  let n = 2;
  while (await exists(candidate)) {
    candidate = `${dir}${stem} (Version ${stamp} ${n})${ext}`;
    n++;
  }
  return candidate;
}
