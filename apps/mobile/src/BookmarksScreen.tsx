import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, GripVertical, X, Folder } from "lucide-react";
import { createDragAutoScroll, EmptyState, ICON, IconButton, bookmarkKey, moveBookmark, useBookmarkTargets, usePointerReorder, toast, type BookmarkEntry, type DragAutoScroll } from "@plainva/ui";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { haptics } from "./services/haptics";
import { vaultOps, type MobileVault } from "./services/vaultService";
import { AppBar } from "./components/AppBar";

/**
 * Bookmarks (P3): device-local list (.plainva/bookmarks.json).
 *
 * Since the bookmarks became a band in the navigator, this list is where they
 * are ARRANGED: the one action at the band's heading opens it (plan Befunde
 * 2026-10-06, W6). Until then the route existed and nothing led to it.
 */
export function BookmarksScreen({
  vault,
  bump = 0,
  onBack,
  onOpenNote, onOpenFolder,
}: {
  vault: MobileVault;
  bump?: number;
  /** Absent when rendered as a tab root — the app shell owns the top bar. */
  onBack?: () => void;
  onOpenNote: (path: string) => void;
  onOpenFolder: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [marks, setMarks] = useState<BookmarkEntry[]>([]);
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

  const targets = useBookmarkTargets(vault.adapter, marks, bump);
  useEffect(() => {
    let alive = true;
    const read = () => void vaultOps.getBookmarks(vault).then((m) => { if (alive) setMarks(m); }).catch(() => { if (alive) toast.error(t("sidebar.bookmarkSaveFailed")); });
    read(); window.addEventListener("m-bookmarks-changed", read);
    return () => { alive = false; window.removeEventListener("m-bookmarks-changed", read); };
  }, [vault, bump, t]);

  // Arranging the list (plan Befunde 2026-10-06, W6): the grip at a row's end
  // drags it to its place — the gesture "Bars & areas" already uses. A tester
  // asked where the order is changed; it could not be, on either device. The
  // desktop drags the sidebar row itself. A long list scrolls under the finger
  // (pointer capture keeps the page from doing it by itself).
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef<DragAutoScroll | null>(null);
  const reorder = usePointerReorder<string>({
    keys: marks.map(bookmarkKey),
    rows: () => Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-bookmark-row]") ?? []),
    onLift: () => haptics.medium(),
    onDragMove: (clientY) => (autoScrollRef.current ??= createDragAutoScroll(() => listRef.current)).update(clientY),
    onDragEnd: () => autoScrollRef.current?.stop(),
    onMove: (key, beforeKey) => {
      haptics.light();
      // The row is where it was dropped at once; the file's answer replaces this.
      setMarks((current) => moveBookmark(current, key, beforeKey));
      void vaultOps.moveBookmark(vault, key, beforeKey).catch(() => {
        toast.error(t("sidebar.bookmarkSaveFailed"));
        window.dispatchEvent(new CustomEvent("m-bookmarks-changed"));
      });
    },
  });
  const dragIndex = reorder.dragKey === null ? -1 : marks.findIndex((entry) => bookmarkKey(entry) === reorder.dragKey);

  return (
    <div className="m-page" ref={ptrRef}>
      {onBack && (
        <AppBar onBack={onBack} title={t("mobile.bookmarks")} />
      )}
      {ptrIndicator}
      {marks.length === 0 ? (
        <EmptyState icon={<Bookmark size={ICON.head} />}>{t("mobile.noBookmarks")}</EmptyState>
      ) : (
        <div ref={listRef} data-testid="bookmarks-list">
        {marks.map((entry, index) => {
          const { path, type } = entry; const missing = targets.get(bookmarkKey(entry)) === false;
          const key = bookmarkKey(entry);
          const state =
            (reorder.dragKey === key ? " is-dragging" : "") +
            (reorder.dropIndex === index && dragIndex !== index ? " is-drop-before" : "") +
            (reorder.dropIndex === marks.length && index === marks.length - 1 ? " is-drop-after" : "");
          return (
          <div className={`m-row m-row--split${state}`} data-bookmark-row data-bookmark-key={key} key={key}>
            <button className="m-row-main" aria-disabled={missing} onClick={() => { if (!missing) (type === "folder" ? onOpenFolder : onOpenNote)(path); }}>
              {type === "folder" ? <Folder className="m-accent" size={ICON.ui} /> : <Bookmark className="m-accent" size={ICON.ui} />}
              <span>{(type === "folder" ? path.split("/").pop()! : path.split("/").pop()!.replace(/\.md$/i, "")) + (missing ? ` (${t("sidebar.bookmarkMissing")})` : "")}</span>
            </button>
            <IconButton
              label={t("mobile.bookmarkRemove")}
              onClick={() => void vaultOps.toggleBookmark(vault, path, type).catch(() => toast.error(t("sidebar.bookmarkSaveFailed")))}
            >
              <X className="m-chevron" size={ICON.ui} />
            </IconButton>
            {marks.length > 1 && (
              <IconButton label={t("block.move")} className="m-grip" data-testid="bookmark-grip" {...reorder.bind(key)}>
                <GripVertical size={ICON.head} />
              </IconButton>
            )}
          </div>
        ); })}
        </div>
      )}
    </div>
  );
}
