import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, Search } from "lucide-react";
import {
  EmptyState,
  renderSnippetNodes,
  setPendingSearchJump,
  useDebouncedValue,
} from "@plainva/ui";
import type { SearchResult } from "@plainva/core";
import { FileText } from "lucide-react";
import { vaultOps, type MobileVault } from "../services/vaultService";

/** First plain search term (no operators/exclusions) — the jump target. */
const jumpTermOf = (q: string): string => {
  for (const tok of q.trim().split(/\s+/)) {
    const low = tok.toLowerCase();
    if (!tok || tok.startsWith("-") || low.startsWith("path:") || low.startsWith("tag:")) continue;
    return tok.replace(/^"+|"+$/g, "");
  }
  return "";
};

/**
 * Full-text search (R2.1): now a pushed screen behind the top-bar action —
 * the query field lives in the app bar (M3 search pattern) and autofocuses.
 */
export function SearchScreen({
  vault,
  onBack,
  onOpenNote,
}: {
  vault: MobileVault;
  onBack: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 150);
  const [results, setResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  useEffect(() => {
    if (!vault.searchAvailable || !debounced.trim()) {
      setResults([]);
      return;
    }
    let stale = false;
    void vaultOps.search(vault, debounced).then((rows) => {
      if (!stale) setResults(rows);
    });
    return () => {
      stale = true;
    };
  }, [vault, debounced]);

  // Grouping (P4, desktop parity): a SNIPPET_MARK sentinel in the highlighted
  // title means the file NAME matched; everything else is a content hit.
  // The sentinel is char(1) — constructed, never typed literally.
  const mark = String.fromCharCode(1);
  const nameHits = results.filter((r) => r.titleHighlighted?.includes(mark));
  const nameSet = new Set(nameHits.map((r) => r.path));
  const contentHits = results.filter((r) => !nameSet.has(r.path));

  const openResult = (r: SearchResult) => {
    // Park the jump BEFORE opening: the editor may not be mounted yet.
    const term = jumpTermOf(debounced);
    if (term) setPendingSearchJump({ path: r.path, term });
    onOpenNote(r.path);
  };

  const resultRow = (r: SearchResult) => (
    <button className="m-row m-result" key={r.path} onClick={() => openResult(r)}>
      <FileText size={18} />
      <span>
        <span className="m-result-title">
          {r.titleHighlighted?.includes(mark)
            ? renderSnippetNodes(r.titleHighlighted)
            : r.path.split("/").pop()!.replace(/\.md$/i, "")}
        </span>
        {r.snippet ? (
          <span className="m-result-snippet">{renderSnippetNodes(r.snippet)}</span>
        ) : null}
      </span>
    </button>
  );

  const bothGroups = nameHits.length > 0 && contentHits.length > 0;
  return (
    <div className="m-page">
      <header className="m-header m-header--search">
        <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
          <ChevronLeft size={22} />
        </button>
        <input
          className="m-searchfield"
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("mobile.tabSearch")}
          ref={inputRef}
          type="search"
          value={query}
        />
      </header>
      {!vault.searchAvailable ? (
        <EmptyState icon={<Search size={20} />}>{t("mobile.comingSoon")}</EmptyState>
      ) : (
        <>
          {bothGroups && <p className="m-sectionlabel">{t("sidebar.matchesName")}</p>}
          {nameHits.map(resultRow)}
          {bothGroups && <p className="m-sectionlabel">{t("sidebar.matchesContent")}</p>}
          {contentHits.map(resultRow)}
        </>
      )}
    </div>
  );
}
