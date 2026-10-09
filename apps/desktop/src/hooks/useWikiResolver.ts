import { useMemo } from "react";
import { buildWikiTargetSet, type WikiTargetSet } from "@plainva/ui";
import { useDocumentTitles, type DocTitleEntry } from "./useDocumentTitles";

// One lookup per titles map. The map is the shared answer of one query per
// index version (useDocumentTitles), and every editor pane, reading view,
// embedded note, database view and properties panel asks for the lookup over
// it — built per hook instance, a note with ten embeds folded every path of
// the vault ten times over.
const lookups = new WeakMap<Map<string, DocTitleEntry>, WikiTargetSet>();

function lookupFor(titles: Map<string, DocTitleEntry>): WikiTargetSet {
  let lookup = lookups.get(titles);
  if (!lookup) {
    const files: { title: string; path: string }[] = [];
    titles.forEach((v, path) => files.push({ title: v.title, path }));
    lookup = buildWikiTargetSet(files);
    lookups.set(titles, lookup);
  }
  return lookup;
}

/**
 * The lookup over every indexed file — path and title — for telling resolved
 * from unresolved wiki links (maintainer 2026-07-18): the link rule's own
 * index, so a link is drawn as "not created yet" exactly where a click would
 * create the note. Built on top of useDocumentTitles so it reuses that hook's
 * shared per-index-version query. null while the index is still empty/loading
 * → nothing is flagged as unresolved yet (isWikiTargetResolved treats null as
 * "resolved").
 */
export function useWikiResolver(): WikiTargetSet | null {
  const titles = useDocumentTitles();
  return useMemo(() => (titles.size === 0 ? null : lookupFor(titles)), [titles]);
}
