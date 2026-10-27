import { atxHeading, createFenceTracker, readQuoteDepth } from "@plainva/core";

/**
 * The block structure of an AI answer (P1a): paragraphs, headings, lists,
 * quotes, code blocks, rules and tables. Pure and total — any text parses,
 * nothing throws — because an answer is rendered while it streams in and is
 * untrusted content: the renderer builds elements from these blocks and the
 * inline parser (`parseInlineMarkdown`), never HTML, so a tag in an answer is
 * text, and an image is shown as a link that loads nothing until clicked.
 */

export type AnswerBlock =
  | { kind: "paragraph"; text: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: AnswerListItem[] }
  | { kind: "quote"; blocks: AnswerBlock[] }
  | { kind: "code"; lang: string; text: string }
  | { kind: "rule" }
  | { kind: "table"; header: string[]; rows: string[][] };

export interface AnswerListItem {
  text: string;
  /** `- [ ]` / `- [x]`: shown as a box, never an input — an answer ticks nothing. */
  task?: "open" | "done";
  /** Deeper items, one level per two spaces of indent. */
  depth: number;
}

/** The language an opening fence names: the first word of its info string. */
function fenceLang(line: string): string {
  const rest = line.trimStart();
  let run = 0;
  while (run < rest.length && rest[run] === rest[0]) run++;
  const info = rest.slice(run).trimStart();
  const end = info.search(/[\s`]/);
  return end < 0 ? info : info.slice(0, end);
}
// Linear patterns only: they run on untrusted model output, so no two
// quantifiers may trade characters (eslint-plugin-regexp, super-linear
// backtracking). What a pattern cannot say linearly, code does.
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const BULLET = /^([ \t]*)([-*+])[ \t]([^\n]*)$/;
const ORDERED = /^([ \t]*)(\d{1,9})[.)][ \t]([^\n]*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
/** A table's delimiter row: cells of at least three dashes, colons for alignment. */
function isTableSeparator(line: string): boolean {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}



function cells(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const out: string[] = [];
  let current = "";
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === "\\" && trimmed[i + 1] === "|") {
      current += "|";
      i++;
    } else if (ch === "|") {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  out.push(current.trim());
  return out;
}

function listItem(indent: string, text: string): AnswerListItem {
  const depth = Math.min(4, Math.floor(indent.replace(/\t/g, "  ").length / 2));
  const task = /^\[( |x|X)\]\s+/.exec(text);
  return task ? { text: text.slice(task[0].length), task: task[1] === " " ? "open" : "done", depth } : { text, depth };
}

/** How deep quotes nest before their inner lines are read as text: the answer is untrusted, and each level reads it again. */
const QUOTE_DEPTH = 8;

export function parseAnswer(markdown: string, depth = 0): AnswerBlock[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: AnswerBlock[] = [];
  let i = 0;
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  while (i < lines.length) {
    const line = lines[i];
    // A fence by the one rule of every scanner (`markdownFence.ts`): "```x```" at the start of a line is a code span,
    // only a run at least as long as the opening one closes the block, and a quote's fence is the quote's (below).
    const fence = createFenceTracker();
    if (readQuoteDepth(line).depth === 0 && fence.step(line) === "open") {
      flush();
      const body: string[] = [];
      i++;
      // An unclosed fence (the answer is still streaming) runs to the end.
      while (i < lines.length && fence.step(lines[i]) === "code") body.push(lines[i++]);
      i++;
      blocks.push({ kind: "code", lang: fenceLang(line), text: body.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      i++;
      continue;
    }
    const heading = atxHeading(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", level: heading.level, text: heading.text });
      i++;
      continue;
    }
    if (RULE.test(line) && !paragraph.length) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      flush();
      const inner: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) inner.push(QUOTE.exec(lines[i++])![1]);
      blocks.push({ kind: "quote", blocks: depth < QUOTE_DEPTH ? parseAnswer(inner.join("\n"), depth + 1) : [{ kind: "paragraph", text: inner.join("\n") }] });
      continue;
    }
    const bullet = BULLET.exec(line);
    const ordered = ORDERED.exec(line);
    if (bullet || ordered) {
      flush();
      const isOrdered = !bullet;
      const start = ordered ? Number(ordered[2]) : 1;
      const items: AnswerListItem[] = [];
      while (i < lines.length) {
        const b = BULLET.exec(lines[i]);
        const o = ORDERED.exec(lines[i]);
        const m = isOrdered ? o ?? (b && b[1].length >= 2 ? b : null) : b ?? (o && o[1].length >= 2 ? o : null);
        if (m) {
          items.push(listItem(m[1], m[3].trimStart()));
          i++;
          continue;
        }
        // A lazy continuation line belongs to the item above it.
        if (lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && items.length) {
          items[items.length - 1].text += `\n${lines[i].trim()}`;
          i++;
          continue;
        }
        break;
      }
      blocks.push({ kind: "list", ordered: isOrdered, start, items });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flush();
      const header = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ kind: "table", header, rows: rows.map((r) => header.map((_, c) => r[c] ?? "")) });
      continue;
    }
    paragraph.push(line);
    i++;
  }
  flush();
  return blocks;
}
