import type { PinboardCache } from "./pinboardCache";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SearchField } from "../components/ui/SearchField";
import { filterCardPathsByText, pinboardTextMatches } from "./pinboardModel";

interface SearchSource { searchCardContent(paths: string[], query: string, signal?: AbortSignal): Promise<string[]> }
/** Searches the complete source set; content matches never populate the preview cache. */
export function useBaseSearch(source: SearchSource | null | undefined, paths: string[], query: string, metadata: ReadonlyMap<string, readonly string[]>, cache: PinboardCache, viewKey: string, revision: string) {
  const text = query.trim();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ source: SearchSource; paths: string[]; query: string; matches: string[]; failed: boolean } | null>(null);
  const stored = cache.session(viewKey).bodySearch;
  const cached = stored?.query === text && stored?.revision === revision ? stored : null;
  useEffect(() => {
    if (!text || !source || cached) return;
    let alive = true;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void Promise.resolve().then(() => source.searchCardContent(paths, text, controller.signal)).then(
        matches => { if (alive) { cache.updateSession(viewKey, { bodySearch: { query: text, revision, matches } }); setResult({ source, paths, query: text, matches, failed: false }); } },
        () => { if (alive) setResult({ source, paths, query: text, matches: [], failed: true }); },
      );
    }, 180);
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [source, paths, text, attempt, cached, cache, viewKey, revision]);
  const current = result?.source === source && result?.paths === paths && result?.query === text ? result : null;
  const matches = useMemo(() => {
    if (!text) return null;
    const found = new Set(current?.matches ?? cached?.matches ?? []);
    for (const [path, values] of metadata) if (pinboardTextMatches(values, text)) found.add(path);
    return found;
  }, [current, cached, metadata, text]);
  return {
    filter: (sequence: string[]) => filterCardPathsByText(sequence, matches),
    matches,
    busy: !!text && !!source && !current && !cached,
    failed: !!text && (!source || !!current?.failed),
    retry: () => setAttempt(a => a + 1),
  };
}

/**
 * The search field of a database — THE app's search field, not one of its own.
 *
 * It was the pinboard's: a hand-built row with its own magnifier, its own
 * clear button and a 34-px metric in a 28-px toolbar, and it kept that shape
 * when every view inherited it (finding 2026-09-22). Now it renders
 * `SearchField`, so the height, the magnifier, the ✕ and the Escape contract
 * are the ones the sidebar and the palette already use. What stays its own is
 * the slot beside it, which carries the hit counter.
 *
 * `placeholder` names what is searched; the default says "this database".
 */
export function BaseSearchField({ value, onChange, busy, children, placeholder, autoFocus }: { value: string; onChange: (value: string) => void; busy?: boolean; children?: ReactNode; placeholder?: string; autoFocus?: boolean }) {
  const { t } = useTranslation();
  const label = placeholder ?? t("database.searchPlaceholder");
  return <div className="pv-basesearch" role="search">
    <SearchField
      value={value}
      onValueChange={onChange}
      clearLabel={t("sidebar.clearSearch")}
      aria-label={label}
      placeholder={label}
      aria-busy={busy}
      autoFocus={autoFocus}
      data-pinboard-search="true"
    />
    {children}
  </div>;
}
