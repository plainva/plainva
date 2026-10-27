import { presentableDiff } from "@codemirror/merge";
import { addressesIn, lintReach, preWriteLint, sureFencedCode, type TextRange } from "@plainva/core";

/**
 * Network addresses in text the AI wrote, before it is stored (ADR 0019 §6,
 * threat T1 "rendering beacon").
 *
 * A model under prompt injection can write `![](https://host/?d=…)` into its
 * answer; rendering fetches the image, and whatever it put after `?d=` has
 * left the device without ever passing the send overview. So every address
 * the model BROUGHT is made inert (`https[://]host/…`), wherever it stands:
 * readable, and neither loaded nor clickable.
 *
 * An address the user's own text already carries stays what it is — a rewrite
 * keeps the links of the passage it rewrites. "Already carries" means the
 * whole address, as the renderer reads it where the model wrote it (strand 6,
 * Nr. 12): the whole destination, the whole value of an attribute, the whole
 * address GFM links. Allowing its HOST would let the model hang data onto a
 * host the note merely mentions, and the note is where an injected instruction
 * comes from in the first place — and so would an address the model may go on
 * writing past: `<https://known/a ?d=…>`, `src="https://known/a ?d=…"`.
 *
 * This runs for everything the session writes on the model's behalf: the
 * blocks of a suggestion round, a transcript, a reply in a comment thread.
 * Until 2026-10-06 the linter of the core had tests and no caller.
 */
export function defuseNewAddresses(text: string, known: readonly string[]): { text: string; defused: number } {
  return lintKnowing(text, addressesOf(known));
}

/** The addresses of the texts read last: a write lints value after value against the same note and the same turns. */
const READ = new Map<string, readonly string[]>();
const READ_MAX = 16;

/** The addresses the texts carry, each as the linter reads it where it stands there. */
function addressesOf(known: readonly string[]): string[] {
  return known.flatMap((source) => {
    const cached = READ.get(source);
    if (cached) return [...cached];
    const read = addressesIn(source);
    if (READ.size >= READ_MAX) READ.delete(READ.keys().next().value!);
    READ.set(source, read);
    return read;
  });
}

function lintKnowing(text: string, addresses: readonly string[]): { text: string; defused: number } {
  const linted = preWriteLint(text, { known: addresses });
  return { text: linted.text, defused: linted.findings.length };
}

/**
 * A note's text as an assistant writes it whole — a new note, a draft, an
 * answer kept as a note, a reply in a thread, an edit of a note (strand 6,
 * Nr. 12). Only what the write brings is linted: against the note it replaces
 * (`base`), the paragraphs a change touches, whole — half an address is none —,
 * and every other byte stays as the note had it, the user's own code and HTML
 * included. In what is linted, the code every renderer shows as code
 * (`sureFencedCode`) stays as written: an example of HTML, or a command with
 * an address in it, is code, not a page.
 *
 * What the rest of the note makes of a change is read with it (`lintReach`): an
 * HTML block that keeps its text raw over blank lines, and a tag left open, are
 * read together with the change that stands in them; a `<style>` or a `<form>`
 * before a change, and a `<base>` anywhere, are read with it too, so that what
 * the change brings is no style sheet, no form's field and no address resolved
 * against an attacker's base. A part of a note that is placed into another — a
 * property's value, a rewritten passage — is no note of its own, and goes
 * through `defuseNewAddresses` whole.
 */
export function defuseNoteText(next: string, known: readonly string[], base: string | null = null): { text: string; defused: number } {
  const code = sureFencedCode(next);
  const touched = base === null ? [{ from: 0, to: next.length }] : merged([...changedParagraphs(base, next), ...activatedDefinitions(next)]);
  const changed = without(touched, code);
  if (changed.length === 0) return { text: next, defused: 0 };
  const spans = base === null ? changed : widened(next, changed);
  // A reference definition that is only defined, never used, is dormant: it renders nothing, so its address is not one
  // the user's text "already carries". It shields nothing, and once a change here uses it, `activatedDefinitions` has
  // put its line among the linted spans so it is defused (strand 6, Nr. 12, finding 2026-10-27).
  const addresses = addressesOf(known.map(withoutDormantDefinitions));
  let out = "";
  let at = 0;
  let defused = 0;
  const lint = (from: number, to: number) => {
    if (from >= to) return;
    const linted = lintKnowing(next.slice(from, to), addresses);
    out += linted.text;
    defused += linted.defused;
  };
  for (const span of spans) {
    out += next.slice(at, span.from);
    let cursor = span.from;
    for (const block of code) {
      if (block.to <= cursor || block.from >= span.to) continue;
      lint(cursor, Math.max(cursor, block.from));
      const end = Math.min(block.to, span.to);
      out += next.slice(Math.max(cursor, block.from), end);
      cursor = end;
    }
    lint(cursor, span.to);
    at = span.to;
  }
  return { text: out + next.slice(at), defused };
}

/** The spans less the ranges: a change inside code every renderer shows as code needs no check. */
function without(spans: TextRange[], ranges: readonly TextRange[]): TextRange[] {
  const out: TextRange[] = [];
  for (const span of spans) {
    let pieces = [span];
    for (const range of ranges) {
      pieces = pieces.flatMap((piece) => {
        if (range.to <= piece.from || range.from >= piece.to) return [piece];
        return [
          { from: piece.from, to: range.from },
          { from: range.to, to: piece.to },
        ].filter((rest) => rest.from < rest.to);
      });
    }
    out.push(...pieces);
  }
  return out;
}

/** The changed spans with what the rest of the note makes of them, each a run of whole paragraphs, merged where they meet. */
function widened(text: string, changed: TextRange[]): TextRange[] {
  const reach = lintReach(text);
  const lastEnd = Math.max(...changed.map((span) => span.to));
  let spans = merged([...changed, ...reach.armed.filter((tag) => tag.global || tag.at < lastEnd).map((tag) => paragraphAround(text, tag.at, tag.at))]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const range of reach.together) {
      const meets = spans.some((span) => span.from < range.to && range.from < span.to);
      const covered = spans.some((span) => span.from <= range.from && range.to <= span.to);
      if (!meets || covered) continue;
      spans = merged([...spans, paragraphAround(text, range.from, range.to)]);
      grew = true;
    }
  }
  return spans;
}

/** The ranges in order, those that overlap or touch made one. */
function merged(ranges: TextRange[]): TextRange[] {
  const out: TextRange[] = [];
  for (const range of [...ranges].sort((a, b) => a.from - b.from)) {
    const last = out[out.length - 1];
    if (last && range.from <= last.to) last.to = Math.max(last.to, range.to);
    else out.push({ ...range });
  }
  return out;
}

/** The paragraphs of `next` a change against `base` touches, merged where they meet or touch. */
function changedParagraphs(base: string, next: string): TextRange[] {
  return merged(presentableDiff(base, next).map((change) => paragraphAround(next, change.fromB, change.toB)));
}

// A reference definition at the start of its line — after up to three spaces, block-quote markers and a list item's
// marker, since CommonMark resolves a definition inside a container too; its destination may follow on the next line,
// which the paragraph then holds. A label carries no unescaped bracket and may run across lines (bounded, so the scan
// cannot blow up).
const DEFINITION = /^[ \t>]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+)?\[((?:[^[\]\\]|\\.){1,200})\]:/gm;
/** The label of a reference, normalised the way CommonMark matches one: case-folded, its inner whitespace collapsed. */
const normalizeLabel = (label: string): string => label.trim().toLowerCase().replace(/\s+/g, " ");

/** The labels a text references somewhere that is not a definition — a full, collapsed or shortcut reference all read as `[label]` not followed by a colon. */
function referencedLabels(text: string): Set<string> {
  const used = new Set<string>();
  for (const m of text.matchAll(/\[([^[\]\n]+)\]/g)) {
    if (text[m.index + m[0].length] !== ":") used.add(normalizeLabel(m[1]!));
  }
  return used;
}

/** The paragraph of every reference definition in `next` whose label `next` also uses: a change may have added the use that wakes it. */
function activatedDefinitions(next: string): TextRange[] {
  if (!next.includes("]:")) return [];
  const used = referencedLabels(next);
  const spans: TextRange[] = [];
  for (const m of next.matchAll(DEFINITION)) {
    if (used.has(normalizeLabel(m[1]!))) spans.push(paragraphAround(next, m.index, m.index));
  }
  return spans;
}

/** A text with its dormant reference definitions — defined, never used — blanked, so their addresses are not read as the user's own. */
function withoutDormantDefinitions(text: string): string {
  if (!text.includes("]:")) return text;
  const used = referencedLabels(text);
  const chars = text.split("");
  let changed = false;
  for (const m of text.matchAll(DEFINITION)) {
    if (used.has(normalizeLabel(m[1]!))) continue;
    const { from, to } = paragraphAround(text, m.index, m.index);
    for (let i = from; i < to; i++) if (chars[i] !== "\n") chars[i] = " ";
    changed = true;
  }
  return changed ? chars.join("") : text;
}

/** Where a line begins (the index of its first character) and where the next one does. */
const lineStartAt = (text: string, index: number) => text.lastIndexOf("\n", index - 1) + 1;
const nextLineAt = (text: string, index: number) => {
  const end = text.indexOf("\n", index);
  return end < 0 ? text.length : end + 1;
};
/** A blank line as CommonMark has one: spaces and tabs only — a line of other blanks goes on with its paragraph. */
const isBlankLine = (line: string) => /^[ \t]*\r?\n?$/.test(line);

/** From the first line of the paragraph `from` stands in to the end of the paragraph `to` stands in: up to a blank line, or an edge of the text. */
function paragraphAround(text: string, from: number, to: number): TextRange {
  let start = lineStartAt(text, Math.min(from, text.length));
  while (start > 0) {
    const previous = lineStartAt(text, start - 1);
    if (isBlankLine(text.slice(previous, start))) break;
    start = previous;
  }
  let end = nextLineAt(text, Math.max(to, start));
  while (end < text.length) {
    const after = nextLineAt(text, end);
    if (isBlankLine(text.slice(end, after))) break;
    end = after;
  }
  return { from: start, to: end };
}
