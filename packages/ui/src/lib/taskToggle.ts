/**
 * Source-side toggle for GFM task checkboxes rendered in read mode (P3.1).
 *
 * The reader counts rendered task inputs in document order; this maps that
 * ordinal back to the matching `[ ]`/`[x]` marker in the raw markdown and
 * flips it. Counting MUST mirror what remark-gfm renders as a checkbox:
 * list items (`- [ ]`, `* [x]`, `1. [ ]`), optionally nested and inside
 * blockquotes — but never lines inside fenced code blocks.
 */

// Exported for the note-card renderer (plan Pinboard P3): its task ORDINALS
// must count exactly like this toggle, or a card checkbox would flip the
// wrong line. No `g` flag — the regexes are stateless.
export const TASK_LINE_RE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s|\]$)/;
export const FENCE_RE = /^\s*(?:```|~~~)/;
const TASK_LINE = TASK_LINE_RE;
const FENCE = FENCE_RE;

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
