import React, { useState, useEffect, useRef } from "react";
import { VaultQueryService } from "@plainva/core";
import { useVault } from "../contexts/VaultContext";
import { Search, Clock, File as FileIcon, FilePlus, FileText, Files } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ICON, useFocusTrap } from "@plainva/ui";
import { fuzzyFilter } from "@plainva/ui";
import { renderSnippetNodes } from "@plainva/ui";
import { setPendingSearchJump } from "@plainva/ui";
import { buildNewNoteFromTemplate } from "../services/newNoteTemplate";
import { parkTemplateCaret } from "../services/templateInteractive";
import { toast } from "@plainva/ui";
import { virtualTabMeta } from "./graph/virtualPaths";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

interface QuickSwitcherProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenPath: (path: string, newTab?: boolean) => void;
  recentPaths?: string[];
}

interface ResultItem {
  path: string;
  title: string;
  /** Sentinel-marked FTS snippet (content group only) — rendered via searchSnippet. */
  snippetMarked?: string;
  isRecent?: boolean;
  /** Full-text hit (P3.3c): shown under a "content" header, opens at the match. */
  isContentHit?: boolean;
}

export function QuickSwitcher({ isOpen, onClose, onOpenPath, recentPaths = [] }: QuickSwitcherProps) {
  const { t } = useTranslation();
  const mod = isMac ? "⌘" : t("shortcuts.modCtrl", { defaultValue: "Strg" });
  const { queryService, vaultAdapter, vaultPath, indexer, triggerFileTreeUpdate } = useVault();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ResultItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Full title/path corpus, loaded ONCE per open (P3.3): fuzzy matching like
  // "prjplan" -> "Project Plan" has no SQL shape — the old LIKE '%q%' only
  // ever found literal substrings. Scoring 10k rows in memory is instant.
  const [corpus, setCorpus] = useState<{ path: string; title: string }[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const trapRef = useFocusTrap(isOpen);

  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !queryService) return;
    let active = true;
    queryService.db
      .query<{ path: string; title: string | null }>(`SELECT path, title FROM files`)
      .then((rows) => {
        if (active) setCorpus(rows.map((r) => ({ path: r.path, title: r.title || r.path.split(/[/\\]/).pop() || r.path })));
      })
      .catch((e) => console.error("Error loading switcher corpus", e));
    return () => { active = false; };
  }, [isOpen, queryService]);

  useEffect(() => {
    let active = true;
    const fetchResults = async () => {
      if (!queryService) return;
      if (!query.trim()) {
        try {
          // Provide in-memory recents with a fallback to DB recents
          const dbRecents = await queryService.getRecentFiles(20);
          if (active) {
            // Map recentPaths to results, fallback to dbRecents if recentPaths is empty
            const items: ResultItem[] = [];
            const seen = new Set<string>();

            // First add explicitly recently opened files
            for (const path of recentPaths) {
              if (seen.has(path)) continue;
              seen.add(path);
              const title = path.split(/[/\\]/).pop()?.replace(/\.md$/i, '') || path;
              items.push({ path, title, isRecent: true });
            }

            // Then add recently modified files
            for (const r of dbRecents) {
              if (seen.has(r.path)) continue;
              seen.add(r.path);
              items.push({ path: r.path, title: r.title, isRecent: true });
            }

            setResults(items.slice(0, 10));
            setSelectedIndex(0);
          }
        } catch (e) {
          console.error("Error fetching recent files", e);
        }
      } else {
        // In-memory fuzzy over titles AND paths (best key wins, title breaks ties).
        const hits = fuzzyFilter(query.trim(), corpus, (i) => [i.title, i.path], 20);
        const titleRows: ResultItem[] = hits.map((h) => ({ path: h.item.path, title: h.item.title }));
        // Full-text group (P3.3c): notes whose CONTENT matches, listed under
        // the title hits with safe sentinel snippets (same engine as the
        // sidebar search; the query grammar never throws on special chars).
        let contentRows: ResultItem[] = [];
        try {
          const seen = new Set(titleRows.map((r) => r.path));
          const fullText = await queryService.searchFullText(query.trim(), 12);
          contentRows = fullText
            .filter((r) => !seen.has(r.path) && !!r.snippet)
            .slice(0, 8)
            .map((r) => ({ path: r.path, title: r.title, snippetMarked: r.snippet ?? undefined, isContentHit: true }));
        } catch (e) {
          console.error("Switcher full-text lookup failed", e);
        }
        if (active) {
          setResults([...titleRows, ...contentRows]);
          setSelectedIndex(0);
        }
      }
    };

    // Simple debounce
    const timeout = setTimeout(fetchResults, 150);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [query, queryService, isOpen, recentPaths, corpus]);

  if (!isOpen) return null;

  // The Obsidian reflex "type a name, press Enter, the note exists" (P3.3):
  // shown as the last row whenever no existing file matches the query exactly.
  const trimmedQuery = query.trim();
  const createName = trimmedQuery.replace(/[\\/]/g, "-");
  const showCreateRow =
    !!trimmedQuery &&
    !!vaultAdapter &&
    !results.some((r) => r.title.toLowerCase() === trimmedQuery.toLowerCase());
  const totalRows = results.length + (showCreateRow ? 2 : 0);

  // Content hits open AT the match: park the jump like the sidebar search
  // (the editor pane may not be mounted yet) and poke mounted panes.
  const openResult = (item: ResultItem, newTab: boolean) => {
    if (item.isContentHit) {
      const term = VaultQueryService.parseSearchQuery(trimmedQuery).terms[0] ?? null;
      if (term) {
        setPendingSearchJump({ path: item.path, term });
        window.dispatchEvent(new CustomEvent("plainva-search-jump", { detail: { path: item.path } }));
      }
    }
    onOpenPath(item.path, newTab);
    onClose();
  };

  const handleCreate = async (newTab: boolean) => {
    if (!vaultAdapter || !createName) return;
    const path = `${createName}.md`;
    try {
      if (await vaultAdapter.exists(path)) {
        onOpenPath(path, newTab);
        onClose();
        return;
      }
      // Folder and type rules apply here too (plan Vorlagen-Engine P4/P4b) —
      // the switcher files into the vault root, so a root rule reaches it.
      const built = await buildNewNoteFromTemplate({
        vaultPath: vaultPath ?? "",
        adapter: vaultAdapter,
        folder: "",
        title: createName,
      });
      if (!built) return; // template questions cancelled — nothing is created
      await vaultAdapter.writeTextFile(path, built.content);
      parkTemplateCaret(path, built.caret);
      if (indexer) await indexer.indexPath(path);
      triggerFileTreeUpdate([path]);
      onOpenPath(path, newTab);
      onClose();
    } catch (e) {
      console.error("Failed to create note from switcher", e);
      toast.error(t("quickSwitcher.createFailed", { error: e instanceof Error ? e.message : String(e) }));
    }
  };

  /**
   * "… from template": the picker and the naming step both live in the file
   * tree, so this hands the typed name over instead of stacking a second modal
   * on this one. The name survives; the target folder becomes the tree
   * selection, which is the better answer to "where should it go" anyway.
   */
  const handleCreateFromTemplate = () => {
    window.dispatchEvent(
      new CustomEvent("plainva-new-item", { detail: { kind: "file", fromTemplate: true, name: createName } }),
    );
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex(prev => Math.min(prev + 1, totalRows - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex(prev => Math.max(prev - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < results.length) {
        openResult(results[selectedIndex], e.ctrlKey || e.metaKey);
      } else if (showCreateRow && selectedIndex === results.length) {
        void handleCreate(e.ctrlKey || e.metaKey);
      } else if (showCreateRow && selectedIndex === results.length + 1) {
        handleCreateFromTemplate();
      }
    }
  };

  return (
    <div
      ref={trapRef}
      className="pv-palette-overlay quick-switcher-overlay"
      onClick={onClose}
    >
      <div
        className="pv-palette quick-switcher-modal"
        onClick={e => e.stopPropagation()}
      >
        <div className="pv-palette-inputrow">
          <Search size={ICON.head} style={{ flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            className="pv-palette-input"
            placeholder={t("quickSwitcher.placeholder")}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {totalRows === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
              {query ? t("quickSwitcher.noFilesFound") : t("quickSwitcher.noRecentFiles")}
            </div>
          ) : (
            <div style={{ padding: '8px 0' }}>
              {!query && <div style={{ padding: '4px 16px', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{t("quickSwitcher.recentFiles")}</div>}
              {results.map((item, idx) => {
                // Virtual views (vault map, tasks) can appear among the
                // recents: show their localized name + dedicated icon instead
                // of the raw pseudo-path basename.
                const virtual = virtualTabMeta(item.path);
                const VirtualIcon = virtual?.icon;
                // Group headers (P3.3c), mirroring the sidebar search: "file
                // name" before the fuzzy hits, "content" before the FTS hits —
                // only when both groups exist.
                const bothGroups = !!query && results.some((r) => r.isContentHit) && results.some((r) => !r.isContentHit);
                const header = bothGroups && (
                  (idx === 0 && !item.isContentHit && t("sidebar.matchesName")) ||
                  (item.isContentHit && !results[idx - 1]?.isContentHit && t("sidebar.matchesContent")) ||
                  null
                );
                return (
                <React.Fragment key={item.path}>
                {header && <div style={{ padding: '4px 16px', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>{header}</div>}
                <div
                  style={{
                    padding: '8px 16px',
                    backgroundColor: idx === selectedIndex ? 'var(--bg-hover)' : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '2px'
                  }}
                  onClick={(e) => openResult(item, e.ctrlKey || e.metaKey)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-main)' }}>
                    {VirtualIcon ? <VirtualIcon size={ICON.ui} color="var(--text-muted)" /> : item.isRecent ? <Clock size={ICON.ui} color="var(--text-muted)" /> : item.isContentHit ? <FileText size={ICON.ui} color="var(--text-muted)" /> : <FileIcon size={ICON.ui} color="var(--text-muted)" />}
                    <span style={{ fontWeight: 500 }}>{virtual ? t(virtual.labelKey, { defaultValue: virtual.defaultLabel }) : (item.title || item.path.split('/').pop())}</span>
                    <span style={{ fontSize: 'var(--text-ui)', color: 'var(--text-muted)', marginLeft: 'auto' }}>
                      {item.path}
                    </span>
                  </div>
                  {item.snippetMarked && (
                    // Sentinel-marked FTS snippet rendered via searchSnippet —
                    // pure text split, <mark> nodes, never raw HTML from notes.
                    <div style={{ fontSize: 'var(--text-ui)', color: 'var(--text-muted)', marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {renderSnippetNodes(item.snippetMarked)}
                    </div>
                  )}
                </div>
                </React.Fragment>
                );
              })}
              {showCreateRow && (
                <div
                  style={{
                    padding: '8px 16px',
                    backgroundColor: selectedIndex === results.length ? 'var(--bg-hover)' : 'transparent',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    color: 'var(--text-main)',
                    borderTop: results.length > 0 ? '1px solid var(--border-color)' : undefined,
                  }}
                  onClick={(e) => { void handleCreate(e.ctrlKey || e.metaKey); }}
                  onMouseEnter={() => setSelectedIndex(results.length)}
                >
                  <FilePlus size={ICON.ui} color="var(--text-muted)" />
                  <span>{t("quickSwitcher.createNote", { name: createName })}</span>
                </div>
              )}
              {showCreateRow && (
                <div
                  data-testid="switcher-create-from-template"
                  style={{
                    padding: '8px 12px',
                    cursor: 'pointer',
                    background: selectedIndex === results.length + 1 ? 'var(--accent-container)' : 'transparent',
                    color: selectedIndex === results.length + 1 ? 'var(--on-accent-container)' : 'var(--text-main)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                  }}
                  onClick={handleCreateFromTemplate}
                  onMouseEnter={() => setSelectedIndex(results.length + 1)}
                >
                  <Files size={ICON.ui} color="var(--text-muted)" />
                  <span>{t("quickSwitcher.createFromTemplate", { name: createName })}</span>
                </div>
              )}
            </div>
          )}
        </div>
        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--border-color)', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', display: 'flex', gap: '16px' }}>
          <span><kbd style={{ background: 'var(--bg-secondary)', padding: '2px 4px', borderRadius: "var(--radius-xs)" }}>↑</kbd> <kbd style={{ background: 'var(--bg-secondary)', padding: '2px 4px', borderRadius: "var(--radius-xs)" }}>↓</kbd> {t("quickSwitcher.navigate")}</span>
          <span><kbd style={{ background: 'var(--bg-secondary)', padding: '2px 4px', borderRadius: "var(--radius-xs)" }}>Enter</kbd> {t("quickSwitcher.open")}</span>
          <span><kbd style={{ background: 'var(--bg-secondary)', padding: '2px 4px', borderRadius: "var(--radius-xs)" }}>{mod} + Enter</kbd> {t("quickSwitcher.openNewTab")}</span>
          <span><kbd style={{ background: 'var(--bg-secondary)', padding: '2px 4px', borderRadius: "var(--radius-xs)" }}>Esc</kbd> {t("quickSwitcher.close")}</span>
        </div>
      </div>
    </div>
  );
}
