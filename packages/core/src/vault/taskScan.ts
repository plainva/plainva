/**
 * Vault-wide task scanning (B4). Finds GFM task list items (`- [ ]` / `- [x]`,
 * also `*`/`+`/ordered, nested, inside blockquotes, never in fenced code) and
 * returns each with the SAME document-order ordinal that `@plainva/ui`'s
 * `toggleTaskAtIndex` counts — so a vault-wide Tasks view can flip a checkbox
 * back through that helper. The `TASK_LINE`/`FENCE` regexes here MUST stay in
 * lock-step with the toggle; an alignment test cross-checks both.
 */

const TASK_LINE = /^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\]\s|\]$)/;
const FENCE = /^\s*(?:```|~~~)/;
const DUE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const INLINE_TAG = /(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu;

export interface ScannedTask {
  /** 0-based line index of the task in the content. */
  line: number;
  /** 0-based checkbox index in document order — matches toggleTaskAtIndex. */
  ordinal: number;
  done: boolean;
  /** Raw task text after the checkbox marker, trimmed. */
  text: string;
  /** Inline `#tags` found in the task text. */
  tags: string[];
  /** ISO date (YYYY-MM-DD) from a `📅` marker in the task text, or null. */
  due: string | null;
}

/** Extracts every GFM task checkbox from a note's raw markdown, in order. */
export function scanTasks(content: string): ScannedTask[] {
  const lines = content.split("\n");
  const out: ScannedTask[] = [];
  let inFence = false;
  let ordinal = 0;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = lines[i].match(TASK_LINE);
    if (!m) continue;
    const text = lines[i].slice(m[0].length).trim();
    const tags: string[] = [];
    for (const tm of text.matchAll(INLINE_TAG)) tags.push(tm[1]);
    out.push({
      line: i,
      ordinal,
      done: m[2].toLowerCase() === "x",
      text,
      tags,
      due: text.match(DUE)?.[1] ?? null,
    });
    ordinal++;
  }
  return out;
}
