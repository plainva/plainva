import type React from "react";
import { Bookmark, FileText, Paperclip } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DocIcon, EmptyState, ICON, isRenderableDocIcon, stripNoteExtension } from "@plainva/ui";
import { useDocumentIcons } from "../hooks/useDocumentIcons";
import { useDocumentTitles } from "../hooks/useDocumentTitles";

interface Props {
  /** Bookmarked vault paths (order preserved). */
  bookmarks: string[];
  /** Debounced sidebar filter; matched against the path, like before. */
  query: string;
  activePath: string | null;
  onOpen: (path: string) => void;
  /** Right-click on a row; the shell owns the menu (plan P4). */
  onRowContextMenu?: (path: string, event: React.MouseEvent<HTMLElement>) => void;
}

/**
 * Bookmarks sidebar list. Renders each entry like a file-tree row — the
 * document icon (custom `plainva.icon`, database icon for `.base`, paperclip for
 * attachments, else the generic file icon) and the display name WITHOUT the
 * `.md`/`.base` extension. A bookmark only stores its path, so title + mode come
 * from the index (useDocumentTitles), mirroring how the tree derives its label.
 */
export function BookmarksList({ bookmarks, query, activePath, onOpen, onRowContextMenu }: Props) {
  const { t } = useTranslation();
  const docIcons = useDocumentIcons();
  const docTitles = useDocumentTitles();

  const q = query.toLowerCase();
  const filtered = bookmarks.filter((b) => b.toLowerCase().includes(q));

  if (filtered.length === 0) {
    return <EmptyState icon={<Bookmark size={ICON.empty} />}>{t("sidebar.noBookmarks", { defaultValue: "Keine Lesezeichen" })}</EmptyState>;
  }

  return (
    <>
      {filtered.map((path) => {
        const isBase = /\.base$/i.test(path);
        const meta = docTitles.get(path);
        const attachment = meta?.mode === "attachment" && !isBase;
        // Same derivation as the file tree (FileTree.tsx): frontmatter title or
        // the file name, extension stripped for notes/bases (attachments keep it).
        const basename = path.split(/[/\\]/).pop() ?? path;
        const displayName = attachment ? (meta?.title || basename) : stripNoteExtension(meta?.title || basename);
        const iconEntry = docIcons.get(path);

        const iconNode = isBase ? (
          <DocIcon icon={iconEntry?.icon ?? "lucide:database"} color={iconEntry?.color} size={ICON.ui} />
        ) : attachment ? (
          <Paperclip size={ICON.ui} style={{ opacity: 0.7 }} />
        ) : iconEntry && isRenderableDocIcon(iconEntry.icon) ? (
          <DocIcon icon={iconEntry.icon} color={iconEntry.color} size={ICON.ui} />
        ) : (
          <FileText size={ICON.ui} style={{ opacity: 0.7 }} />
        );

        return (
          <button
            key={path}
            onClick={() => onOpen(path)}
            onContextMenu={onRowContextMenu ? (e) => { e.preventDefault(); onRowContextMenu(path, e); } : undefined}
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
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{displayName}</span>
          </button>
        );
      })}
    </>
  );
}
