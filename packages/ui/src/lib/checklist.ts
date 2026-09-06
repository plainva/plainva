/**
 * The checklist of a note as a card sees it (issue #83, plan Issue-Durchsicht
 * 2026-09-06, P4/E5).
 *
 * A sub-task of a database entry is a GFM checkbox line in the note's own
 * body — plain Markdown, readable in Obsidian, no schema. The index already
 * counts those lines (`file.tasks`, "done/total"); the card shows that count
 * as a progress bar and, unfolded, the lines themselves with a checkbox that
 * flips exactly its own line through `toggleTaskAtIndex`. Ordinals therefore
 * count the way that toggle counts: list items, nested, inside quotes — never
 * inside fenced code.
 *
 * Adding a sub-task appends a line after the last checkbox of the note, in
 * the same list style, or at the end when the note has none. Editing the
 * wording is what the note is for.
 */
import { FENCE_RE, TASK_LINE_RE } from "./taskToggle";

export interface TaskProgress {
  done: number;
  total: number;
}

/** The index value of `file.tasks` ("3/5") as numbers; null when the note has
 * no checklist (empty string) or the value is not one. */
export function parseTaskProgress(value: unknown): TaskProgress | null {
  if (typeof value !== "string") return null;
  const m = /^(\d+)\/(\d+)$/.exec(value.trim());
  if (!m) return null;
  const total = Number(m[2]);
  if (total <= 0) return null;
  return { done: Math.min(Number(m[1]), total), total };
}

export interface TaskLine {
  /** 0-based checkbox index in document order — what `toggleTaskAtIndex` takes. */
  ordinal: number;
  /** 0-based line index in the content. */
  line: number;
  done: boolean;
  /** The text after the marker, trimmed. */
  text: string;
}

export function listTaskLines(content: string): TaskLine[] {
  const lines = content.split("\n");
  const out: TaskLine[] = [];
  let inFence = false;
  let ordinal = 0;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = lines[i].match(TASK_LINE_RE);
    if (!m) continue;
    const marker = m[1].length + 1 + m[3].length;
    out.push({ ordinal, line: i, done: m[2] !== " ", text: lines[i].slice(marker).trim() });
    ordinal++;
  }
  return out;
}

/**
 * Appends a new open checkbox line. After the last checkbox of the note, with
 * that line's own indentation and list marker (so a nested list stays one);
 * otherwise at the end of the note, as a plain `- [ ]` item on its own line.
 * The text is one line: line breaks would turn the rest into ordinary text.
 */
export function appendTaskLine(content: string, text: string): string {
  const clean = text.replace(/[\r\n]+/g, " ").trim();
  if (!clean) return content;
  const lines = content.split("\n");
  let inFence = false;
  let last: { index: number; prefix: string } | null = null;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = lines[i].match(TASK_LINE_RE);
    if (m) last = { index: i, prefix: m[1].slice(0, -1) };
  }
  if (last) {
    lines.splice(last.index + 1, 0, `${last.prefix}[ ] ${clean}`);
    return lines.join("\n");
  }
  const trailing = content.endsWith("\n") ? content : content.length > 0 ? `${content}\n` : "";
  return `${trailing}- [ ] ${clean}\n`;
}
