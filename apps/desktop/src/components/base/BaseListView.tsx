import type React from "react";
import type { BaseCells } from "./useBaseCells";

// List view of the BaseViewer (structural split, plan C3).
export function BaseListView({
  dbData,
  visibleColumns,
  cells,
  onOpenNote,
}: {
  dbData: any[];
  visibleColumns: string[];
  cells: BaseCells;
  onOpenNote?: (path: string, ev?: React.MouseEvent) => void;
}) {
  const { columnLabel, formatValueForDisplay, renderEditableCell } = cells;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", padding: "1rem" }}>
      {dbData.map((row, idx) => (
        <div key={row['file.path'] || idx} style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", padding: "var(--space-4)", background: "var(--bg-secondary)", boxShadow: "var(--shadow-1)" }}>
          <h3 onClick={(e) => onOpenNote?.(row['file.path'], e)} style={{ margin: "0 0 0.5rem 0", fontSize: "var(--text-lg)", cursor: "pointer", color: "var(--text-main)", overflowWrap: "anywhere" }}>{row['file.name']}</h3>
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
