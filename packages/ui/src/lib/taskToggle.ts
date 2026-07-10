/**
 * Source-side toggle for GFM task checkboxes rendered in read mode (P3.1).
 *
 * The reader counts rendered task inputs in document order; this maps that
 * ordinal back to the matching `[ ]`/`[x]` marker in the raw markdown and
 * flips it. Counting MUST mirror what remark-gfm renders as a checkbox:
 * list items (`- [ ]`, `* [x]`, `1. [ ]`), optionally nested and inside
 * blockquotes — but never lines inside fenced code blocks.
 */

const TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s|\]$)/;
const FENCE = /^\s*(?:```|~~~)/;

export interface TaskToggleResult {
  content: string;
  changed: boolean;
}

/** Flips the `index`-th (0-based, document order) task checkbox. */
export function toggleTaskAtIndex(content: string, index: number, checked: boolean): TaskToggleResult {
  const lines = content.split("\n");
  let inFence = false;
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = lines[i].match(TASK_LINE);
    if (!m) continue;
    if (seen === index) {
      const marker = checked ? "x" : " ";
      lines[i] = lines[i].replace(TASK_LINE, `$1${marker}$3`);
      return { content: lines.join("\n"), changed: true };
    }
    seen++;
  }
  return { content, changed: false };
}
