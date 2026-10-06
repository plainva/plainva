import { useRef } from "react";
import type React from "react";
import { Bookmark, FileText, Paperclip, Folder } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DocIcon, EmptyState, ICON, bookmarkKey, bookmarkStepTarget, cx, useBookmarkTargets, usePointerReorder, parkTreeReveal, type BookmarkEntry, isRenderableDocIcon, stripNoteExtension } from "@plainva/ui";
import { useDocumentIcons } from "../hooks/useDocumentIcons";
import { useVault } from "../contexts/VaultContext";
import { useDocumentTitles } from "../hooks/useDocumentTitles";

interface Props {
  /** Bookmarked vault paths (order preserved). */
  bookmarks: BookmarkEntry[];
  /** Debounced sidebar filter; matched against the path, like before. */
  query: string;
  activePath: string | null;
  onOpen: (path: string) => void;
  /** Right-click on a row; the shell owns the menu (plan P4). */
  onRowContextMenu?: (path: string, event: React.MouseEvent<HTMLElement>, type?: "file" | "folder") => void;
  /** One entry in front of another, or to the end (`bookmarkKey`s). Absent: the list cannot be arranged. */
  onMove?: (key: string, beforeKey: string | null) => void;
}

/** A press that travels this far is a drag; anything less stays a click. */
const DRAG_THRESHOLD_PX = 5;

/**
 * Bookmarks sidebar list. Renders each entry like a file-tree row — the
 * document icon (custom `plainva.icon`, database icon for `.base`, paperclip for
 * attachments, else the generic file icon) and the display name WITHOUT the
 * `.md`/`.base` extension. A bookmark only stores its path, so title + mode come
 * from the index (useDocumentTitles), mirroring how the tree derives its label.
 */
export function BookmarksList({ bookmarks, query, activePath, onOpen, onRowContextMenu, onMove }: Props) {
  const { t } = useTranslation();
  const { vaultAdapter, fileTreeVersion } = useVault();
  const targets = useBookmarkTargets(vaultAdapter, bookmarks, fileTreeVersion);
  const docIcons = useDocumentIcons();
  const docTitles = useDocumentTitles();

  const q = query.toLowerCase();
  const filtered = bookmarks.filter((b) => b.path.toLowerCase().includes(q));

  // Reordering (plan Befunde 2026-10-06, W6): a row is dragged to its place,
  // or moved a step with Alt+Up / Alt+Down. The order is the file's — the
  // phone shows the same one and arranges it with a grip. A filtered list
  // moves an entry in front of the row it was dropped on, wherever that row
  // stands in the whole list.
  const listRef = useRef<HTMLDivElement>(null);
  const keys = filtered.map(bookmarkKey);
  const reorder = usePointerReorder<string>({
    keys,
    rows: () => Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-bookmark-row]") ?? []),
    onMove: (key, beforeKey) => onMove?.(key, beforeKey),
    threshold: DRAG_THRESHOLD_PX,
  });
  const dragIndex = reorder.dragKey === null ? -1 : keys.indexOf(reorder.dragKey);

  if (filtered.length === 0) {
    return <EmptyState icon={<Bookmark size={ICON.empty} />}>{t("sidebar.noBookmarks", { defaultValue: "Keine Lesezeichen" })}</EmptyState>;
  }

  return (
    <div ref={listRef} data-testid="bookmarks-list">
      {filtered.map((entry, index) => {
        const { path, type } = entry;
        const missing = targets.get(bookmarkKey(entry)) === false;
        const isBase = /\.base$/i.test(path);
        const meta = docTitles.get(path);
        const attachment = meta?.mode === "attachment" && !isBase;
        // Same derivation as the file tree (FileTree.tsx): frontmatter title or
        // the file name, extension stripped for notes/bases (attachments keep it).
        const basename = path.split(/[/\\]/).pop() ?? path;
        const displayName = type === "folder" ? basename : attachment ? (meta?.title || basename) : stripNoteExtension(meta?.title || basename);
        const iconEntry = docIcons.get(path);

        const iconNode = type === "folder" ? <Folder size={ICON.ui} /> : isBase ? (
          <DocIcon icon={iconEntry?.icon ?? "lucide:database"} color={iconEntry?.color} size={ICON.ui} />
        ) : attachment ? (
          <Paperclip size={ICON.ui} style={{ opacity: 0.7 }} />
        ) : iconEntry && isRenderableDocIcon(iconEntry.icon) ? (
          <DocIcon icon={iconEntry.icon} color={iconEntry.color} size={ICON.ui} />
        ) : (
          <FileText size={ICON.ui} style={{ opacity: 0.7 }} />
        );

        const key = bookmarkKey(entry);
        const drag = onMove ? reorder.bind(key) : undefined;
        return (
          <button
            key={key}
            data-bookmark-row
            data-bookmark-key={key}
            className={cx(
              "pv-bookmark-row",
              reorder.dragKey === key && "is-dragging",
              reorder.dropIndex === index && dragIndex !== index && "is-drop-before",
              reorder.dropIndex === filtered.length && index === filtered.length - 1 && "is-drop-after",
            )}
            aria-disabled={missing}
            {...drag}
            onKeyDown={onMove ? (e) => {
              if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
              e.preventDefault();
              // A step is taken in the list as it is shown.
              const target = bookmarkStepTarget(filtered, key, e.key === "ArrowUp" ? -1 : 1);
              if (target) onMove(key, target.beforeKey);
            } : undefined}
            onClick={() => {
              // The click that ends a drag is the browser's, not the person's.
              if (reorder.wasDrag()) return;
              if (missing) return;
              if (type === "folder") { parkTreeReveal(path); window.dispatchEvent(new CustomEvent("plainva-reveal-folder", { detail: { path } })); } else onOpen(path);
            }}
            onContextMenu={onRowContextMenu ? (e) => { e.preventDefault(); onRowContextMenu(path, e, type); } : undefined}
            data-tip={path}
            style={{
              width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: "var(--pv-sec-gap, 0.55rem)",
              padding: "0.5rem", border: "none", cursor: "pointer", borderRadius: "var(--radius-xs)",
              background: activePath === path ? "var(--bg-hover)" : "transparent",
              color: "var(--text-main)",
            }}
          >
            <span aria-hidden="true" style={{ width: ICON.ui, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {iconNode}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}{missing ? ` (${t("sidebar.bookmarkMissing")})` : ""}</span>
          </button>
        );
      })}
    </div>
  );
}
