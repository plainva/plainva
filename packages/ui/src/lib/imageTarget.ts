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
  const [head, ...rest] = inner.split("|");
  const target = head.split("#")[0].trim();
  const suffix = rest.join("|").trim();
  if (!suffix) return { target, width: null, alt: null };
  const width = /^\d{1,5}$/.test(suffix) ? Number(suffix) : /^(\d{1,5})x\d{1,5}$/.exec(suffix)?.[1];
  if (width) return { target, width: Number(width), alt: null };
  return { target, width: null, alt: suffix };
}

/** True when the target names a picture the preview can show. */
export function isImageTarget(target: string): boolean {
  return IMAGE_EXT_RE.test(target.trim());
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
  const attachments = (lookup.attachmentFolder ?? "").trim().replace(/^[/\\]+|[/\\]+$/g, "");
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
}

/**
 * Every image embed in `text`, wiki and markdown form, without one match
 * swallowing its neighbour: the old pattern's `.*?` crossed `]`, so an embed
 * followed by a link on the same line became one match whose target was the
 * link. Neither form may contain a `]` (markdown alt) or `]]` (wiki) inside.
 */
const EMBED_RE = /!\[\[([^\]]*?)\]\]|!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

export function findImageEmbeds(text: string): ImageEmbedMatch[] {
  const out: ImageEmbedMatch[] = [];
  EMBED_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMBED_RE.exec(text)) !== null) {
    if (m[1] !== undefined) {
      const parsed = parseWikiImageTarget(m[1]);
      if (!isImageTarget(parsed.target)) continue; // a note embed — not ours
      out.push({ start: m.index, end: m.index + m[0].length, syntax: "wiki", ...parsed });
    } else if (m[2]) {
      out.push({ start: m.index, end: m.index + m[0].length, syntax: "markdown", target: m[2], width: null, alt: null });
    }
  }
  return out;
}
