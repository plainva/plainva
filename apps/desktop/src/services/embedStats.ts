/**
 * Status-bar embed statistics (#1).
 *
 * A markdown page can embed other files with Obsidian transclusion syntax
 * `![[target]]`. When it embeds one or more `.base` databases, the status bar
 * shows the page's own word/char/block counts PLUS the aggregated entry count of
 * those bases — instead of the embedded base clobbering the page's stats.
 *
 * This module only does the (pure, testable) counting; the live row counts come
 * from the `activeDocument` base registry, which every rendered BaseViewer feeds.
 */

const IMAGE_RE = /\.(png|jpe?g|gif|svg|webp|bmp|ico)$/i;
const EMBED_RE = /!\[\[([^\]]+)\]\]/g;

export interface EmbedInfo {
  /** Distinct `.base` files embedded in the page. */
  bases: number;
  /** Summed row count of those bases (0 for any whose count isn't known yet). */
  baseEntries: number;
  /** Number of embedded notes (non-base, non-image transclusions). */
  notes: number;
}

/** Trailing path segment, lower-cased, for filename matching across folders. */
function basename(p: string): string {
  const parts = p.toLowerCase().split(/[/\\]/);
  return parts[parts.length - 1] || p.toLowerCase();
}

/**
 * Parse `![[...]]` embeds out of markdown and aggregate base/note info.
 * `counts` maps a base's vault path to its current row count (from the
 * activeDocument registry). Bases are matched to it by filename, deduped so a
 * base embedded twice counts once.
 */
export function computeEmbedInfo(content: string, counts: ReadonlyMap<string, number>): EmbedInfo {
  const baseNames = new Set<string>();
  let notes = 0;

  EMBED_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = EMBED_RE.exec(content)) !== null) {
    // Strip an optional #section and |alias, keep the file reference.
    const ref = m[1].split("#")[0].split("|")[0].trim();
    if (!ref) continue;
    if (IMAGE_RE.test(ref)) continue;
    if (ref.toLowerCase().endsWith(".base")) baseNames.add(basename(ref));
    else notes++;
  }

  let baseEntries = 0;
  if (baseNames.size > 0 && counts.size > 0) {
    const byName = new Map<string, number>();
    for (const [path, n] of counts) byName.set(basename(path), n);
    for (const name of baseNames) baseEntries += byName.get(name) ?? 0;
  }

  return { bases: baseNames.size, baseEntries, notes };
}
