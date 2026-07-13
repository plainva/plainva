import { useTranslation } from "react-i18next";
import { SheetGrip } from "../components/SheetGrip";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  Trash2,
} from "lucide-react";

/** Mirrors the desktop TableContextMenu action vocabulary (C3). */
export type TableMenuAction =
  | "row-above"
  | "row-below"
  | "row-delete"
  | "col-left"
  | "col-right"
  | "col-delete"
  | "align-left"
  | "align-center"
  | "align-right"
  | "table-delete";

/**
 * Table cell menu (M3E package C3): the live table widget dispatches
 * plainva-open-table-menu on a cell long-press (the WebView's contextmenu);
 * the desktop shows a pointer menu, mobile shows this sheet. Actions run the
 * SAME shared tableModel mutations in the host.
 */
export function TableMenuSheet({
  onAction,
  onClose,
}: {
  onAction: (action: TableMenuAction) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const rows: Array<{ action: TableMenuAction; icon: React.ReactNode; label: string; danger?: boolean }> = [
    { action: "row-above", icon: <ArrowUpToLine size={18} />, label: t("editor.tableRowAbove") },
    { action: "row-below", icon: <ArrowDownToLine size={18} />, label: t("editor.tableRowBelow") },
    { action: "row-delete", icon: <Trash2 size={18} />, label: t("editor.tableRowDelete"), danger: true },
    { action: "col-left", icon: <ArrowLeftToLine size={18} />, label: t("editor.tableColLeft") },
    { action: "col-right", icon: <ArrowRightToLine size={18} />, label: t("editor.tableColRight") },
    { action: "col-delete", icon: <Trash2 size={18} />, label: t("editor.tableColDelete"), danger: true },
    { action: "align-left", icon: <AlignLeft size={18} />, label: t("editor.tableAlignLeft") },
    { action: "align-center", icon: <AlignCenter size={18} />, label: t("editor.tableAlignCenter") },
    { action: "align-right", icon: <AlignRight size={18} />, label: t("editor.tableAlignRight") },
    { action: "table-delete", icon: <Trash2 size={18} />, label: t("editor.tableDelete"), danger: true },
  ];
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{t("editor.tableMenuTitle")}</p>
        {rows.map((r) => (
          <button
            className={r.danger ? "m-row m-danger" : "m-row"}
            key={r.action}
            onClick={() => onAction(r.action)}
          >
            <span className={r.danger ? undefined : "m-accent"} style={{ display: "flex", flexShrink: 0 }}>
              {r.icon}
            </span>
            <span>{r.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
