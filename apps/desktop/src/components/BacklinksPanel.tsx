import { useState, useEffect, useMemo, useRef } from "react";
import { useVault } from "../contexts/VaultContext";
import { ArrowUpDown, Link as LinkIcon, FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { backlinkContexts, contextChain, groupBacklinks, type BacklinkContext } from "./backlinksModel";
import { BACKLINK_SORT_KEYS, Button, EmptyState, backlinkTitle, errorText, ICON, listSortLabelKey, nextBacklinkSort, readStoredBacklinkSort, setPendingSearchJump, sortBacklinks, writeStoredBacklinkSort, type BacklinkSort, type BacklinkSortKey } from "@plainva/ui";
import { DropdownMenu } from "./DropdownMenu";

interface BacklinksPanelProps {
  activePath: string | null;
  onOpenPath: (path: string, newTab?: boolean) => void;
  /** When embedded in a collapsible sidebar section, drop the own header/scroll chrome. */
  embedded?: boolean;
  /** Reports the number of backlinks (for the section header badge). */
  onCountChange?: (count: number) => void;
}

interface BacklinkItem {
  source_path: string;
  target_path: string;
  link_type: string;
  line_number?: number | null;
  /** The heading or block the link points at (issue #92) — the index keeps it. */
  anchor?: string | null;
  /** The linking note's title and modification time — what the rows are named and sorted by (finding 2026-09-19). */
  source_title?: string | null;
  source_mtime?: number | null;
}

export function BacklinksPanel({ activePath, onOpenPath, embedded, onCountChange }: BacklinksPanelProps) {
  const { t } = useTranslation();
  const { queryService, vaultAdapter, fileTreeVersion } = useVault();
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Where each occurrence stands (Build-91 feedback, P7): the heading chain,
  // the parent list items and the line — read from the source once its
  // lines are known. A panel that showed only the file name made the reader
  // open every note to learn why it linked here.
  const [contexts, setContexts] = useState<Map<string, BacklinkContext[]>>(new Map());

  // One row per linking file — repeated links inside the same note collapse
  // into a single entry with an occurrence badge (maintainer request 2026-07-04).
  // …in the reader's order (finding 2026-09-19). The list had none at all: the
  // query carried no ORDER BY, so the same note could show its backlinks
  // differently from one open to the next. Title A–Z unless chosen otherwise;
  // the choice is remembered per device, like the file tree's.
  const [sort, setSort] = useState<BacklinkSort>(() => readStoredBacklinkSort());
  const [sortMenu, setSortMenu] = useState(false);
  const sortBtnRef = useRef<HTMLButtonElement>(null);
  const chooseSort = (key: BacklinkSortKey) => {
    setSort((current) => {
      const next = nextBacklinkSort(current, key);
      writeStoredBacklinkSort(next);
      return next;
    });
  };
  const grouped = useMemo(() => sortBacklinks(groupBacklinks(backlinks), sort), [backlinks, sort]);
  // Which place links to WHICH heading (issue #92): the anchor per source line.
  const anchorAt = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of backlinks) if (b.anchor && b.line_number) m.set(`${b.source_path}:${b.line_number}`, b.anchor);
    return m;
  }, [backlinks]);

  useEffect(() => { onCountChange?.(grouped.length); }, [grouped, onCountChange]);

  useEffect(() => {
    let active = true;
    if (!vaultAdapter || grouped.length === 0) {
      setContexts(new Map());
      return;
    }
    void (async () => {
      const next = new Map<string, BacklinkContext[]>();
      for (const g of grouped) {
        if (g.lines.length === 0) continue;
        try {
          next.set(g.source_path, backlinkContexts(await vaultAdapter.readTextFile(g.source_path), g.lines));
        } catch {
          /* the file row stays; only its places are missing */
        }
      }
      if (active) setContexts(next);
    })();
    return () => { active = false; };
  }, [grouped, vaultAdapter]);

  const openAt = (path: string, ctx: BacklinkContext, newTab: boolean) => {
    setPendingSearchJump({ path, line: ctx.line, term: ctx.lineText });
    onOpenPath(path, newTab);
    window.dispatchEvent(new CustomEvent("plainva-search-jump", { detail: { path } }));
  };

  useEffect(() => {
    let active = true;

    const fetchBacklinks = async () => {
      if (!queryService || !activePath) {
        if (active) setBacklinks([]);
        return;
      }

      try {
        setLoadError(null);
        const links = await queryService.getBacklinks(activePath);
        if (active) {
          setBacklinks(links);
        }
      } catch (err) {
        // S18: an error is not "no backlinks". The panel used to swallow this
        // and render the same sentence it shows for a note nothing links to —
        // two opposite facts, one wording.
        console.error("Failed to fetch backlinks", err);
        if (active) { setBacklinks([]); setLoadError(errorText(err)); }
      }
    };

    fetchBacklinks();

    return () => {
      active = false;
    };
  }, [activePath, queryService, fileTreeVersion]);

  // One row per file, and under it its places (P7): the heading chain and the
  // parent list items as a muted breadcrumb, the line itself below; a click
  // on a place lands on that line, a click on the file opens it as before.
  const sortControl = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', position: 'relative' }}>
      <Button
        ref={sortBtnRef}
        variant="ghost"
        size="sm"
        icon={<ArrowUpDown size={ICON.meta} />}
        aria-haspopup="menu"
        aria-expanded={sortMenu}
        data-tip={t('browse.sortBy')}
        data-testid="backlinks-sort"
        onClick={() => setSortMenu((open) => !open)}
      >
        {t(listSortLabelKey(sort.key))}
      </Button>
      <DropdownMenu
        open={sortMenu}
        anchorRef={sortBtnRef}
        onClose={() => setSortMenu(false)}
        align="right"
        ariaLabel={t('browse.sortBy')}
        items={BACKLINK_SORT_KEYS.map((key) => ({
          id: `backlinks-sort-${key}`,
          label: t(listSortLabelKey(key)),
          hint: sort.key === key ? t(sort.dir === 'asc' ? 'browse.sortAsc' : 'browse.sortDesc') : undefined,
          active: sort.key === key,
          onSelect: () => chooseSort(key),
        }))}
      />
    </div>
  );

  const listItems = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
      {/* One row is already in order; the control earns its place from two on. */}
      {grouped.length > 1 && sortControl}
      {grouped.map((link) => (
        <div key={link.source_path}>
          <div
            onClick={(e) => onOpenPath(link.source_path, e.ctrlKey || e.metaKey)}
            className="pv-rowhover"
            style={{ padding: '0.5rem', borderRadius: "var(--radius-sm)", cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: '0.5rem' }}
          >
            <FileText size={ICON.ui} color="var(--accent-color)" style={{ marginTop: '2px', flexShrink: 0 }} />
            <div style={{ overflow: 'hidden', flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-ui)', fontWeight: 500, color: 'var(--accent-color)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {backlinkTitle(link)}
              </div>
              <div className="pv-backlink-context" style={{ fontSize: 'var(--text-sm)', color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {link.source_path}
              </div>
            </div>
            {link.count > 1 && (
              <span
                data-tip={t("backlinks.occurrences", { count: link.count })}
                style={{ flexShrink: 0, marginTop: '2px', fontSize: 'var(--text-sm)', color: 'var(--text-faint)', border: '1px solid var(--border-color)', borderRadius: "var(--radius-pill)", padding: '0 6px', lineHeight: 1.5 }}
              >×{link.count}</span>
            )}
          </div>
          {(contexts.get(link.source_path) ?? []).map((ctx) => {
            const chain = contextChain(ctx);
            return (
              <div
                key={ctx.line}
                className="pv-rowhover pv-backlink-place"
                data-testid="backlink-place"
                onClick={(e) => openAt(link.source_path, ctx, e.ctrlKey || e.metaKey)}
                style={{ marginLeft: 'var(--space-6)', padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', minWidth: 0 }}
              >
                {chain && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{chain}</div>
                )}
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ctx.lineText}</div>
                {anchorAt.get(`${link.source_path}:${ctx.line}`) && (
                  <div data-testid="backlink-anchor" style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>→ {anchorAt.get(`${link.source_path}:${ctx.line}`)}</div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );

  // Embedded: no own header/scroll chrome (the sidebar section provides them).
  if (embedded) {
    if (!activePath) {
      return <div style={{ color: 'var(--text-faint)', fontSize: 'var(--text-ui)', fontStyle: 'italic' }}>{t("backlinks.noActiveFile")}</div>;
    }
    if (loadError) {
      return <div data-testid="backlinks-error" style={{ color: 'var(--error-text)', fontSize: 'var(--text-ui)' }}>{t("common.loadFailed", { message: loadError })}</div>;
    }
    return backlinks.length === 0
      ? <div style={{ color: 'var(--text-faint)', fontSize: 'var(--text-ui)', fontStyle: 'italic' }}>{t("backlinks.noBacklinks")}</div>
      : listItems;
  }

  if (!activePath) {
    return (
      <div style={{ padding: "1rem", color: "var(--text-faint)", fontSize: "var(--text-md)", textAlign: "center" }}>
        {t("backlinks.noActiveFile")}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-secondary)' }}>
        <LinkIcon size={ICON.ui} color="var(--text-muted)" />
        <h3 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--text-main)' }}>{t("backlinks.title")}</h3>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem' }}>
        {loadError ? (
          <div data-testid="backlinks-error" style={{ color: 'var(--error-text)', fontSize: 'var(--text-ui)', textAlign: 'center', padding: '2rem 1rem' }}>
            {t("common.loadFailed", { message: loadError })}
          </div>
        ) : backlinks.length === 0 ? (
          <EmptyState icon={<LinkIcon size={ICON.empty} />}>{t("backlinks.noBacklinks")}</EmptyState>
        ) : listItems}
      </div>
    </div>
  );
}
