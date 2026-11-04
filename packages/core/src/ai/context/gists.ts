/**
 * Gists (plan KI-Harness §9.3, P2b-3): short summaries a model on this
 * computer writes — of a section, a note, a folder, the vault — so the
 * context of a message can say more in fewer tokens. Never a cloud in the
 * background: they are written only with the profile "Local" on a server of
 * this computer, and like vectors they are derived data that never leaves
 * the device and is rebuilt whenever needed.
 *
 * A gist is only as good as what it keeps (§9.5). A section's gist must hold
 * every protected token of its section word for word — numbers, dates and
 * amounts, links, URLs, code, tags and mentions — and keep a negation a
 * negation; a gist of gists (a note, a folder, the vault) may invent none.
 * Whatever fails goes as the original. A gist is bound to the SHA-256 of the
 * exact text it stands for, so a changed section never gets an old gist.
 */
import { sha256Hex, utf8Encode } from "../../workspace/encoding.js";
import { turns } from "./cards.js";
import { atxHeading, noteBody, outlineOf, sectionAt } from "./sections.js";

export type GistLevel = "section" | "note" | "folder" | "vault";

/** Below this many characters a section goes as it is: a gist would save nothing. */
export const GIST_MIN_SOURCE = 700;
/** The longest gist of each level. */
export const GIST_MAX_CHARS: Readonly<Record<GistLevel, number>> = { section: 320, note: 400, folder: 400, vault: 600 };

/** The key of a source: its exact text's SHA-256 — a gist of anything else is never used. */
export function gistKey(text: string): string {
  return sha256Hex(utf8Encode(text)).slice(0, 32);
}

export interface GistSection {
  chain: string;
  text: string;
  key: string;
}

/**
 * The sections of a note a gist may stand for: the text before the first
 * heading and each heading's section, cut the way a context card is cut
 * (`sectionAt`), so the card of a section finds its gist by the same key. A
 * section that holds further headings is left to the note's gist: its card
 * goes verbatim, and no text is summarised twice.
 */
export function gistSections(content: string): GistSection[] {
  const body = noteBody(content);
  const out: GistSection[] = [];
  const seen = new Set<string>();
  const add = ({ chain, text }: { chain: string; text: string }) => {
    if (!text.trim() || text.split("\n").slice(1).some((line) => atxHeading(line))) return;
    const key = gistKey(text);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ chain, text, key });
  };
  add(sectionAt(body, 0));
  for (const heading of outlineOf(body)) add(sectionAt(body, heading.line));
  return out;
}

const WIKILINK = /\[\[[^[\]\n]+\]\]/g;
const URL = /https?:\/\/[^\s)\]>]+/g;
const CODE = /`[^`\n]+`/g;
const TAG_OR_MENTION = /(?:^|\s)([#@][\p{L}\p{N}_/-]+)/gu;
const NUMBER = /\p{Nd}+(?:[.,:/-]\p{Nd}+)*/gu;

/** What a section's gist must keep word for word (§9.5). */
export function protectedTokens(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(WIKILINK)) out.add(m[0]);
  // A URL that ends a sentence leaves the sentence's mark outside (trimmed in code, not by an unanchored pattern).
  for (const m of text.matchAll(URL)) {
    let url = m[0];
    while (url && ".,;:!?".includes(url[url.length - 1]!)) url = url.slice(0, -1);
    out.add(url);
  }
  for (const m of text.matchAll(CODE)) out.add(m[0]);
  for (const m of text.matchAll(TAG_OR_MENTION)) out.add(m[1]!);
  // Numbers inside a link, a URL or code are already kept with them.
  const plain = text.replace(WIKILINK, " ").replace(URL, " ").replace(CODE, " ");
  for (const m of plain.matchAll(NUMBER)) out.add(m[0]);
  return [...out];
}

export interface GistCheck {
  ok: boolean;
  /** Protected tokens the gist dropped (a section) or tokens it made up (a gist of gists). */
  problems: string[];
}

/**
 * Whether a gist may stand for its source. A section's gist keeps every
 * protected token, keeps a negation a negation, and is shorter than the
 * section; a gist of gists makes up no number, link or name-like token its
 * sources do not hold. Anything else goes as the original.
 */
export function checkGist(level: GistLevel, source: string, gist: string): GistCheck {
  const text = gist.trim();
  if (!text) return { ok: false, problems: ["(empty)"] };
  if (text.length > GIST_MAX_CHARS[level] * 1.5) return { ok: false, problems: ["(too long)"] };
  const problems: string[] = [];
  if (level === "section") {
    for (const token of protectedTokens(source)) if (!text.includes(token)) problems.push(token);
    if (turns(source) && !turns(text)) problems.push("(negation)");
    if (text.length >= source.trim().length) problems.push("(not shorter)");
  } else {
    const known = new Set(protectedTokens(source));
    for (const token of protectedTokens(text)) if (!known.has(token)) problems.push(token);
  }
  return { ok: problems.length === 0, problems };
}

/** What the model is asked, per level; the source follows as the user's text. */
export function gistInstruction(level: GistLevel): string {
  const keep =
    "Keep every number, date, amount, name, link ([[…]]), URL, code, tag, task with its status and every negation exactly as written. Add nothing that is not in the text. Answer with the gist alone, without a heading or a list.";
  switch (level) {
    case "section":
      return `Write a gist of the note section below for an assistant that reads it instead of the section: at most two sentences and ${GIST_MAX_CHARS.section} characters, in the language of the section. ${keep}`;
    case "note":
      return `Write a gist of a note from the gists of its sections below: at most three sentences and ${GIST_MAX_CHARS.note} characters, in the language of the note — what the note is about and what it decides. ${keep}`;
    case "folder":
      return `Write a gist of a folder of notes from the gists of its notes below: at most three sentences and ${GIST_MAX_CHARS.folder} characters, in the language of the notes — what the folder holds. ${keep}`;
    case "vault":
      return `Write a gist of a whole vault of notes from the gists of its folders below: at most four sentences and ${GIST_MAX_CHARS.vault} characters, in the language most of the folders use — what the vault holds. ${keep}`;
  }
}

/** The text a gist of gists is written from: one labelled line per part, the key of the whole bound to the parts. */
export function gistOfGists(parts: readonly { label: string; key: string; gist: string }[]): { text: string; key: string } {
  const text = parts.map((part) => `${part.label}: ${part.gist}`).join("\n");
  return { text, key: gistKey(parts.map((part) => part.key).join("\n")) };
}
