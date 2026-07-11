import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, FileText, Hash } from "lucide-react";
import { EmptyState } from "@plainva/ui";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { type MobileVault } from "./services/vaultService";

/**
 * Tags (P3): index-backed tag list with counts; tapping a tag lists its
 * notes. `tag` empty = the overview level.
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
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

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
        tags.map((row) => (
          <button className="m-row" key={row.tag} onClick={() => onOpenTag(row.tag)}>
            <Hash className="m-accent" size={16} />
            <span>{row.tag}</span>
            <span className="m-soon">{row.count}</span>
            <ChevronRight className="m-chevron" size={16} />
          </button>
        ))
      )}
    </div>
  );
}
