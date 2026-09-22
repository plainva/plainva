import { trimChars } from "@plainva/core";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUpDown, Clock, FilePlus, Search } from "lucide-react";
import {
  useSearchPages, recallSearchSession, rememberSearchSession, Button, Chip, DocIcon, EmptyState, filterCommands, fuzzyFilter, ICON, loadRecentSearches, renderSnippetNodes,
  rememberSearch, SearchField,
  setPendingSearchJump, useDebouncedValue, type AppCommand, ScrollEdge,
  IconButton, SEARCH_SORT_KEYS, listSortLabelKey, nextSearchSort, readStoredSearchSort, writeStoredSearchSort, type SearchSort, type SearchSortKey } from "@plainva/ui";
import type { SearchResult } from "@plainva/core";
import { FileText } from "lucide-react";
import { reloadActiveMobileVault, vaultOps, type MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";
import { SortSheet } from "../components/SortSheet";
import { appendOperator, OPERATOR_CHIPS, parseQuery } from "../lib/searchMode";

/** First plain search term (no operators/exclusions) — the jump target. */
const jumpTermOf = (q: string): string => {
  for (const tok of q.trim().split(/\s+/)) {
    const low = tok.toLowerCase();
    if (!tok || tok.startsWith("-") || low.startsWith("path:") || low.startsWith("tag:")) continue;
    return trimChars(tok, '"');
  }
  return "";
};

/**
 * One field for finding and doing (S16).
 *
 * The desktop has three doors — the search sidebar, the quick switcher and the
 * command palette. A phone has room for one, so this surface is all three: an
 * empty field offers the last searches, the operators that exist but were
 * never mentioned, and the commands people reach for; a leading `>` switches
 * to commands (the palette convention, not an invention); anything else finds,
 * with the quick switcher's fuzzy name matching ABOVE the full-text hits and
 * the desktop's "create '{name}'" at the end, so a search that finds nothing
 * is still a way forward rather than a dead end.
 */
export function SearchScreen({
  vault,
  onBack,
  onOpenNote,
  commands,
}: {
  vault: MobileVault;
  onBack: () => void;
  onOpenNote: (path: string) => void;
  /** What this shell can do — the shared registry, mobile deps (S15). */
  commands: AppCommand[];
}) {
  const { t } = useTranslation();
  const restore = useRef(recallSearchSession(vault.vaultId));
  const [query, setQuery] = useState(() => recallSearchSession(vault.vaultId)?.query ?? "");
  const debounced = useDebouncedValue(query, 150);
  const [corpus, setCorpus] = useState<{ path: string; title: string }[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((value) => value + 1);
    window.addEventListener("m-vault-changed", changed);
    return () => window.removeEventListener("m-vault-changed", changed);
  }, []);
  const parsed = parseQuery(debounced);
  const [docIcons, setDocIcons] = useState<Map<string, { icon: string; color?: string }>>(new Map());
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
    void vault.queryService?.getDocumentIcons().then(setDocIcons).catch(() => {});
    // The name corpus is loaded ONCE per open (the desktop quick switcher's
    // rule): fuzzy matching over a live query would re-read the index on every
    // keystroke.
    void vault.queryService?.listNotes().then(setCorpus).catch(() => {});
    void loadRecentSearches(vault.vaultId).then(setRecent).catch(() => {});
  }, [vault, revision]);
  // The order of the hits (finding 2026-09-19): relevance unless chosen
  // otherwise, remembered per device - the same memory the desktop reads.
  const [sort, setSort] = useState<SearchSort>(() => readStoredSearchSort());
  const [sortSheet, setSortSheet] = useState(false);
  const chooseSort = (key: SearchSortKey) => {
    setSort((current) => {
      const next = nextSearchSort(current, key);
      writeStoredSearchSort(next);
      return next;
    });
    setSortSheet(false);
  };
  const searchPage = useSearchPages(vault.queryService, vault.searchAvailable && parsed.mode === "find" ? parsed.term : "", revision, 40, sort);
  const results = searchPage.hits;
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const saved = restore.current;
    if (!saved || saved.query !== query || debounced !== query || searchPage.loading || searchPage.failed) return;
    // Reload fresh pages before restoring the scroll position. Restoring on
    // mount clamps it to zero because the asynchronous rows do not exist yet.
    if (results.length < saved.visibleCount && searchPage.hasMore) { searchPage.loadMore(); return; }
    const frame = requestAnimationFrame(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = saved.scrollTop;
      restore.current = undefined;
    });
    return () => cancelAnimationFrame(frame);
  }, [query, debounced, results.length, searchPage]);
  const keepContext = () => {
    if (!restore.current) rememberSearchSession(vault.vaultId, query, scrollRef.current?.scrollTop ?? 0, results.length);
  };
  const changeQuery = (value: string) => {
    restore.current = undefined;
    setQuery(value);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    rememberSearchSession(vault.vaultId, value, 0);
  };

  // Grouping (P4, desktop parity): a SNIPPET_MARK sentinel in the highlighted
  // title means the file NAME matched; everything else is a content hit.
  // The sentinel is char(1) — constructed, never typed literally.
  const mark = String.fromCharCode(1);
  const nameHits = results.filter((r) => !r.occurrence && r.titleHighlighted?.includes(mark));
  const nameSet = new Set(nameHits.map((r) => r.path));
  const contentHits = results.filter((r) => !nameSet.has(r.path));

  const openResult = (r: SearchResult) => {
    keepContext();
    // Park the jump BEFORE opening: the editor may not be mounted yet.
    const term = jumpTermOf(parsed.term);
    if (term) setPendingSearchJump({ path: r.path, term, ...r.occurrence });
    void rememberSearch(vault.vaultId, parsed.term);
    onOpenNote(r.path);
  };

  const openPath = (path: string) => {
    keepContext();
    void rememberSearch(vault.vaultId, parsed.term);
    onOpenNote(path);
  };

  // The quick switcher's half: fuzzy over titles AND paths, name hits first.
  const nameMatches =
    parsed.mode === "find"
      ? fuzzyFilter(parsed.term, corpus, (i) => [i.title, i.path], 8).map((h) => h.item)
      : [];
  const nameMatchSet = new Set(nameMatches.map((n) => n.path));

  const commandHits =
    parsed.mode === "commands"
      ? filterCommands(commands, parsed.term, (c) => t(c.titleKey, { defaultValue: c.titleDefault }))
      : [];

  const createName = parsed.mode === "find" && !/[/\\]/.test(parsed.term) ? parsed.term : "";
  const createNote = () => {
    void vaultOps.createNoteFromWikiTarget(vault, createName).then((path) => {
      if (path) openPath(path);
    });
  };

  const resultRow = (r: SearchResult) => (
    <button className="m-row m-result" data-search-occurrence={r.occurrence?.from} key={r.path + ":" + (r.occurrence?.from ?? "file")} onClick={() => openResult(r)}>
      {docIcons.get(r.path) ? (
        <span className="m-rowicon">
          <DocIcon color={docIcons.get(r.path)!.color} icon={docIcons.get(r.path)!.icon} size={ICON.head} />
        </span>
      ) : (
        <FileText size={ICON.head} />
      )}
      <span>
        <span className="m-result-title">
          {r.titleHighlighted?.includes(mark)
            ? renderSnippetNodes(r.titleHighlighted)
            : r.path.split("/").pop()!.replace(/\.md$/i, "")}
        </span>
        {r.occurrence && <span className="m-result-snippet">{r.occurrence.headings.join(" › ")} · {t("searchResults.line", { line: r.occurrence.line })}</span>}
        {r.snippet ? (
          <span className="m-result-snippet">{renderSnippetNodes(r.snippet)}</span>
        ) : null}
      </span>
    </button>
  );

  const commandRow = (c: AppCommand) => {
    const Icon = c.icon;
    return (
      <button
        className="m-row"
        key={c.id}
        onClick={() => {
          onBack();
          c.run();
        }}
      >
        <Icon size={ICON.head} />
        <span>{t(c.titleKey, { defaultValue: c.titleDefault })}</span>
      </button>
    );
  };

  const bothGroups = nameHits.length > 0 && contentHits.length > 0;
  return (
    <div className="m-page" ref={scrollRef} onScroll={keepContext}>
      {/* The search field IS this surface's title — the one place where the
          title slot carries a control instead of a heading. */}
      <AppBar
        testId="appbar-searchpage"
        onBack={onBack}
        title={t("mobile.tabSearch")}
        titleAs={
          <SearchField
            clearLabel={t("sidebar.clearSearch")}
            onEscapeWhenEmpty={onBack}
            onValueChange={changeQuery}
            placeholder={t("search.hint")}
            ref={inputRef}
            value={query}
          />
        }
        actions={
          <IconButton label={t("browse.sortBy")} active={sort.key !== "relevance"} data-testid="search-sort" onClick={() => setSortSheet(true)}>
            <ArrowUpDown size={ICON.head} />
          </IconButton>
        }
      />
      {sortSheet && (
        <SortSheet
          testId="search-sort-sheet"
          title={t("browse.sortBy")}
          options={SEARCH_SORT_KEYS.map((key) => ({ key, label: t(listSortLabelKey(key)) }))}
          active={sort.key}
          direction={sort.key === "relevance" ? undefined : t(sort.dir === "asc" ? "browse.sortAsc" : "browse.sortDesc")}
          ascending={sort.dir === "asc"}
          onChoose={chooseSort}
          onClose={() => setSortSheet(false)}
        />
      )}
      {parsed.mode === "idle" ? (
        <>
          {recent.length > 0 && (
            <>
              <p className="m-sectionlabel">{t("search.recent")}</p>
              {recent.map((q) => (
                <button className="m-row" key={q} onClick={() => changeQuery(q)}>
                  <Clock size={ICON.head} />
                  <span>{q}</span>
                </button>
              ))}
            </>
          )}
          <p className="m-sectionlabel">{t("search.operators")}</p>
          <ScrollEdge axis="x" className="m-chiprow">
            {OPERATOR_CHIPS.map((op) => (
              <Chip
                key={op.insert}
                onClick={() => {
                  changeQuery(appendOperator(query, op.insert));
                  inputRef.current?.focus();
                }}
              >
                {t(op.labelKey)}
              </Chip>
            ))}
          </ScrollEdge>
          <p className="m-sectionlabel">{t("search.commands")}</p>
          {commands.slice(0, 5).map(commandRow)}
        </>
      ) : parsed.mode === "commands" ? (
        commandHits.length > 0 ? (
          commandHits.map(commandRow)
        ) : (
          /* The way out of a command search that found nothing is the search
             it interrupted: drop the ">" and look through the notes for the
             same words (N7). Without it the surface is a dead end whose only
             exit is deleting a character the user cannot see the point of. */
          <EmptyState
            action={
              parsed.term ? (
                <Button data-testid="search-instead" onClick={() => changeQuery(parsed.term)} variant="tonal">
                  {t("search.searchInstead")}
                </Button>
              ) : undefined
            }
            icon={<Search size={ICON.empty} />}
          >
            {t("search.noCommands")}
          </EmptyState>
        )
      ) : !vault.searchAvailable ? (
        /* NOT "coming in a later step": search is shipped, the vault's index is
           simply not there — the browser fallback has none and a cold vault has
           not finished building one (N7). */
        <EmptyState
          action={
            <Button data-testid="search-needs-index-retry" onClick={() => void reloadActiveMobileVault()} variant="tonal">
              {t("sync.retryNow")}
            </Button>
          }
          icon={<Search size={ICON.head} />}
        >
          {t("mobile.needsIndex")}
        </EmptyState>
      ) : (
        <>
          {(nameMatches.length > 0 || bothGroups) && (
            <p className="m-sectionlabel">{t("sidebar.matchesName")}</p>
          )}
          {nameMatches.map((n) => (
            <button className="m-row m-result" key={n.path} onClick={() => openPath(n.path)}>
              {docIcons.get(n.path) ? (
                <span className="m-rowicon">
                  <DocIcon color={docIcons.get(n.path)!.color} icon={docIcons.get(n.path)!.icon} size={ICON.head} />
                </span>
              ) : (
                <FileText size={ICON.head} />
              )}
              <span>
                <span className="m-result-title">{n.title}</span>
                <span className="m-result-snippet">{n.path}</span>
              </span>
            </button>
          ))}
          {/* The full-text hits, minus what the name list already showed. */}
          {nameHits.filter((r) => !nameMatchSet.has(r.path)).map(resultRow)}
          {contentHits.length > 0 && <p className="m-sectionlabel">{t("sidebar.matchesContent")}</p>}
          {contentHits.filter((r) => r.occurrence || !nameMatchSet.has(r.path)).map(resultRow)}
          {searchPage.loading && <p role="status">{t("searchResults.loading")}</p>}
          {searchPage.failed && <Button variant="ghost" onClick={searchPage.retry}>{t("searchResults.failed")}</Button>}
          {searchPage.hasMore && <Button variant="ghost" disabled={searchPage.loading} onClick={searchPage.loadMore}>{t("searchResults.more")}</Button>}
          {!searchPage.loading && !searchPage.failed && !results.length && <p role="status">{t("searchResults.empty")}</p>}
          {/* A search that finds nothing is still a way forward (desktop parity). */}
          {createName !== "" && (
            <button className="m-row" onClick={createNote}>
              <FilePlus size={ICON.head} />
              <span>{t("quickSwitcher.createNote", { name: createName })}</span>
            </button>
          )}
        </>
      )}
    </div>
  );
}
