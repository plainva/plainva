import { AI_POLICY_DIMENSIONS, type AiPolicyDimension } from "../policy.js";
import { stripInvisible } from "../trust.js";

/**
 * The vault's memory for assistants (plan KI-Harness P6, ADR 0027): what an
 * assistant should know about the user and their work, kept as two Markdown
 * files in the hidden `.agent/` area — so it travels with the vault, can be
 * read and edited by hand, and belongs to no provider.
 *
 * - `active_memory.md` — the little that goes into every new conversation.
 *   It has a budget, because every request pays for it.
 * - `MEMORY.md` — everything else. It never goes along on its own: a
 *   conversation looks into it with a tool when a question may depend on it.
 *
 * An entry is a list item at the start of a line; headings group entries.
 * Everything else in the file is left alone and means nothing here. What the
 * app knows about an entry beyond its text — when it was added, by whom, what
 * it rests on, which rules it carries — stands in an HTML comment at the end
 * of the entry, so the file stays a note that reads as one:
 *
 *     - Ms Petersen is my tax adviser. <!-- plainva: added=2026-10-09; by=assistant; deny=cloud -->
 *
 * Memory is DATA (tier 3): an entry tells an assistant what is, never what to
 * do, and it reaches a model inside the same fence as a note's text. What an
 * assistant should always do is a standing instruction; those live in the
 * vault's `AGENTS.md` and need the user's approval on each device.
 *
 * This file is the format: reading entries out of a file's text, and changing
 * one entry in it without touching anything else. A comment that cannot be
 * read makes its entry one that goes nowhere — a rule that is lost must never
 * read as "no rule".
 */

export const ACTIVE_MEMORY_FILE = ".agent/active_memory.md";
export const LONG_MEMORY_FILE = ".agent/MEMORY.md";

export type MemoryPlace = "active" | "long";
export const MEMORY_PLACES: readonly MemoryPlace[] = ["active", "long"];

export function memoryFileOf(place: MemoryPlace): string {
  return place === "active" ? ACTIVE_MEMORY_FILE : LONG_MEMORY_FILE;
}

export const MEMORY_LIMITS = {
  /** What "always with it" may hold, in characters of entry text: about 500 tokens in every request. */
  activeChars: 2_000,
  /** One entry: a sentence or two. A longer one is a note, and belongs in the vault as one. */
  entryChars: 500,
  /** A memory file larger than this is not read at all — it is no list of sentences any more. */
  fileBytes: 262_144,
  /** Entries read from one file; what follows is not memory. */
  entries: 2_000,
  /** What one line of the comment may name as a source. */
  sourceChars: 160,
} as const;

/** Who put an entry there: the user by their own hand, or an assistant whose proposal the user accepted. */
export type MemoryWriter = "user" | "assistant";

export interface MemoryMeta {
  /** The civil day it was added. */
  added: string | null;
  by: MemoryWriter | null;
  /** What it rests on, in words for the user: a conversation's title. Never a path of a note the rules keep back. */
  source: string | null;
  /** The rules it carries: it reaches no recipient one of them keeps out. */
  deny: AiPolicyDimension[];
}

export interface MemoryEntry extends MemoryMeta {
  /** Stable while the text stands: the place, a hash of the text, and which of equal texts it is. */
  id: string;
  place: MemoryPlace;
  /** The entry as a reader sees it and as a model gets it: one line, nothing invisible, no comment. */
  text: string;
  /** The heading it stands under; null before the first one. */
  section: string | null;
  /** Its comment could not be read: it counts as kept from everybody. */
  unreadable: boolean;
  /** Longer than an entry may be: it is shown, and goes nowhere. */
  tooLong: boolean;
  /** How many things were taken out of its text that a reader would not see: comments, characters that draw nothing. */
  hidden: number;
  /** The first of its lines in the file, counted from 0, and how many it spans. */
  line: number;
  lines: number;
}

export interface ParsedMemory {
  entries: MemoryEntry[];
  /** The file holds more entries than are read. */
  more: boolean;
}

/** A list item's marker and a heading's: what stands behind either is taken as text, never matched. */
const BULLET = /^[-*+][ \t]+/;
const HEADING = /^#{1,6}[ \t]+/;
const CONTINUATION = /^(?: {2,}|\t)\S/;
const FENCE = /^(?:```|~~~)/;
/** The app's own comment: written at the end of an entry, read wherever it stands in one. */
const META_OPEN = /<!--[ \t]*plainva:/g;
const META_WHOLE = /<!--[ \t]*plainva:([\s\S]*?)-->/g;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** A byte order mark at the start of a file is no part of its first line. */
const BOM = 0xfeff;

const NO_META: MemoryMeta = { added: null, by: null, source: null, deny: [] };

/**
 * What the app wrote about an entry, from the entry's raw text. An entry
 * without the app's comment has none. One with exactly one whole comment has
 * what that says — wherever the comment stands, so text typed behind it does
 * not set the entry free. Anything else — a comment that is not closed, two
 * of them, one that does not have the form — is null: unreadable.
 */
function metaOf(raw: string): MemoryMeta | null {
  const opened = raw.match(META_OPEN)?.length ?? 0;
  if (opened === 0) return NO_META;
  const whole = [...raw.matchAll(META_WHOLE)];
  return opened === 1 && whole.length === 1 ? parseMemoryMeta(whole[0]![1]!) : null;
}

/** FNV-1a over UTF-16 units, twice with different seeds: 64 bits as hex. Not a secret — an id that survives a reload. */
function textHash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const unit = text.charCodeAt(index);
    a = Math.imul(a ^ unit, 0x01000193) >>> 0;
    b = Math.imul(b ^ (unit + index), 0x85ebca6b) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

/**
 * What stands in an entry's comment. Null where it does not have the form:
 * a key that is known with a value that is not, a rule that does not exist.
 * A key nobody knows is skipped — a later version may write one.
 */
export function parseMemoryMeta(raw: string): MemoryMeta | null {
  const meta: MemoryMeta = { added: null, by: null, source: null, deny: [] };
  for (const part of raw.split(";")) {
    const pair = part.trim();
    if (!pair) continue;
    const cut = pair.indexOf("=");
    if (cut <= 0) return null;
    const key = pair.slice(0, cut).trim();
    const value = pair.slice(cut + 1).trim();
    if (key === "added") {
      if (!DAY.test(value)) return null;
      meta.added = value;
    } else if (key === "by") {
      if (value !== "user" && value !== "assistant") return null;
      meta.by = value;
    } else if (key === "source") {
      meta.source = value.slice(0, MEMORY_LIMITS.sourceChars) || null;
    } else if (key === "deny") {
      const rules = value.split(",").map((rule) => rule.trim()).filter(Boolean);
      if (rules.length === 0 || !rules.every((rule) => (AI_POLICY_DIMENSIONS as readonly string[]).includes(rule))) return null;
      meta.deny = AI_POLICY_DIMENSIONS.filter((dimension) => rules.includes(dimension));
    }
  }
  return meta;
}

/** A source as the comment can carry it: one line, without what would end a pair or the comment. */
function sourceText(value: string): string {
  return stripInvisible(value).text.replace(/\s+/g, " ").replace(/;/g, ",").replace(/--+/g, "–").replace(/[<>]/g, "").trim().slice(0, MEMORY_LIMITS.sourceChars);
}

/** The comment for an entry; "" where there is nothing to say. */
export function serializeMemoryMeta(meta: Partial<MemoryMeta>): string {
  const pairs: string[] = [];
  if (meta.added && DAY.test(meta.added)) pairs.push(`added=${meta.added}`);
  if (meta.by) pairs.push(`by=${meta.by}`);
  const source = meta.source ? sourceText(meta.source) : "";
  if (source) pairs.push(`source=${source}`);
  const deny = AI_POLICY_DIMENSIONS.filter((dimension) => meta.deny?.includes(dimension));
  if (deny.length) pairs.push(`deny=${deny.join(",")}`);
  return pairs.length ? `<!-- plainva: ${pairs.join("; ")} -->` : "";
}

/**
 * An entry's text as it is kept and shown: one line, nothing a reader would
 * not see. Comments go — in a file that is rendered they are text only a
 * model would read —, and so do the characters that draw nothing.
 */
export function cleanMemoryText(raw: string): { text: string; hidden: number } {
  let hidden = 0;
  // A comment that is never closed hides everything behind it; so does this.
  let text = raw.replace(/<!--[\s\S]*?(?:-->|$)/g, () => {
    hidden += 1;
    return " ";
  });
  const visible = stripInvisible(text);
  hidden += visible.removed;
  text = visible.text.replace(/\s+/g, " ").trim();
  return { text, hidden };
}

/**
 * A heading's text, without the closing run of `#` Markdown allows behind it
 * ("## Clients ##"). The run counts only behind a blank: "C#" keeps its sign.
 */
function headingText(rest: string): string {
  const text = rest.trimEnd();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  if (end === text.length || (end > 0 && text[end - 1] !== " " && text[end - 1] !== "\t")) return text.trim();
  return text.slice(0, end).trim();
}

/** Where the body of a file begins: behind a YAML block at its very top, if it has one. */
function bodyStart(lines: readonly string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let index = 1; index < lines.length; index++) if (lines[index]!.trim() === "---" || lines[index]!.trim() === "...") return index + 1;
  // A block that never closes is the whole file: nothing in it is an entry.
  return lines.length;
}

/** The entries of a memory file, in the order they stand in it. */
export function parseMemory(text: string | null, place: MemoryPlace): ParsedMemory {
  if (text === null) return { entries: [], more: false };
  const lines = (text.charCodeAt(0) === BOM ? text.slice(1) : text).split(/\r?\n/);
  const entries: MemoryEntry[] = [];
  const seen = new Map<string, number>();
  let section: string | null = null;
  let fenced = false;
  let more = false;
  for (let index = bodyStart(lines); index < lines.length; index++) {
    const line = lines[index]!;
    if (FENCE.test(line.trimStart())) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const heading = HEADING.exec(line);
    if (heading) {
      section = cleanMemoryText(headingText(line.slice(heading[0].length))).text || null;
      continue;
    }
    const bullet = BULLET.exec(line);
    if (!bullet) continue;
    let raw = line.slice(bullet[0].length);
    let span = 1;
    while (index + span < lines.length && CONTINUATION.test(lines[index + span]!)) {
      raw += ` ${lines[index + span]!.trim()}`;
      span += 1;
    }
    const first = index;
    index += span - 1;
    const meta = metaOf(raw);
    const cleaned = cleanMemoryText(raw);
    // A line that only held a comment, or nothing: no entry.
    if (!cleaned.text) continue;
    // The app's own comment is not something hidden in the text — whole, damaged or there twice: what a damaged one
    // does to the entry is said by `unreadable`. One that was never closed took what stood behind it as one piece.
    cleaned.hidden = Math.max(0, cleaned.hidden - (raw.match(META_OPEN)?.length ?? 0));
    if (entries.length >= MEMORY_LIMITS.entries) {
      more = true;
      break;
    }
    const hash = textHash(cleaned.text);
    const nth = seen.get(hash) ?? 0;
    seen.set(hash, nth + 1);
    entries.push({
      id: `${place}:${hash}:${nth}`,
      place,
      text: cleaned.text,
      section,
      added: meta?.added ?? null,
      by: meta?.by ?? null,
      source: meta?.source ?? null,
      // A comment that cannot be read loses nothing: the entry is kept from every recipient a rule can name.
      deny: meta ? [...meta.deny] : [...AI_POLICY_DIMENSIONS],
      unreadable: meta === null,
      tooLong: cleaned.text.length > MEMORY_LIMITS.entryChars,
      hidden: cleaned.hidden,
      line: first,
      lines: span,
    });
  }
  return { entries, more };
}

/** Why a text cannot become an entry; null where it can. */
export function memoryTextProblem(text: string): "empty" | "too-long" | "lines" | null {
  if (/[\r\n]/.test(text.trim())) return "lines";
  const cleaned = cleanMemoryText(text).text;
  if (!cleaned) return "empty";
  return cleaned.length > MEMORY_LIMITS.entryChars ? "too-long" : null;
}

/** An entry as a line of the file. The text is written as it is shown: one line, nothing invisible. */
function entryLine(text: string, meta: Partial<MemoryMeta>): string {
  // A text that begins like a heading or a second bullet stays the text of this entry.
  const comment = serializeMemoryMeta(meta);
  return `- ${cleanMemoryText(text).text}${comment ? ` ${comment}` : ""}`;
}

const HEADER: Record<MemoryPlace, string> = {
  active: "# Active memory",
  long: "# Memory",
};

/** The line break a file uses; a new file gets `\n`. */
const breakOf = (text: string | null) => (text !== null && /\r\n/.test(text) ? "\r\n" : "\n");

export type MemoryChange = { ok: true; text: string } | { ok: false; problem: "empty" | "too-long" | "lines" | "gone" | "duplicate" };

/**
 * The file with one more entry: behind the last entry of the file, or — a
 * file without entries — at its end; a file that is not there begins with a
 * heading. Nothing else in it changes. An entry whose text is there already
 * is not written twice.
 */
export function addMemoryEntry(file: string | null, place: MemoryPlace, text: string, meta: Partial<MemoryMeta>): MemoryChange {
  const problem = memoryTextProblem(text);
  if (problem) return { ok: false, problem };
  const line = entryLine(text, meta);
  const eol = breakOf(file);
  if (file === null || file.trim() === "") return { ok: true, text: `${HEADER[place]}${eol}${eol}${line}${eol}` };
  const parsed = parseMemory(file, place);
  const cleaned = cleanMemoryText(text).text;
  if (parsed.entries.some((entry) => entry.text === cleaned)) return { ok: false, problem: "duplicate" };
  const lines = file.split(/\r?\n/);
  const last = parsed.entries[parsed.entries.length - 1];
  if (last) {
    lines.splice(last.line + last.lines, 0, line);
    return { ok: true, text: lines.join(eol) };
  }
  // No entry yet: at the end, one blank line behind what stands there.
  while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
  return { ok: true, text: `${lines.join(eol)}${eol}${eol}${line}${eol}` };
}

function located(file: string, place: MemoryPlace, id: string): { entry: MemoryEntry; lines: string[] } | null {
  const entry = parseMemory(file, place).entries.find((candidate) => candidate.id === id);
  return entry ? { entry, lines: file.split(/\r?\n/) } : null;
}

/** The file without one entry; every other line stays as it is. */
export function removeMemoryEntry(file: string, place: MemoryPlace, id: string): MemoryChange {
  const found = located(file, place, id);
  if (!found) return { ok: false, problem: "gone" };
  found.lines.splice(found.entry.line, found.entry.lines);
  return { ok: true, text: found.lines.join(breakOf(file)) };
}

/**
 * The file with one entry's text replaced. What the app knows about the entry
 * stays — its day, who added it, the rules it carries: a text that was
 * reworded rests on what it rested on. `meta` overrides single fields.
 */
export function replaceMemoryEntry(file: string, place: MemoryPlace, id: string, text: string, meta: Partial<MemoryMeta> = {}): MemoryChange {
  const problem = memoryTextProblem(text);
  if (problem) return { ok: false, problem };
  const found = located(file, place, id);
  if (!found) return { ok: false, problem: "gone" };
  const { entry, lines } = found;
  const cleaned = cleanMemoryText(text).text;
  if (parseMemory(file, place).entries.some((other) => other.id !== id && other.text === cleaned)) return { ok: false, problem: "duplicate" };
  // An entry whose comment could not be read keeps every rule: rewording it must not set it free.
  const kept: Partial<MemoryMeta> = { added: entry.added, by: entry.by, source: entry.source, deny: entry.deny, ...meta };
  lines.splice(entry.line, entry.lines, entryLine(text, kept));
  return { ok: true, text: lines.join(breakOf(file)) };
}

/** The file an entry's id names; null for an id that is none. */
export function memoryPlaceOfId(id: string): MemoryPlace | null {
  const place = id.slice(0, Math.max(0, id.indexOf(":")));
  return place === "active" || place === "long" ? place : null;
}

/** What an entry carries into another file when it is moved: all the app knows about it. */
export function memoryMetaOf(entry: MemoryEntry): MemoryMeta {
  return { added: entry.added, by: entry.by, source: entry.source, deny: [...entry.deny] };
}
