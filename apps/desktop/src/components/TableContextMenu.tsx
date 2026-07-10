import React from "react";
import { useTranslation } from "react-i18next";
import { MenuSurface, MenuItem, MenuSeparator } from "@plainva/ui";

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

export type TableAlignValue = "left" | "center" | "right" | null;

interface Props {
  // Anchor position in viewport coords (the right-click point).
  x: number;
  y: number;
  // Whether the right-clicked cell was a header cell (no row delete / row-above).
  kind: "header" | "body";
  // Current alignment of the clicked column (to mark the active option).
  align: TableAlignValue;
  onAction: (action: TableMenuAction) => void;
  onClose: () => void;
}

type Item =
  | { kind: "sep" }
  | { kind: "item"; action: TableMenuAction; label: string; danger?: boolean; checked?: boolean };

/**
 * Right-click menu for the live table widget — a MenuSurface at the click
 * point (plan Designsprache P5), so it shares look, keyboard model and
 * close behavior with every other menu.
 */
export const TableContextMenu: React.FC<Props> = ({ x, y, kind, align, onAction, onClose }) => {
  const { t } = useTranslation();

  const items: Item[] = [];
  if (kind === "body") {
    items.push({ kind: "item", action: "row-above", label: t("editor.tableRowAbove", { defaultValue: "Insert row above" }) });
    items.push({ kind: "item", action: "row-below", label: t("editor.tableRowBelow", { defaultValue: "Insert row below" }) });
    items.push({ kind: "item", action: "row-delete", label: t("editor.tableRowDelete", { defaultValue: "Delete row" }), danger: true });
  } else {
    items.push({ kind: "item", action: "row-below", label: t("editor.tableRowBelow", { defaultValue: "Insert row below" }) });
  }
  items.push({ kind: "sep" });
  items.push({ kind: "item", action: "col-left", label: t("editor.tableColLeft", { defaultValue: "Insert column left" }) });
  items.push({ kind: "item", action: "col-right", label: t("editor.tableColRight", { defaultValue: "Insert column right" }) });
  items.push({ kind: "item", action: "col-delete", label: t("editor.tableColDelete", { defaultValue: "Delete column" }), danger: true });
  items.push({ kind: "sep" });
  items.push({ kind: "item", action: "align-left", label: t("editor.tableAlignLeft", { defaultValue: "Align left" }), checked: align === "left" });
  items.push({ kind: "item", action: "align-center", label: t("editor.tableAlignCenter", { defaultValue: "Align center" }), checked: align === "center" });
  items.push({ kind: "item", action: "align-right", label: t("editor.tableAlignRight", { defaultValue: "Align right" }), checked: align === "right" });
  items.push({ kind: "sep" });
  items.push({ kind: "item", action: "table-delete", label: t("editor.tableDelete", { defaultValue: "Delete table" }), danger: true });

  return (
    <MenuSurface open onClose={onClose} at={{ x, y }} minWidth={220} ariaLabel={t("editor.tableMenuTitle", { defaultValue: "Edit table" })}>
      {items.map((it, i) =>
        it.kind === "sep" ? (
          <MenuSeparator key={`sep-${i}`} />
        ) : (
          <MenuItem
            key={it.action}
            danger={it.danger}
            icon={<span style={{ width: 14, display: "inline-block", textAlign: "center" }}>{it.checked ? "✓" : ""}</span>}
            onSelect={() => onAction(it.action)}
          >
            {it.label}
          </MenuItem>
        ),
      )}
    </MenuSurface>
  );
};
