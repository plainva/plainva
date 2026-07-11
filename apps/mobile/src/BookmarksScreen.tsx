import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, ChevronLeft, X } from "lucide-react";
import { EmptyState } from "@plainva/ui";
import { vaultOps, type MobileVault } from "./services/vaultService";

/** Bookmarks (P3): device-local list (.plainva/bookmarks.json). */
export function BookmarksScreen({
  vault,
  onBack,
  onOpenNote,
}: {
  vault: MobileVault;
  /** Absent when rendered as a tab root — the app shell owns the top bar. */
  onBack?: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [marks, setMarks] = useState<string[]>([]);

  const reload = () => void vaultOps.getBookmarks(vault).then(setMarks);
  useEffect(reload, [vault]);

  return (
    <div className="m-page">
      {onBack && (
        <header className="m-header">
          <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={22} />
          </button>
          <h1>{t("mobile.bookmarks")}</h1>
        </header>
      )}
      {marks.length === 0 ? (
        <EmptyState icon={<Bookmark size={20} />}>{t("mobile.noBookmarks")}</EmptyState>
      ) : (
        marks.map((path) => (
          <div className="m-row m-row--split" key={path}>
            <button className="m-row-main" onClick={() => onOpenNote(path)}>
              <Bookmark className="m-accent" size={16} />
              <span>{path.split("/").pop()!.replace(/\.md$/i, "")}</span>
            </button>
            <button
              aria-label={t("mobile.bookmarkRemove")}
              className="m-iconbtn"
              onClick={() => void vaultOps.toggleBookmark(vault, path).then(reload)}
            >
              <X className="m-chevron" size={16} />
            </button>
          </div>
        ))
      )}
    </div>
  );
}
