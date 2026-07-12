import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronLeft, ChevronRight, FileText, Hash } from "lucide-react";
import { EmptyState } from "@plainva/ui";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { type MobileVault } from "./services/vaultService";

/**
 * Tags (P3; hierarchical in package I): index-backed tag list with counts.
 * The overview groups by the first segment; a root row aggregates its nested
 * tags and expands them indented (desktop tag-tree parity, touch sized).
 * Tapping a tag lists its notes; `tag` empty = the overview level.
 */
export function TagsScreen({
  vault,
  tag,
  bump = 0,
  onBack,
  onOpenTag,
  onOpenNote,
}: {
  vault: MobileVault;
  tag: string;
  bump?: number;
  /** Absent when rendered as a tab root — the app shell owns the top bar. */
  onBack?: () => void;
  onOpenTag: (tag: string) => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [tags, setTags] = useState<Array<{ tag: string; count: number }>>([]);
  const [files, setFiles] = useState<Array<{ path: string; title: string }>>([]);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

  // Hierarchy (package I): group by the first segment; the root row carries
  // the aggregate count and expands its nested tags.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { total: number; hasSelf: boolean; children: Array<{ tag: string; count: number }> }
    >();
    for (const row of tags) {
      const root = row.tag.split("/")[0];
      let g = map.get(root);
      if (!g) {
        g = { total: 0, hasSelf: false, children: [] };
        map.set(root, g);
      }
      g.total += row.count;
      if (row.tag === root) g.hasSelf = true;
      else g.children.push(row);
    }
    return [...map.entries()];
  }, [tags]);

  useEffect(() => {
    let stale = false;
    if (!vault.queryService) return;
    if (tag) {
      void vault.queryService.getFilesByTag(tag).then((rows) => {
        if (!stale) setFiles(rows.map((r) => ({ path: r.path, title: r.title })));
      });
    } else {
      void vault.queryService.getAllTags().then((rows) => {
        if (!stale) setTags(rows);
      });
    }
    return () => {
      stale = true;
    };
  }, [vault, tag, bump]);

  return (
    <div className="m-page" ref={ptrRef}>
      {ptrIndicator}
      {onBack && (
        <header className="m-header">
          <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={22} />
          </button>
          <h1>{tag ? `#${tag}` : t("mobile.tags")}</h1>
        </header>
      )}
      {tag ? (
        files.map((f) => (
          <button className="m-row" key={f.path} onClick={() => onOpenNote(f.path)}>
            <FileText size={16} />
            <span>{f.title}</span>
          </button>
        ))
      ) : tags.length === 0 ? (
        <EmptyState icon={<Hash size={20} />}>{t("mobile.noTags")}</EmptyState>
      ) : (
        groups.map(([root, g]) => (
          <Fragment key={root}>
            <div className="m-row m-row--split">
              <button className="m-row-main" onClick={() => onOpenTag(root)}>
                <Hash className="m-accent" size={16} />
                <span>{root}</span>
                <span className="m-soon">{g.total}</span>
              </button>
              {g.children.length > 0 && (
                <button
                  aria-expanded={open.has(root)}
                  aria-label={root}
                  className="m-iconbtn"
                  onClick={() =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(root)) next.delete(root);
                      else next.add(root);
                      return next;
                    })
                  }
                >
                  {open.has(root) ? (
                    <ChevronDown className="m-chevron" size={16} />
                  ) : (
                    <ChevronRight className="m-chevron" size={16} />
                  )}
                </button>
              )}
            </div>
            {open.has(root) &&
              g.children.map((row) => (
                <button
                  className="m-row m-row--nested"
                  key={row.tag}
                  onClick={() => onOpenTag(row.tag)}
                >
                  <Hash className="m-chevron" size={14} />
                  <span>{row.tag.slice(root.length + 1)}</span>
                  <span className="m-soon">{row.count}</span>
                </button>
              ))}
          </Fragment>
        ))
      )}
    </div>
  );
}
