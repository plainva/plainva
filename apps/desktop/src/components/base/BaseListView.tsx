import type React from "react";
import { useTranslation } from "react-i18next";
import type { BaseCells } from "./useBaseCells";

// List view of the BaseViewer (structural split, plan C3).
export function BaseListView({
  dbData,
  visibleColumns,
  cells,
  onOpenNote,
  selection,
}: {
  dbData: any[];
  visibleColumns: string[];
  cells: BaseCells;
  onOpenNote?: (path: string, ev?: React.MouseEvent) => void;
  /** Multi-selection (plan Mehrfachauswahl, P3). Absent = no checkbox. */
  selection?: {
    selected: ReadonlySet<string>;
    onClick: (path: string, e: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) => void;
  };
}) {
  const { t } = useTranslation();
  const { columnLabel, formatValueForDisplay, renderEditableCell } = cells;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", padding: "1rem" }}>
      {dbData.map((row, idx) => (
        <div key={row['file.path'] || idx} data-testid="base-row" onContextMenu={(e) => cells.onRowContextMenu?.(row['file.path'], e)} style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", background: selection?.selected.has(String(row['file.path'])) ? "var(--accent-container)" : "var(--bg-secondary)", color: selection?.selected.has(String(row['file.path'])) ? "var(--on-accent-container)" : undefined, boxShadow: "var(--shadow-1)" }}>
          <h3 style={{ margin: "0 0 0.5rem 0", fontSize: "var(--text-lg)", color: "inherit", overflowWrap: "anywhere", display: "flex", alignItems: "center", gap: "var(--space-2)" }}>
            {selection && (
              // The title opens the note — it always has. So the checkbox is
              // its own target, sitting in front of the title rather than
              // taking a click the card already spends.
              <input
                type="checkbox"
                className="pv-check"
                checked={selection.selected.has(String(row['file.path']))}
                onClick={(e) => { e.stopPropagation(); selection.onClick(String(row['file.path']), e); }}
                onChange={() => { /* click handler owns it */ }}
                aria-label={t("database.selectRow", { defaultValue: "Zeile auswählen" })}
                data-testid="base-select-row"
              />
            )}
            <span onClick={(e) => onOpenNote?.(row['file.path'], e)} style={{ cursor: "pointer", minWidth: 0, overflowWrap: "anywhere" }}>{row['file.name']}</span>
          </h3>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem" }}>
            {visibleColumns.filter(c => c !== 'file.name').map(col => {
              let val = row[col];
              if (val === undefined && col.startsWith('note.')) val = row[col.substring(5)];
              const { displayVal } = formatValueForDisplay(val, col);
              return (
                <div key={col} style={{ display: "flex", flexDirection: "column", gap: "2px", flex: 1, minWidth: "150px" }}>
                  <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", textTransform: "uppercase" }}>{columnLabel(col)}</span>
                  <span style={{ fontSize: "var(--text-md)", color: "var(--text-main)" }}>{renderEditableCell(row, col, val, displayVal)}</span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
