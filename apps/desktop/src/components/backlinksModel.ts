/**
 * Grouping model of the backlinks panel: the query returns one row per link
 * occurrence, the panel shows one row per linking FILE with an occurrence
 * count (maintainer request 2026-07-04 — repeated links no longer duplicate).
 */

export interface BacklinkOccurrence {
  source_path: string;
}

export interface GroupedBacklink {
  source_path: string;
  /** How many links in that file point at the active note. */
  count: number;
}

/** Collapses occurrences by source file, keeping the first-seen order. */
export function groupBacklinks(links: BacklinkOccurrence[]): GroupedBacklink[] {
  const counts = new Map<string, number>();
  for (const link of links) {
    counts.set(link.source_path, (counts.get(link.source_path) ?? 0) + 1);
  }
  return [...counts.entries()].map(([source_path, count]) => ({ source_path, count }));
}
