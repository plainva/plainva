import { stripAnchorMarkers } from "../../workspace/commentAnchor.js";
import { outlineOf } from "../context/sections.js";

/**
 * A change to a note's text as a model states it (plan KI-Harness P5): the
 * passage it means, word for word, and what should stand there instead.
 *
 * Nothing here writes. The result is the note's text as it would read; what
 * becomes of it — the blocks of a suggestion round — is decided where the
 * round is laid (packages/ui/src/ai/noteWrites.ts). Three rules keep a change
 * from being anything but the one that was asked for:
 *
 * - A passage has to be in the note exactly once. Not at all, and the model
 *   quoted something it did not read; twice, and nobody can say which one was
 *   meant. Either way nothing is guessed.
 * - Only the text of the note counts. The properties at its top are changed
 *   through their own tool, and a passage is never looked for in them.
 * - Everything the note says outside the passages stays byte for byte,
 *   line endings included: a note written with CRLF gets CRLF back.
 */
export interface NoteEdit {
  /** The passage as the note has it. */
  find: string;
  /** What should stand in its place; "" removes the passage. */
  replace: string;
}

/** The bounds of one change. Past them it is a rewrite nobody reviews block by block. */
export const NOTE_EDIT_LIMITS = { edits: 40, find: 4000, replace: 20000, append: 20000 } as const;

export type NoteEditProblem =
  /** No edits, or an edit without a passage. */
  | "empty"
  | "too-many"
  | "too-long"
  /** The passage is not in the text of the note. */
  | "not-found"
  /** The passage — or the section — is there more than once. */
  | "ambiguous"
  /** Two edits name passages that touch. */
  | "overlap"
  /** The note would read as it does. */
  | "unchanged"
  /** There is no section of that name. */
  | "no-section";

export type NoteEditOutcome =
  | { ok: true; text: string }
  /** `edit`: which of the edits (0-based), where one of them is the reason. */
  | { ok: false; problem: NoteEditProblem; edit?: number };

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/;

/** Where the text of a note begins: behind the properties block, or at 0. */
export function noteBodyStart(text: string): number {
  return FRONTMATTER.exec(text)?.[0].length ?? 0;
}

/** A model writes "\n"; the note may be written with "\r\n". */
function inNoteLineEndings(text: string, note: string): string {
  const plain = text.replace(/\r\n?/g, "\n");
  return note.includes("\r\n") ? plain.replace(/\n/g, "\r\n") : plain;
}

const isBreak = (character: string | undefined) => character === "\n" || character === "\r";

/** A paragraph without the line breaks in front of it and the blank space behind it. Counted, not matched: the text is a model's. */
function withoutBlankEdges(text: string): string {
  let start = 0;
  while (start < text.length && isBreak(text[start])) start += 1;
  let end = text.length;
  while (end > start && (isBreak(text[end - 1]) || text[end - 1] === " " || text[end - 1] === "\t")) end -= 1;
  return text.slice(start, end);
}

/** How many line breaks a text ends with. */
function trailingBreaks(text: string): number {
  let count = 0;
  for (let index = text.length - 1; index >= 0 && isBreak(text[index]); index -= 1) if (text[index] === "\n") count += 1;
  return count;
}

function occurrencesFrom(haystack: string, needle: string, from: number): number[] {
  const found: number[] = [];
  for (let index = haystack.indexOf(needle, from); index >= 0; index = haystack.indexOf(needle, index + 1)) found.push(index);
  return found;
}

/**
 * Where a passage is in the note, as a raw range. Looked for in the text as
 * written first; then in the text without the markers comments leave in it
 * (`<!--pv#1a2b-->`) — a reader that drops them quotes a passage that is
 * there, only not letter for letter.
 */
function locate(base: string, start: number, find: string): { from: number; to: number } | "not-found" | "ambiguous" {
  const raw = occurrencesFrom(base, find, start);
  if (raw.length === 1) return { from: raw[0]!, to: raw[0]! + find.length };
  if (raw.length > 1) return "ambiguous";
  const stripped = stripAnchorMarkers(base);
  if (stripped.text.length === base.length) return "not-found";
  const clean = occurrencesFrom(stripped.text, find, stripped.toClean(start));
  if (clean.length === 0) return "not-found";
  if (clean.length > 1) return "ambiguous";
  return { from: stripped.toRaw(clean[0]!), to: stripped.toRaw(clean[0]! + find.length, "before") };
}

/** The note as it would read with these passages replaced, or why not. */
export function applyNoteEdits(base: string, edits: readonly NoteEdit[]): NoteEditOutcome {
  if (edits.length === 0) return { ok: false, problem: "empty" };
  if (edits.length > NOTE_EDIT_LIMITS.edits) return { ok: false, problem: "too-many" };
  const start = noteBodyStart(base);
  const spans: { from: number; to: number; replace: string; edit: number }[] = [];
  for (let edit = 0; edit < edits.length; edit++) {
    const find = inNoteLineEndings(edits[edit]!.find, base);
    const replace = inNoteLineEndings(edits[edit]!.replace, base);
    if (find.length === 0) return { ok: false, problem: "empty", edit };
    if (find.length > NOTE_EDIT_LIMITS.find || replace.length > NOTE_EDIT_LIMITS.replace) return { ok: false, problem: "too-long", edit };
    const place = locate(base, start, find);
    if (typeof place === "string") return { ok: false, problem: place, edit };
    spans.push({ ...place, replace, edit });
  }
  spans.sort((a, b) => a.from - b.from || a.to - b.to);
  for (let index = 1; index < spans.length; index++) {
    if (spans[index]!.from < spans[index - 1]!.to) return { ok: false, problem: "overlap", edit: spans[index]!.edit };
  }
  let text = base;
  for (let index = spans.length - 1; index >= 0; index--) {
    const span = spans[index]!;
    text = text.slice(0, span.from) + span.replace + text.slice(span.to);
  }
  return text === base ? { ok: false, problem: "unchanged" } : { ok: true, text };
}

/**
 * The note with a paragraph added: at its end, or at the end of the section a
 * handle names (the heading chain `get_outline` writes, "Costs > 2026", or a
 * heading's text where only one has it). What is there stays as it is; the
 * addition gets a blank line before it and a line break after it.
 */
export function appendToNote(base: string, addition: string, section?: string): NoteEditOutcome {
  const eol = base.includes("\r\n") ? "\r\n" : "\n";
  const added = withoutBlankEdges(inNoteLineEndings(addition, base));
  if (added.trim().length === 0) return { ok: false, problem: "empty" };
  if (added.length > NOTE_EDIT_LIMITS.append) return { ok: false, problem: "too-long" };

  let at = base.length;
  if (section !== undefined && section.trim()) {
    const start = noteBodyStart(base);
    const body = base.slice(start);
    const headings = outlineOf(body);
    const wanted = section.trim().toLowerCase();
    // Reading takes the first section of a name; writing takes none where two have it.
    const byChain = headings.filter((heading) => heading.chain.toLowerCase() === wanted);
    const named = byChain.length > 0 ? byChain : headings.filter((heading) => heading.text.toLowerCase() === wanted);
    if (named.length === 0) return { ok: false, problem: "no-section" };
    if (named.length > 1) return { ok: false, problem: "ambiguous" };
    const found = headings.indexOf(named[0]!);
    const head = headings[found]!;
    const next = headings.slice(found + 1).find((heading) => heading.level <= head.level);
    if (next) {
      // The offset of the next heading's line: the section ends before it.
      let offset = 0;
      for (let line = 0; line < next.line; line++) offset = body.indexOf("\n", offset) + 1;
      at = start + offset;
    }
  }

  const before = base.slice(0, at);
  const after = base.slice(at);
  // Nothing that is there is touched — not even a line break: the addition brings only as many of its own as a
  // blank line before it still needs, and one blank line towards a section that follows.
  const breaks = trailingBreaks(before);
  const lead = before.trim().length === 0 ? "" : eol.repeat(Math.max(0, 2 - breaks));
  const tail = after.length === 0 ? eol : `${eol}${eol}`;
  return { ok: true, text: `${before}${lead}${added}${tail}${after}` };
}
