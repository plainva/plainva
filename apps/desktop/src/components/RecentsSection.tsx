import { FileText, Paperclip, Clock } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DocIcon, ICON, isRenderableDocIcon, stripNoteExtension } from "@plainva/ui";
import { useDocumentIcons } from "../hooks/useDocumentIcons";
import { useDocumentTitles } from "../hooks/useDocumentTitles";
import { virtualTabMeta } from "./graph/virtualPaths";

interface Props {
  /** Most-recently-opened vault paths (MRU order). */
  recentPaths: string[];
  activePath: string | null;
  onOpen: (path: string) => void;
  /** Max entries shown (default 5). */
  limit?: number;
}

/**
 * "Recently opened" strip above the file tree (mobile parity). Renders each
 * entry like a tree/bookmark row (document icon + extension-stripped title) so
 * recent notes are reachable without switching the sidebar tab — which is why
 * the tree keeps its expand state instead of resetting. Renders nothing when
 * empty, so the tree keeps the full height.
 */
export function RecentsSection({ recentPaths, activePath, onOpen, limit = 5 }: Props) {
  const { t } = useTranslation();
  const docIcons = useDocumentIcons();
  const docTitles = useDocumentTitles();
  const shown = recentPaths.slice(0, limit);
  if (shown.length === 0) return null;

  return (
    <div style={{ padding: "0.25rem 0.25rem 0.4rem", borderBottom: "1px solid var(--border-color-light)", flexShrink: 0 }}>
      <div
        style={{
          display: "flex", alignItems: "center", gap: 6, padding: "0.25rem 0.5rem",
          color: "var(--text-muted)", fontSize: "var(--text-xs)", textTransform: "uppercase", letterSpacing: "0.5px",
        }}
      >
        <Clock size={ICON.meta} />
        {t("sidebar.recent")}
      </div>
      {shown.map((path) => {
        // Virtual views (vault map, tasks) are legitimate recents entries but
        // are not vault files: show their localized name + dedicated icon
        // instead of the raw pseudo-path basename ("graph"/"tasks").
        const virtual = virtualTabMeta(path);
        const VirtualIcon = virtual?.icon;
        const isBase = /\.base$/i.test(path);
        const meta = docTitles.get(path);
        const attachment = meta?.mode === "attachment" && !isBase;
        const basename = path.split(/[/\\]/).pop() ?? path;
        const displayName = virtual
          ? t(virtual.labelKey, { defaultValue: virtual.defaultLabel })
          : attachment ? (meta?.title || basename) : stripNoteExtension(meta?.title || basename);
        const iconEntry = docIcons.get(path);

        const iconNode = VirtualIcon ? (
          <VirtualIcon size={ICON.ui} style={{ opacity: 0.7 }} />
        ) : isBase ? (
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
            data-tip={path}
            style={{
              width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 6,
              padding: "0.3rem 0.5rem", border: "none", cursor: "pointer", borderRadius: "var(--radius-xs)",
              background: activePath === path ? "var(--accent-container)" : "transparent",
              color: activePath === path ? "var(--on-accent-container)" : "var(--text-main)",
              fontSize: "var(--tree-row-font)",
            }}
          >
            <span aria-hidden="true" style={{ width: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              {iconNode}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0 }}>
              {displayName}
            </span>
          </button>
        );
      })}
    </div>
  );
}
