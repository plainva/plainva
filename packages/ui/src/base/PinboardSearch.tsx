import type { PinboardCache } from "./pinboardCache";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Search, X } from "lucide-react";
import { ICON } from "../lib/iconSizes";
import { TextInput } from "../components/ui/Field";
import { IconButton } from "../components/ui/IconButton";
import { filterCardPathsByText, pinboardTextMatches } from "./pinboardModel";

interface SearchSource { searchCardContent(paths: string[], query: string, signal?: AbortSignal): Promise<string[]> }
/** Searches the complete source set; content matches never populate the preview cache. */
export function usePinboardSearch(source: SearchSource | null | undefined, paths: string[], query: string, metadata: ReadonlyMap<string, readonly string[]>, cache: PinboardCache, viewKey: string, revision: string) {
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

/** `placeholder` names what is searched; the pinboard's is the default, every other view says "this database" (finding 2026-09-19). */
export function PinboardSearch({ value, onChange, busy, children, placeholder, autoFocus }: { value: string; onChange: (value: string) => void; busy?: boolean; children?: ReactNode; placeholder?: string; autoFocus?: boolean }) {
  const { t } = useTranslation();
  const label = placeholder ?? t("pinboard.searchPlaceholder");
  return <div className="pv-pinboard-search" role="search">
    <Search size={ICON.ui} aria-hidden="true" />
    <TextInput compact type="search" data-pinboard-search="true" value={value} onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onChange(""); } }}
      aria-label={label} placeholder={label} aria-busy={busy} autoFocus={autoFocus} />
    {!!value && <IconButton onClick={() => onChange("")} label={t("sidebar.clearSearch")}><X size={ICON.ui} /></IconButton>}
    {children}
  </div>;
}
