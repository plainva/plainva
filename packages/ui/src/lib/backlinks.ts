/**
 * Backlinks with their place (TestFlight feedback Build 91, P7).
 *
 * The query returns one row per link occurrence; the panels show one row per
 * linking FILE with an occurrence count (maintainer request 2026-07-04 —
 * repeated links no longer duplicate). Since P7 each occurrence also carries
 * its line, and `backlinkContexts` turns those lines into what a reader needs
 * to place them: the heading chain, the parent list items, the line itself.
 * Both shells render from this; the desktop's `backlinksModel` re-exports it.
 */
import { outlineContextFor, type OutlineContext } from "./outline";

export interface BacklinkOccurrence {
  source_path: string;
  /** 1-based line of the link in the source, or null/undefined for frontmatter links and old indexes. */
  line_number?: number | null;
}

export interface GroupedBacklink {
  source_path: string;
  /** How many links in that file point at the active note. */
  count: number;
  /** The distinct lines those links stand on, ascending; empty when unknown. */
  lines: number[];
}

/** Collapses occurrences by source file, keeping the first-seen order. */
export function groupBacklinks(links: BacklinkOccurrence[]): GroupedBacklink[] {
  const groups = new Map<string, GroupedBacklink>();
  for (const link of links) {
    let g = groups.get(link.source_path);
    if (!g) {
      g = { source_path: link.source_path, count: 0, lines: [] };
      groups.set(link.source_path, g);
    }
    g.count += 1;
    const line = link.line_number;
    if (typeof line === "number" && Number.isFinite(line) && line > 0 && !g.lines.includes(line)) g.lines.push(line);
  }
  for (const g of groups.values()) g.lines.sort((a, b) => a - b);
  return [...groups.values()];
}

export interface BacklinkContext extends OutlineContext {
  line: number;
}

/** The outline context of each line, in the given order. */
export function backlinkContexts(content: string, lines: readonly number[]): BacklinkContext[] {
  return lines.map((line) => ({ line, ...outlineContextFor(content, line) }));
}

/** One line for the chain: headings, then list parents, joined the way breadcrumbs read. */
export function contextChain(ctx: OutlineContext, separator = " › "): string {
  return [...ctx.headings, ...ctx.listParents].join(separator);
}
