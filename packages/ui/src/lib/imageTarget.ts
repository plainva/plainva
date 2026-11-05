import { decodeMarkdownLinkTarget, delimitedText, markdownLinks, wikiLinkParts } from "@plainva/core";
import { trimChars } from "@plainva/core";
/**
 * Where an image embed points (TestFlight feedback Build 91, P3).
 *
 * Obsidian writes the SHORTEST link it can — `![[foto.png]]` — and keeps the
 * file in its attachments folder; it finds the picture by basename across the
 * vault. Plainva writes the full vault path and resolved exactly that: one
 * candidate, the vault root. A tester's photos therefore rendered as
 * underlined text, and the same rule sat in five places with five different
 * reaches (the pinboard card looked beside the note, the editor did not).
 *
 * One rule now: literal path, beside the note, Plainva's attachment folder,
 * and — last, because it needs the index — the basename anywhere in the
 * vault. Every candidate passes the vault guard; the embed's `|300` width and
 * `|alt` are parsed here rather than breaking the match.
 */
import { resolveVaultRelative } from "../adapters/pathGuard";

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;

/**
 * Sound an embed can play (plan Journal-Erweiterungen, X3).
 *
 * `![[memo.m4a]]` is the same syntax with a different kind of target, so it is
 * found by the same scanner rather than by a second one that would drift from
 * this one. `.webm` is here and not among the pictures: a recording made in
 * the WebView lands in a WebM container, and the recorder writes no video.
 */
const AUDIO_EXT_RE = /\.(m4a|mp3|wav|ogg|oga|opus|webm|flac|aac)$/i;

/** What an embed points at, or `null` when Plainva shows it as a link. */
export type EmbedKind = "image" | "audio";

export interface WikiImageEmbed {
  /** The file the embed names (no `|…` suffix, no `#…` anchor). */
  target: string;
  /** Obsidian's `|300` — a display width in CSS pixels. */
  width: number | null;
  /** Obsidian's `|alt text` — or null when the suffix was a width or absent. */
  alt: string | null;
}

/** Splits the inside of `![[…]]` into target, width and alt. */
export function parseWikiImageTarget(inner: string): WikiImageEmbed {
  // The core's reading of the bar (Sammelplan § 3.133 Nr. 1): `foto.png\|300` in a table cell is `foto.png|300`.
  const parts = wikiLinkParts(inner);
  const target = inner.slice(0, parts.headEnd).split("#")[0].trim();
  const suffix = (parts.alias ?? "").trim();
  if (!suffix) return { target, width: null, alt: null };
  const width = /^\d{1,5}$/.test(suffix) ? Number(suffix) : /^(\d{1,5})x\d{1,5}$/.exec(suffix)?.[1];
  if (width) return { target, width: Number(width), alt: null };
  return { target, width: null, alt: suffix };
}

/** True when the target names a picture the preview can show. */
export function isImageTarget(target: string): boolean {
  return IMAGE_EXT_RE.test(target.trim());
}

/** True when the target names sound the preview can play. */
export function isAudioTarget(target: string): boolean {
  return AUDIO_EXT_RE.test(target.trim());
}

/** Which of the two an embed target is, or `null` for everything else. */
export function embedKindOf(target: string): EmbedKind | null {
  const t = target.trim();
  return IMAGE_EXT_RE.test(t) ? "image" : AUDIO_EXT_RE.test(t) ? "audio" : null;
}

/**
 * What an embed shows once its target is a vault file (plan Rückmeldungen
 * 05.11., P4): a picture, a sound, a note (Markdown, a database, a canvas,
 * which expand as before), or any other file, which gets a card with its
 * name, size and "Open".
 *
 * `![[Mietvertrag.pdf]]` used to fall through to the note path, was read as
 * text and said "could not be read" about a file that was there. The answer
 * is asked of the RESOLVED path, not of the text: `![[v1.2]]` is the note
 * `v1.2.md`, which only the link rule knows.
 */
export type EmbedTargetKind = EmbedKind | "note" | "file";

const NOTE_EMBED_EXT_RE = /\.(md|base|canvas)$/i;

/** The kind of a resolved vault path (see `EmbedTargetKind`). */
export function embedTargetKindOf(path: string): EmbedTargetKind {
  const name = path.trim().split(/[/\\]/).pop() ?? "";
  const media = embedKindOf(name);
  if (media) return media;
  return NOTE_EMBED_EXT_RE.test(name) ? "note" : "file";
}

export interface ImageLookup {
  /** Vault-relative path of the note the embed is in. */
  notePath: string;
  /** Plainva's configured attachment folder for that note (vault-relative), or null/empty. */
  attachmentFolder?: string | null;
}

/**
 * The vault-relative candidates for `target`, in the order they are tried.
 * Pure and synchronous; the index lookup is the caller's last resort.
 */
const ABSOLUTE_RE = /^[/\\]|^[a-zA-Z]:[/\\]|^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

export function imageCandidates(target: string, lookup: ImageLookup): string[] {
  const t = target.trim().normalize("NFC");
  // An absolute target is refused as a whole: prefixing it with the note's
  // folder would only launder `C:/x.png` into a vault path that never was one.
  if (!t || ABSOLUTE_RE.test(t)) return [];
  const noteDir = lookup.notePath.includes("/") ? lookup.notePath.slice(0, lookup.notePath.lastIndexOf("/")) : "";
  const basename = t.split(/[/\\]/).pop() ?? t;
  const attachments = trimChars((lookup.attachmentFolder ?? "").trim(), "/\\");
  const raw = [
    t,
    noteDir ? `${noteDir}/${t}` : null,
    attachments ? `${attachments}/${basename}` : null,
  ];
  const out: string[] = [];
  for (const r of raw) {
    const rel = r ? resolveVaultRelative(r) : null;
    if (rel && !out.includes(rel)) out.push(rel);
  }
  return out;
}

/** The basename an index lookup should search for, or null when the target is unsafe. */
export function imageBasename(target: string): string | null {
  const rel = resolveVaultRelative(target.trim().normalize("NFC"));
  return rel ? (rel.split("/").pop() ?? null) : null;
}

export interface ImageEmbedMatch {
  /** Offset of `!` within the scanned text. */
  start: number;
  /** Offset just past the closing bracket/paren. */
  end: number;
  target: string;
  width: number | null;
  alt: string | null;
  /** `wiki` for `![[…]]`, `markdown` for `![alt](url "title")`. */
  syntax: "wiki" | "markdown";
  /** Picture or sound. A markdown embed of an unknown kind counts as a picture — that is what it meant before X3. */
  kind: EmbedKind;
}

/** An address with a scheme (`https:`, `data:`) or a protocol-relative one: not a vault path. */
const ADDRESS_RE = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:|\/\/)/;

/**
 * The file a markdown embed's destination names (Sammelplan § 3.42), read the
 * way the reading view's parser reads it: `<…>` around a destination with
 * blanks, a `"title"` behind it dropped, and the percent-encoding Obsidian and
 * Plainva write (`Zoom%20one.svg`) decoded with the core's one decoder — the
 * editor, the cards and the journal looked for a file named `Zoom%20one.svg`.
 * An address on the web stays as written: decoding would change where it
 * points. `null` when the destination is no single target.
 */
function markdownEmbedTarget(destination: string): string | null {
  const text = destination.trim();
  let raw: string;
  if (text.startsWith("<")) {
    const close = text.indexOf(">");
    if (close < 0) return null;
    const title = text.slice(close + 1).trim();
    if (title && !/^"[^"]*"$/.test(title)) return null;
    raw = text.slice(1, close);
  } else {
    const match = /^([^\s]+)(?:\s+"[^"]*")?$/.exec(text);
    if (!match) return null;
    raw = match[1];
  }
  if (!raw) return null;
  return ADDRESS_RE.test(raw) ? raw : decodeMarkdownLinkTarget(raw);
}

/**
 * Every MEDIA embed in `text`, wiki and markdown form, without one match
 * swallowing its neighbour: the old pattern's `.*?` crossed `]`, so an embed
 * followed by a link on the same line became one match whose target was the
 * link. Neither form may contain a `]` (markdown alt) or `]]` (wiki) inside.
 *
 * One scanner for pictures and sound (plan Journal-Erweiterungen, X3): the
 * syntax is the same and only the target differs, so a second scanner would be
 * a second rule about where an embed may point — and this module exists
 * because that rule used to live in five places.
 */
export function findMediaEmbeds(text: string): ImageEmbedMatch[] {
  const out: ImageEmbedMatch[] = [];
  for (const part of delimitedText(text, "![[", "]]")) {
    if (part.inner.includes("]")) continue;
    const parsed = parseWikiImageTarget(part.inner);
    const kind = embedKindOf(parsed.target);
    if (kind) out.push({ start: part.index, end: part.end, syntax: "wiki", kind, ...parsed });
  }
  for (const part of markdownLinks(text)) {
    if (part.index === 0 || text[part.index - 1] !== "!") continue;
    const target = markdownEmbedTarget(part.destination);
    if (target === null) continue;
    out.push({
      start: part.index - 1, end: part.end, syntax: "markdown", target,
      width: null, alt: null, kind: isAudioTarget(target) ? "audio" : "image",
    });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Only the pictures — for callers that draw an `<img>` and nothing else. */
export function findImageEmbeds(text: string): ImageEmbedMatch[] {
  return findMediaEmbeds(text).filter((embed) => embed.kind === "image");
}
