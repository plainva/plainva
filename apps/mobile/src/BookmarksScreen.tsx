import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, ChevronLeft, X } from "lucide-react";
import { EmptyState, ICON, IconButton } from "@plainva/ui";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { vaultOps, type MobileVault } from "./services/vaultService";

/** Bookmarks (P3): device-local list (.plainva/bookmarks.json). */
export function BookmarksScreen({
  vault,
  bump = 0,
  onBack,
  onOpenNote,
}: {
  vault: MobileVault;
  bump?: number;
  /** Absent when rendered as a tab root — the app shell owns the top bar. */
  onBack?: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [marks, setMarks] = useState<string[]>([]);
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

  const reload = () => void vaultOps.getBookmarks(vault).then(setMarks);
  useEffect(reload, [vault, bump]);

  return (
    <div className="m-page" ref={ptrRef}>
      {ptrIndicator}
      {onBack && (
        <header className="m-header">
          <IconButton label={t("common.back", { defaultValue: "Zurück" })} onClick={onBack}>
            <ChevronLeft size={ICON.touch} />
          </IconButton>
          <h1>{t("mobile.bookmarks")}</h1>
        </header>
      )}
      {marks.length === 0 ? (
        <EmptyState icon={<Bookmark size={ICON.head} />}>{t("mobile.noBookmarks")}</EmptyState>
      ) : (
        marks.map((path) => (
          <div className="m-row m-row--split" key={path}>
            <button className="m-row-main" onClick={() => onOpenNote(path)}>
              <Bookmark className="m-accent" size={ICON.ui} />
              <span>{path.split("/").pop()!.replace(/\.md$/i, "")}</span>
            </button>
            <IconButton
              label={t("mobile.bookmarkRemove")}
              onClick={() => void vaultOps.toggleBookmark(vault, path).then(reload)}
            >
              <X className="m-chevron" size={ICON.ui} />
            </IconButton>
          </div>
        ))
      )}
    </div>
  );
}
