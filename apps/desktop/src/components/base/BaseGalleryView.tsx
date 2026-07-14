import { EmptyState } from "@plainva/ui";
import type React from "react";
import { useTranslation } from "react-i18next";
import { useCardPointerDrag } from "./useCardPointerDrag";
import { DragGhost, OPEN_SPLIT_TARGET, SplitDropZone } from "./baseViewerShared";
import type { BaseCells } from "./useBaseCells";

// Gallery/card view of the BaseViewer (structural split, plan C3). Cards can be
// dragged onto the split zone to open them in the neighboring pane (P5) — the
// only drop target here, so the drag is enabled only when a split host exists.
export function BaseGalleryView({
  dbData,
  visibleColumns,
  coverImageProperty,
  cells,
  onOpenNote,
  onDropToSplit,
}: {
  dbData: any[];
  visibleColumns: string[];
  coverImageProperty: string | null;
  cells: BaseCells;
  onOpenNote?: (path: string, ev?: React.MouseEvent) => void;
  /** Dropping a card on the split zone opens it in the neighboring pane (P5). */
  onDropToSplit?: (path: string) => void;
}) {
  const { t } = useTranslation();
  const { columnLabel, formatValueForDisplay, renderEditableCell } = cells;
  const { cardHandlers, registerTarget, draggingPath, overTarget, ghostProps } = useCardPointerDrag<string>({
    onDrop: (path, key) => {
      if (key === OPEN_SPLIT_TARGET) onDropToSplit?.(path);
    },
  });
  const draggedRow = draggingPath ? dbData.find((r) => r["file.path"] === draggingPath) : null;

  // Empty view (plan Designsprache P7/C7): a filtered-out view used to render
  // a bare canvas — now the shared EmptyState says so.
  if (dbData.length === 0) {
    return <EmptyState>{t("database.emptyView", { defaultValue: "Keine Einträge in dieser Ansicht." })}</EmptyState>;
  }
  return (
    <div style={{ position: "relative" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: "1rem", padding: "1rem" }}>
        {dbData.map((row, idx) => {
          const coverRaw = coverImageProperty && row[coverImageProperty] ? String(row[coverImageProperty]) : null;
          // A foreign vault could put an unsafe scheme in the cover property. An
          // <img> never executes javascript:, but keep the src to safe schemes:
          // a relative path (no scheme) or an http(s)/blob/data-image URL.
          const coverUrl =
            coverRaw && (!/^[a-z][a-z0-9+.-]*:/i.test(coverRaw.trim()) || /^(?:https?:|blob:|data:image\/)/i.test(coverRaw.trim()))
              ? coverRaw
              : null;
          return (
            <div
              key={row['file.path'] || idx}
              {...(onDropToSplit ? cardHandlers(row['file.path']) : {})}
              style={{ border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)", background: "var(--bg-secondary)", display: "flex", flexDirection: "column", boxShadow: "var(--shadow-1)", overflow: "hidden", touchAction: "none", opacity: draggingPath === row['file.path'] ? 0.45 : 1 }}
            >
              {coverUrl && <img src={coverUrl} alt="Cover" onClick={(e) => onOpenNote?.(row['file.path'], e)} style={{ width: "100%", height: "140px", objectFit: "cover", borderBottom: "1px solid var(--border-color)", cursor: "pointer" }} />}
              <div style={{ padding: "1rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <h3 onClick={(e) => onOpenNote?.(row['file.path'], e)} style={{ margin: "0", fontSize: "1.05rem", fontWeight: 600, wordBreak: "break-word", cursor: "pointer", color: "var(--text-main)" }}>{row['file.name']}</h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", marginTop: "0.5rem" }}>
                  {visibleColumns.filter(c => c !== 'file.name' && c !== coverImageProperty).map(col => {
                    let val = row[col];
                    if (val === undefined && col.startsWith('note.')) val = row[col.substring(5)];
                    const { displayVal } = formatValueForDisplay(val, col);
                    return (
                      <div key={col} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span style={{ fontSize: "0.7rem", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.5px" }}>{columnLabel(col)}</span>
                        <span style={{ fontSize: "0.85rem", color: "var(--text-main)", wordBreak: "break-word" }}>{renderEditableCell(row, col, val, displayVal)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {draggedRow && (
        <DragGhost
          setEl={ghostProps.setEl}
          baseStyle={ghostProps.style}
          style={{ width: 220, background: "var(--bg-secondary)", padding: "0.6rem 0.8rem", borderRadius: "var(--radius-md)", border: "1px solid var(--accent-color)", boxShadow: "var(--shadow-2)", transform: "rotate(1.5deg)", fontSize: "0.9rem", fontWeight: 600, color: "var(--text-main)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {draggedRow["file.name"]}
        </DragGhost>
      )}
      {/* Registered AFTER the group targets: columns win the drop where the zone overlaps them (P12). */}
      <SplitDropZone
        active={!!draggingPath && !!onDropToSplit}
        over={overTarget === OPEN_SPLIT_TARGET}
        registerTarget={registerTarget(OPEN_SPLIT_TARGET)}
        label={t("database.dropOpenInSplit", "Hier ablegen: im Split öffnen")}
      />
    </div>
  );
}
