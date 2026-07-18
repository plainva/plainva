import { useMemo } from "react";
import { buildWikiTargetSet } from "@plainva/ui";
import { useDocumentTitles } from "./useDocumentTitles";

/**
 * Lowercased title/path set of every existing vault file, for telling resolved
 * from unresolved wiki links (maintainer 2026-07-18). Built on top of
 * useDocumentTitles so it reuses that hook's shared per-index-version query.
 * null while the index is still empty/loading → nothing is flagged as
 * unresolved yet (isWikiTargetResolved treats null as "resolved").
 */
export function useWikiResolver(): Set<string> | null {
  const titles = useDocumentTitles();
  return useMemo(() => {
    if (titles.size === 0) return null;
    const files: { title: string; path: string }[] = [];
    titles.forEach((v, path) => files.push({ title: v.title, path }));
    return buildWikiTargetSet(files);
  }, [titles]);
}
