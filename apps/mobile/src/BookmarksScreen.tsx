import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Bookmark, ChevronRight, Database, Folder, GripVertical } from "lucide-react";
import { createDragAutoScroll, EmptyState, GroupCard, ICON, IconButton, Row, RowList, bookmarkKey, moveBookmark, noteDisplayName, pickRowActions, useBookmarkTargets, usePointerReorder, toast, type BookmarkEntry, type DragAutoScroll } from "@plainva/ui";
import { usePullToRefresh } from "./lib/usePullToRefresh";
import { haptics } from "./services/haptics";
import { vaultOps, type MobileVault } from "./services/vaultService";
import { AppBar } from "./components/AppBar";
import { SwipeRow } from "./components/SwipeRow";
import { fileRowKind, useFileRowSheet } from "./lib/useFileRowSheet";
import { vaultFileIcon } from "./lib/vaultFileIcon";

/**
 * Bookmarks (P3): device-local list (.plainva/bookmarks.json).
 *
 * The home screen shows the bookmarks as a band; its heading opens this list —
 * all of them, in the user's own order (plan Rückmeldungen 2026-10-24, E8) —
 * and this is also where they are ARRANGED (plan Befunde 2026-10-06, W6).
 *
 * Since E8 a row here is the file list's row: a tap opens, a hold opens the
 * same sheet, a swipe offers the same actions (`useFileRowSheet`), so a note
 * does not become a different thing because it is read from this list. The
 * grip at the row's end stays the one way to move it.
 */
export function BookmarksScreen({
  vault,
  bump = 0,
  onBack,
  onOpenNote, onOpenFolder, onOpenBase,
}: {
  vault: MobileVault;
  bump?: number;
  /** Absent when rendered as a tab root — the app shell owns the top bar. */
  onBack?: () => void;
  onOpenNote: (path: string) => void;
  onOpenFolder: (path: string) => void;
  onOpenBase?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const [marks, setMarks] = useState<BookmarkEntry[]>([]);
  const [docIcons, setDocIcons] = useState<Map<string, { icon: string; color?: string }>>(new Map());
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

  const targets = useBookmarkTargets(vault.adapter, marks, bump);
  useEffect(() => {
    let alive = true;
    const read = () => void vaultOps.getBookmarks(vault).then((m) => { if (alive) setMarks(m); }).catch(() => { if (alive) toast.error(t("sidebar.bookmarkSaveFailed")); });
    read(); window.addEventListener("m-bookmarks-changed", read);
    void vault.queryService?.getDocumentIcons().then((m) => { if (alive) setDocIcons(m); }).catch(() => {});
    return () => { alive = false; window.removeEventListener("m-bookmarks-changed", read); };
  }, [vault, bump, t]);

  const openBase = onOpenBase ?? onOpenNote;
  const { press, folderPress, basePress, setSheet, rowActionsFor, asSheet, swipeFor, sheetLayer } = useFileRowSheet({
    vault,
    bump,
    onOpenNote,
    onOpenFolder,
    onOpenBase: openBase,
  });

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
        <GroupCard>
        <RowList>
        {marks.map((entry, index) => {
          const { path, type } = entry;
          const missing = targets.get(bookmarkKey(entry)) === false;
          const key = bookmarkKey(entry);
          const kind = fileRowKind(path, type === "folder");
          const title = type === "folder" ? path.split("/").pop()! : noteDisplayName(path);
          const target = { path, title };
          const hold = kind === "folder" ? folderPress : kind === "base" ? basePress : press;
          const state =
            (reorder.dragKey === key ? " is-dragging" : "") +
            (reorder.dropIndex === index && dragIndex !== index ? " is-drop-before" : "") +
            (reorder.dropIndex === marks.length && index === marks.length - 1 ? " is-drop-after" : "");
          const grip = marks.length > 1 ? reorder.bind(key) : null;
          return (
            // A target that is gone can only leave the list: its one swipe
            // action is the sheet's "Remove bookmark", and it has no sheet.
            <SwipeRow key={key} actions={missing ? asSheet(pickRowActions(rowActionsFor(target, kind), ["bookmark"])) : swipeFor(target, kind)}>
              <Row
                className={`m-markrow${state}`}
                controls
                data-bookmark-key={key}
                data-bookmark-row
                disabled={missing}
                end={
                  grip ? (
                    <IconButton
                      label={t("block.move")}
                      className="m-grip"
                      data-testid="bookmark-grip"
                      {...grip}
                      // The grip owns its drag: the swipe and the hold of the row
                      // around it must not start under the same finger.
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        grip.onPointerDown(e);
                      }}
                    >
                      <GripVertical size={ICON.head} />
                    </IconButton>
                  ) : kind === "folder" ? (
                    <ChevronRight className="m-chevron" size={ICON.ui} />
                  ) : undefined
                }
                icon={
                  kind === "folder" ? <Folder className="m-accent" size={ICON.ui} />
                    : kind === "base" && !docIcons.has(path) ? <Database className="m-accent" size={ICON.ui} />
                    : vaultFileIcon(path, docIcons)
                }
                onClick={() => {
                  if (!hold.clicked() || missing) return;
                  if (kind === "folder") onOpenFolder(path);
                  else if (kind === "base") openBase(path);
                  else onOpenNote(path);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!missing) setSheet({ ...target, isFolder: kind === "folder", isBase: kind === "base" });
                }}
                onPointerCancel={hold.clear}
                onPointerDown={() => { if (!missing) hold.start(target); }}
                onPointerLeave={hold.clear}
                onPointerUp={hold.clear}
                subtitle={path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : undefined}
                title={title + (missing ? ` (${t("sidebar.bookmarkMissing")})` : "")}
              />
            </SwipeRow>
          );
        })}
        </RowList>
        </GroupCard>
        </div>
      )}
      {sheetLayer}
    </div>
  );
}
