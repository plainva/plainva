import { plainWikiLinkInner, wikiLinkParts } from "./wikiLink.js";

/**
 * What the reading view writes for one wiki link (`prepareReaderSource`): a
 * Markdown link to `wiki://…`, or an image to `wiki-embed://…` for `![[…]]`.
 * One definition for the reading view and for the table budget
 * (`inlineParseBudget.ts`), which weighs a wiki link in a table by this text,
 * so that the index never weighs a link lighter than the reading view does.
 */

/**
 * What an `![[...]]` embed points at. `note` is the fallback: everything that
 * is neither a picture nor a sound is another note, which the reader expands.
 */
export type ReaderEmbedKind = "image" | "audio" | "note";

const encodeTarget = (text: string) => encodeURIComponent(text).replace(/[()!'*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/** An alias longer than this is not looked through for its code spans; it is shown as it is written. */
const LONGEST_LABEL_READ = 2000;

/**
 * Whether a wiki link's alias can stand as the text of a Markdown link the way
 * it is written — the renderer then shows it as it shows the text around it:
 * `*the* alias` with its emphasis, a code span as one. It can where it keeps
 * to itself: no bracket in it (one would end the link text, or open a link of
 * its own), no `<`, no bare `|` (a table counts the cells of a line by them),
 * no `$` anywhere — once a note's math is read, a `$` pairs with one outside
 * the link, behind a backslash and in a code span too, for math reads
 * neither —, no backslash left over at its end, no `^` at its start (a
 * footnote's sign there), and every code span it opens closed again.
 */
function labelKeepsToItself(label: string): boolean {
  if (label.length > LONGEST_LABEL_READ || label.startsWith("^") || label.includes("$")) return false;
  // A table splits its line at every bar a backslash does not stand in front
  // of, in a code span too: it does so before anything else is read.
  for (let at = 0; at < label.length; at++) {
    if (label[at] === "\\") at++;
    else if (label[at] === "|") return false;
  }
  for (let at = 0; at < label.length; at++) {
    const char = label[at];
    if (char === "[" || char === "]" || char === "<") return false;
    if (char === "\\") {
      // The backslash and what it stands in front of are one piece — a `\|` the bar it spells.
      if (++at === label.length) return false;
    } else if (char === "`") {
      let run = 1;
      while (label[at + run] === "`") run++;
      // A code span ends at the next run of as many backticks.
      let close = at + run;
      for (;;) {
        close = label.indexOf("`", close);
        if (close < 0) return false;
        let length = 1;
        while (label[close + length] === "`") length++;
        if (length === run) break;
        close += length;
      }
      at = close + run - 1;
    }
  }
  return true;
}

/** CommonMark's ASCII punctuation: what a backslash in front of it escapes. */
const ASCII_PUNCTUATION = /[!-/:-@[-\x60{-~]/;
/** A letter or a digit: a run of `_` between two of them opens and closes nothing. */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;
/** An `&` that begins a character reference; one in front of anything else stays an `&`. */
const CHARACTER_REFERENCE = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{0,31});/y;

/**
 * What has to be spelled out in a label, so that the text of a Markdown link
 * shows it character for character as it is written: each such character with
 * its place in the label and its spelling. Only what Markdown would read
 * something into is spelled out — `my_note` and `Tom & Jerry` stand as they
 * are written, and a place in them stays a place in the rendered text.
 *
 * A backtick and a `$` are spelled as character references, not escaped:
 * inside a code span or math a backslash is a character like any other, so
 * `` \` `` would still close a code span opened before the link
 * (`Don`t [[Note|a `` b]]`), and `\$` the math of a `$` before it. A bare `|`
 * is escaped, for a table counts the cells of a line by them; a `\|` stays
 * the bar it spells (`wikiLink.ts`). (A `==…==` the reader marks wherever it
 * stands: it reads the text, not how it is written.)
 */
function* labelSpellings(label: string): Generator<{ at: number; text: string }> {
  for (let at = 0; at < label.length; at++) {
    const char = label[at];
    if (char === "\\") {
      const next = label[at + 1];
      if (next === "|") at++;
      // It escapes what follows it where that is punctuation — at the label's
      // end, the bracket that closes the link text.
      else if (next === undefined || ASCII_PUNCTUATION.test(next)) yield { at, text: "\\\\" };
    } else if (char === "_") {
      let end = at;
      while (label[end + 1] === "_") end++;
      const inert = at > 0 && end + 1 < label.length && WORD_CHARACTER.test(label[at - 1]) && WORD_CHARACTER.test(label[end + 1]);
      if (!inert) for (let mark = at; mark <= end; mark++) yield { at: mark, text: "\\_" };
      at = end;
    } else if (char === "&") {
      CHARACTER_REFERENCE.lastIndex = at;
      if (CHARACTER_REFERENCE.test(label)) yield { at, text: "\\&" };
    } else if (char === "`") yield { at, text: "&#96;" };
    else if (char === "$") yield { at, text: "&#36;" };
    else if (char === "^") {
      // A footnote's sign only where it opens the link text.
      if (at === 0) yield { at, text: "\\^" };
    } else if ("*~[]<>|".includes(char)) yield { at, text: `\\${char}` };
  }
}

export interface ReaderWikiLink {
  /** What stands in the reading view's text for `[[inner]]` (or `![[inner]]`). */
  text: string;
  /** Where the label begins in `inner`. */
  labelStart: number;
  /** Stretches of the label (`from`/`to` within it) that stand in `text` as they are written (`start`/`end`). */
  visible: Array<{ from: number; to: number; start: number; end: number }>;
  /** The note an embed shows, for a note embed. */
  embed?: string;
}

/**
 * The reading view's text for the wiki link `[[inner]]` (`embed`:
 * `![[inner]]`); `inner` is not empty. `places: false` leaves `visible`
 * empty, for a reader of the text alone (the table budget). The text is built
 * from its pieces in one join, and a label's spellings are walked one by one:
 * a label of a million `[` is a million spellings, held at once they ran the
 * scan out of memory (review, 2026-11-16).
 */
export function readerWikiLink(inner: string, embed: boolean, embedKind?: (target: string) => ReaderEmbedKind, places = true): ReaderWikiLink {
  if (embed) {
    // The renderer cuts the target at `|` itself.
    const target = plainWikiLinkInner(inner);
    // Three kinds, one scheme each, so the renderer branches on the URL
    // rather than sniffing the extension a second time (plan
    // Journal-Erweiterungen, X3). The fallback pattern stands for a host
    // that passes no port - it used to be the only answer.
    const kind = embedKind?.(target) ?? (/\.(?:png|jpe?g|gif|svg|webp|bmp|avif)(?:\||$)/i.test(target) ? "image" : "note");
    const scheme = kind === "note" ? "embed" : kind;
    const alt = kind === "image" ? "img" : kind === "audio" ? "audio" : "embed";
    return { text: `![${alt}](wiki-${scheme}://${encodeTarget(target)})`, labelStart: 0, visible: [], embed: kind === "note" ? target : undefined };
  }
  const parts = wikiLinkParts(inner);
  const target = inner.slice(0, parts.headEnd);
  const labelStart = parts.aliasStart < 0 ? 0 : parts.aliasStart;
  const label = inner.slice(labelStart);
  // A name is a file's name, shown as it is written — `[[__init__]]` is
  // no bold "init", `[[Tom &amp; Jerry]]` no "Tom & Jerry" —, the name
  // the link opens: what Markdown would read something into is spelled
  // out. An alias is the text the link shows, shown as the text around
  // it is where it keeps to itself.
  const spellings = parts.aliasStart < 0 || !labelKeepsToItself(label) ? labelSpellings(label) : [];
  // One edit for the link, so that a place in what it hides (`[[`, a
  // target before an alias) stands for the whole link.
  const pieces = ["["];
  let length = 1;
  const visible: ReaderWikiLink["visible"] = [];
  let at = 0;
  const take = (spelled: { at: number; text: string }) => {
    if (spelled.at > at) {
      if (places) visible.push({ from: at, to: spelled.at, start: length, end: length + spelled.at - at });
      pieces.push(label.slice(at, spelled.at));
      length += spelled.at - at;
    }
    if (spelled.text) pieces.push(spelled.text);
    length += spelled.text.length;
    at = spelled.at + 1;
  };
  for (const spelled of spellings) take(spelled);
  take({ at: label.length, text: "" });
  pieces.push(`](wiki://${encodeTarget(target)})`);
  return { text: pieces.join(""), labelStart, visible };
}

/**
 * What the reading view writes in front of a wiki link that stands behind a
 * `]`: the link's text would read as the label of a reference there
 * (`[x][[a]]` with `[a]: …` became `[x][a]` and a `(wiki://a)`, Sammelplan
 * § 3.133 Nr. 3), so an empty comment, which the renderer drops, stands
 * between them. Not in front of an embed (`]![…]` reads no label), and not on
 * a line that may be code — four blanks before the `]`, which a block a
 * formula closes leaves as code: nothing written in is ever seen. One
 * definition for the reading view and the table budget, which weighs it too.
 */
export function readerWikiLinkLead(text: string, from: number, embed: boolean): string {
  return !embed && text[from - 1] === "]" && !mayBeCode(text, from - 1) ? READER_WIKI_LINK_LEAD : "";
}

/** The comment `readerWikiLinkLead` writes. */
const READER_WIKI_LINK_LEAD = "<!---->";

/** Whether `at` stands behind nothing but blanks (and quote marks) on its line, four of them or more: code, where a formula closed the block above. */
function mayBeCode(text: string, at: number): boolean {
  let blanks = 0;
  for (let i = at - 1; i >= 0 && text[i] !== "\n"; i--) {
    if (text[i] === " ") blanks++;
    else if (text[i] === "\t") blanks += 4;
    else if (text[i] !== ">" && text[i] !== "\r") return false;
  }
  return blanks >= 4;
}
