import React, { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Settings2, Trash2, GripVertical, ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import type { BaseCells } from "./useBaseCells";
import { buildSubItemsTree, type SubItemNode } from "./subItemsTree";
import { ICON } from "@plainva/ui";

// Table view of the BaseViewer (structural split, plan C3), including the
// pointer-driven column reorder and column resize. Persistence stays in the
// BaseViewer: the view reports the final column order / width upward.
export function BaseTableView({
  dbData,
  visibleColumns,
  colWidths,
  cells,
  getSortState,
  onToggleHeaderSort,
  onReorderColumns,
  onPersistColumnWidth,
  onOpenColumnEditor,
  onToggleColumn,
  subItems,
}: {
  dbData: any[];
  visibleColumns: string[];
  colWidths: Record<string, number>;
  cells: BaseCells;
  getSortState: (col: string) => "ASC" | "DESC" | null;
  onToggleHeaderSort: (col: string) => void;
  onReorderColumns: (newCols: string[]) => void;
  onPersistColumnWidth: (col: string, width: number) => void;
  onOpenColumnEditor: (col: string) => void;
  onToggleColumn: (col: string) => void;
  /** Sub-items nesting (P10, Notion model): set when this table view has a
   * `subItemsProperty` — rows whose parent is in the result nest under it. */
  subItems?: {
    property: string;
    expandedKeys: ReadonlySet<string>;
    onToggleExpand: (path: string) => void;
  };
}) {
  const { t } = useTranslation();
  const { editingCell, columnLabel, formatValueForDisplay, renderEditableCell } = cells;

  const displayRows: SubItemNode<any>[] = subItems
    ? buildSubItemsTree(dbData, {
        keyOf: (r) => String(r["file.path"] ?? ""),
        titleOf: (r) => String(r["file.name"] ?? r["file.path"] ?? ""),
        parentRefOf: (r) => r[subItems.property],
        expandedKeys: subItems.expandedKeys,
      })
    : dbData.map((row) => ({ row, depth: 0, hasChildren: false, childCount: 0, isExpanded: false }));

  // --- Column drag & drop reorder (point 1) ---
  // HTML5 DnD is swallowed by Tauri's native drag-drop handler, so the reorder is
  // driven by pointer events (same approach as the right sidebar) — engine- and
  // Tauri-config-independent. The drag source lives in a ref so pointer handlers
  // never read stale React state; `colOverId` only feeds the drop indicator.
  const thEls = useRef<Record<string, HTMLElement>>({});
  const colDragRef = useRef<string | null>(null);
  const [colDragId, setColDragId] = useState<string | null>(null);
  const [colOverId, setColOverId] = useState<string | null>(null);

  const reorderColumns = (from: string, to: string) => {
    const cols = visibleColumns.filter((c) => c !== from);
    const ti = cols.indexOf(to);
    if (ti < 0) return;
    cols.splice(ti, 0, from);
    onReorderColumns(cols);
  };

  const colAtX = (clientX: number): string | null => {
    for (const c of visibleColumns) {
      const el = thEls.current[c];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return c;
    }
    return null;
  };
  const beginColDrag = (col: string, e: React.PointerEvent) => {
    e.preventDefault();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    colDragRef.current = col;
    setColDragId(col);
    setColOverId(col);
  };
  const onColMove = (e: React.PointerEvent) => {
    if (!colDragRef.current) return;
    const target = colAtX(e.clientX);
    if (target) setColOverId(target);
  };
  const endColDrag = (e: React.PointerEvent) => {
    const from = colDragRef.current;
    colDragRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* unsupported */ }
    const to = colAtX(e.clientX); // computed fresh, never from stale state
    if (from && to && from !== to) reorderColumns(from, to);
    setColDragId(null);
    setColOverId(null);
  };
  const cancelColDrag = () => { colDragRef.current = null; setColDragId(null); setColOverId(null); };

  // --- Column width resize (point 2); widths persist per view under views[i].widths. ---
  const colResizeRef = useRef<{ col: string; startX: number; startW: number } | null>(null);
  const beginColResize = (col: string, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* unsupported */ }
    const el = thEls.current[col];
    const startW = el ? el.getBoundingClientRect().width : 120;
    colResizeRef.current = { col, startX: e.clientX, startW };
  };
  const onColResizeMove = (e: React.PointerEvent) => {
    const d = colResizeRef.current;
    if (!d) return;
    const el = thEls.current[d.col];
    if (el) el.style.width = `${Math.max(60, Math.round(d.startW + (e.clientX - d.startX)))}px`;
  };
  const endColResize = (e: React.PointerEvent) => {
    const d = colResizeRef.current;
    colResizeRef.current = null;
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* unsupported */ }
    if (!d) return;
    const finalW = Math.max(60, Math.round(d.startW + (e.clientX - d.startX)));
    onPersistColumnWidth(d.col, finalW);
  };
  const cancelColResize = () => { colResizeRef.current = null; };

  if (visibleColumns.length === 0) {
    return <div style={{ padding: '1rem', color: 'var(--text-muted)' }}>{t("database.noColumns", "No columns selected.")}</div>;
  }

  return (
    // Horizontal scroll container (plan W5/P13-P14): when the configured column
    // widths exceed the pane, the table overflows into a VISIBLE scrollbar so
    // the last column stays reachable; long cell text still wraps (capped by the
    // per-cell max width). The former 100px bottom padding was a workaround for
    // the absolute-positioned date popover, which is fixed-positioned now.
    <div className="custom-scrollbar" style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 'var(--text-md)' }}>
        <thead>
          <tr>
            {visibleColumns.map((col: string) => (
              <th
                key={col}
                ref={(el) => { if (el) thEls.current[col] = el; }}
                className={colOverId === col && colDragId && colDragId !== col ? "base-col-drop" : undefined}
                style={{ borderBottom: '2px solid var(--border-color)', padding: 'var(--pad-cell)', fontWeight: 600, color: 'var(--text-main)', whiteSpace: 'nowrap', background: 'var(--bg-secondary)', position: 'sticky', top: 0, zIndex: "var(--z-popover)" as unknown as number, opacity: colDragId === col ? 0.5 : 1, width: colWidths[col] }}
              >
                <div
                  onClick={() => onToggleHeaderSort(col)}
                  data-tip={t("database.sortByColumn", "Nach dieser Spalte sortieren")}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", cursor: "pointer" }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: "4px", minWidth: 0 }}>
                    <span
                      className="base-col-grip"
                      onPointerDown={(e) => { if (e.button === 0) beginColDrag(col, e); }}
                      onPointerMove={onColMove}
                      onPointerUp={endColDrag}
                      onPointerCancel={cancelColDrag}
                      onClick={(e) => e.stopPropagation()}
                      role="button"
                      aria-label={t("database.reorderColumn", { defaultValue: "Spalte verschieben" })}
                      data-tip={t("database.reorderColumn", { defaultValue: "Spalte verschieben" })}
                      style={{ display: "flex", cursor: "grab", touchAction: "none", color: "var(--text-muted)", flexShrink: 0 }}
                    >
                      <GripVertical size={ICON.meta} />
                    </span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{columnLabel(col)}</span>
                    {getSortState(col) === "ASC" && <ChevronUp size={ICON.meta} style={{ flexShrink: 0 }} />}
                    {getSortState(col) === "DESC" && <ChevronDown size={ICON.meta} style={{ flexShrink: 0 }} />}
                  </span>
                  {!col.startsWith('file.') && (
                    <span className="base-th-actions" style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
                      <button onClick={(e) => { e.stopPropagation(); onOpenColumnEditor(col); }} aria-label={t("properties.editColumn", { column: col })} data-tip={t("properties.editColumn", { column: col })} className="pv-iconbtn pv-iconbtn--sm">
                        <Settings2 size={ICON.meta} />
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); onToggleColumn(col); }} aria-label={t("database.removeColumn", { defaultValue: "Spalte entfernen" })} data-tip={t("database.removeColumn", { defaultValue: "Spalte entfernen" })} className="pv-iconbtn pv-iconbtn--sm">
                        <Trash2 size={ICON.meta} />
                      </button>
                    </span>
                  )}
                </div>
                <div
                  className="base-col-resize"
                  onPointerDown={(e) => beginColResize(col, e)}
                  onPointerMove={onColResizeMove}
                  onPointerUp={endColResize}
                  onPointerCancel={cancelColResize}
                  onClick={(e) => e.stopPropagation()}
                  aria-hidden="true"
                  style={{ position: "absolute", top: 0, right: 0, width: "7px", height: "100%", cursor: "col-resize", touchAction: "none" }}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {displayRows.map(({ row, depth, hasChildren, childCount, isExpanded }, idx) => (
            <tr key={row['file.path'] || idx} style={{ borderBottom: '1px solid var(--border-color)' }} className="table-row-hover">
              {visibleColumns.map((col: string, colIdx: number) => {
                const isEditing = editingCell?.path === row['file.path'] && editingCell?.col === col;

                let val = row[col];
                if (val === undefined && col.startsWith('note.')) val = row[col.substring(5)];

                const { displayVal, isMissing } = formatValueForDisplay(val, col);
                const cell = renderEditableCell(row, col, val, displayVal);

                // Sub-items mode: the first visible column carries the indent,
                // the disclosure toggle (or an equal-width spacer) and the
                // child-count badge (P10).
                const nested = subItems && colIdx === 0;

                return (
                  <td
                    key={col}
                    style={{ padding: isEditing ? '4px 8px' : 'var(--pad-cell)', color: isMissing ? 'var(--text-muted)' : 'var(--text-main)', verticalAlign: 'middle', maxWidth: 420 }}
                  >
                    {nested ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 4, paddingLeft: depth * 18 }}>
                        {hasChildren ? (
                          <button
                            type="button"
                            className="base-subitem-toggle"
                            aria-label={t(isExpanded ? "database.collapseRow" : "database.expandRow", { defaultValue: isExpanded ? "Zuklappen" : "Aufklappen" })}
                            data-tip={t(isExpanded ? "database.collapseRow" : "database.expandRow", { defaultValue: isExpanded ? "Zuklappen" : "Aufklappen" })}
                            onClick={(e) => { e.stopPropagation(); subItems!.onToggleExpand(String(row["file.path"])); }}
                          >
                            {isExpanded ? <ChevronDown size={ICON.ui} /> : <ChevronRight size={ICON.ui} />}
                          </button>
                        ) : (
                          <span style={{ width: 19, flexShrink: 0 }} aria-hidden="true" />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>{cell}</div>
                        {hasChildren && (
                          <span
                            className="base-subitem-badge"
                            data-tip={t("database.subItemsCountTooltip", { count: childCount, defaultValue: "{{count}} Unterelemente" })}
                          >{childCount}</span>
                        )}
                      </div>
                    ) : cell}
                  </td>
                );
              })}
            </tr>
          ))}
          {dbData.length === 0 && (
            <tr><td colSpan={visibleColumns.length} style={{ padding: '16px', textAlign: 'center', color: 'var(--text-muted)' }}>{t("database.noMatchingFiles", "No matching files found.")}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
