import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, FilePlus, Search } from "lucide-react";
import {
  Button, Chip, DocIcon, EmptyState, filterCommands, fuzzyFilter, ICON, loadRecentSearches, renderSnippetNodes,
  rememberSearch, SearchField,
  setPendingSearchJump, useDebouncedValue, type AppCommand, ScrollEdge} from "@plainva/ui";
import type { SearchResult } from "@plainva/core";
import { FileText } from "lucide-react";
import { reloadActiveMobileVault, vaultOps, type MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";
import { appendOperator, OPERATOR_CHIPS, parseQuery } from "../lib/searchMode";

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
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 150);
  const [results, setResults] = useState<SearchResult[]>([]);
  const [corpus, setCorpus] = useState<{ path: string; title: string }[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
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
  }, [vault]);
  useEffect(() => {
    if (!vault.searchAvailable || parsed.mode !== "find") {
      setResults([]);
      return;
    }
    let stale = false;
    void vaultOps.search(vault, parsed.term).then((rows) => {
      if (!stale) setResults(rows);
    });
    return () => {
      stale = true;
    };
  }, [vault, parsed.mode, parsed.term]);

  // Grouping (P4, desktop parity): a SNIPPET_MARK sentinel in the highlighted
  // title means the file NAME matched; everything else is a content hit.
  // The sentinel is char(1) — constructed, never typed literally.
  const mark = String.fromCharCode(1);
  const nameHits = results.filter((r) => r.titleHighlighted?.includes(mark));
  const nameSet = new Set(nameHits.map((r) => r.path));
  const contentHits = results.filter((r) => !nameSet.has(r.path));

  const openResult = (r: SearchResult) => {
    // Park the jump BEFORE opening: the editor may not be mounted yet.
    const term = jumpTermOf(parsed.term);
    if (term) setPendingSearchJump({ path: r.path, term });
    void rememberSearch(vault.vaultId, parsed.term);
    onOpenNote(r.path);
  };

  const openPath = (path: string) => {
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
    <button className="m-row m-result" key={r.path} onClick={() => openResult(r)}>
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
    <div className="m-page">
      {/* The search field IS this surface's title — the one place where the
          title slot carries a control instead of a heading. */}
      <AppBar
        onBack={onBack}
        title={t("mobile.tabSearch")}
        titleAs={
          <SearchField
            clearLabel={t("sidebar.clearSearch")}
            onEscapeWhenEmpty={onBack}
            onValueChange={setQuery}
            placeholder={t("search.hint")}
            ref={inputRef}
            value={query}
          />
        }
      />
      {parsed.mode === "idle" ? (
        <>
          {recent.length > 0 && (
            <>
              <p className="m-sectionlabel">{t("search.recent")}</p>
              {recent.map((q) => (
                <button className="m-row" key={q} onClick={() => setQuery(q)}>
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
                  setQuery(appendOperator(query, op.insert));
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
                <Button data-testid="search-instead" onClick={() => setQuery(parsed.term)} variant="tonal">
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
          {contentHits.filter((r) => !nameMatchSet.has(r.path)).map(resultRow)}
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
