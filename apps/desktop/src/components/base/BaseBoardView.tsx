import { EmptyState, ICON } from "@plainva/ui";
import { useRef, useState } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { GripHorizontal, Plus } from "lucide-react";
import { hitTest, useCardPointerDrag } from "./useCardPointerDrag";
import { DragGhost, OPEN_SPLIT_TARGET, SplitDropZone } from "./baseViewerShared";
import { orderBoardGroups, reorderBoardKeys } from "@plainva/ui";
import { chipPaletteIndex } from "@plainva/ui";
import type { BaseCells } from "./useBaseCells";

// Board (kanban) view of the BaseViewer (structural split, plan C3). Cards are
// grouped by `boardGroupBy`; dropping a card on a column writes the new group
// value into the note's frontmatter. The card drag is pointer-driven (plan
// W6/P5) — HTML5 DnD is swallowed by Tauri's native drag-drop handler. Adding a
// group mutates the .base config and therefore stays with the BaseViewer.
export function BaseBoardView({
  dbData,
  dbConfig,
  visibleColumns,
  boardGroupBy,
  boardColumnOrder,
  boardColorMode = "chip",
  cells,
  onOpenNote,
  onDropToSplit,
  onAddGroup,
  onReorderColumns,
}: {
  dbData: any[];
  dbConfig: any;
  visibleColumns: string[];
  boardGroupBy: string | null;
  /** Per-view saved column order (relation/text boards), from the active view. */
  boardColumnOrder?: string[];
  /** Whole-column tint vs header-chip only (WP3); applies to option-typed groups. */
  boardColorMode?: "chip" | "column";
  cells: BaseCells;
  onOpenNote?: (path: string, ev?: React.MouseEvent) => void;
  /** Dropping a card on the split zone opens it in the neighboring pane (P5). */
  onDropToSplit?: (path: string) => void;
  onAddGroup: (name: string) => void;
  /** Persist a new column order after a header drag (report 2026-07-07). */
  onReorderColumns?: (orderedKeys: string[]) => void;
}) {
  const { t } = useTranslation();
  const { columnLabel, renderTypedDisplay, formatValueForDisplay, renderEditableCell, handleCellSave, commitCellValue, getColumnSchema, getRelationLimit, isReverseColumn } = cells;

  // Grouping by a relation (P11, Notion parity): columns are the linked notes;
  // a card with several links appears in every matching column. Dragging moves
  // the RELATION — the source column's link is replaced by the target's. The
  // card key therefore carries its source group ("path\ngroup", "\n" never
  // occurs in vault paths). Computed reverse columns group read-only.
  const groupInput = boardGroupBy ? getColumnSchema(boardGroupBy)?.input : undefined;
  const isReverseGroup = !!boardGroupBy && isReverseColumn(boardGroupBy);
  const isRelationGroup = isReverseGroup || groupInput === "relation" || groupInput === "link";
  // Whole-column tint (WP3) only applies to curated option groups.
  const isColoredGroup = groupInput === "select" || groupInput === "status" || groupInput === "multiselect";
  const cardKeyOf = (path: string, groupKey: string) => (isRelationGroup ? `${path}\n${groupKey}` : path);
  const pathOfCardKey = (key: string | null) => (key ? key.split("\n")[0]! : null);

  const regroupRelation = (path: string, sourceGroup: string, targetGroup: string) => {
    if (!boardGroupBy || isReverseGroup) return;
    const row = dbData.find((r) => r["file.path"] === path);
    if (!row) return;
    const raw = row[boardGroupBy];
    const values: string[] = Array.isArray(raw) ? raw.map(String) : raw == null || raw === "" ? [] : [String(raw)];
    let next = values.filter((v) => v !== sourceGroup);
    if (targetGroup !== "__UNGROUPED__" && !next.includes(targetGroup)) next = [...next, targetGroup];
    const limit = getRelationLimit(boardGroupBy);
    void commitCellValue(path, boardGroupBy, limit === "one" ? (next[next.length - 1] ?? "") : next);
  };

  const { cardHandlers, registerTarget, draggingPath, overTarget, ghostProps } = useCardPointerDrag<string>({
    onDrop: (cardKey, groupKey) => {
      const path = pathOfCardKey(cardKey)!;
      if (groupKey === OPEN_SPLIT_TARGET) { onDropToSplit?.(path); return; }
      if (!boardGroupBy) return;
      if (isRelationGroup) {
        regroupRelation(path, cardKey.split("\n")[1] ?? "", groupKey);
        return;
      }
      void handleCellSave(path, boardGroupBy, groupKey === "__UNGROUPED__" ? "" : groupKey);
    },
  });
  const draggingCardPath = pathOfCardKey(draggingPath);
  const draggedRow = draggingCardPath ? dbData.find((r) => r["file.path"] === draggingCardPath) : null;

  const [addingGroup, setAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const commitNewGroup = () => {
    const name = newGroupName.trim();
    if (name) onAddGroup(name);
    setNewGroupName("");
    setAddingGroup(false);
  };

  // Column reorder (report 2026-07-07): the header is a drag handle, columns are
  // the drop targets (hit-tested by rect, like the card drag). State/refs stay
  // above the early returns; the handler factory that needs the resolved column
  // order is defined further down (colHeaderHandlers), closing over it directly.
  const colRefs = useRef<Map<string, HTMLElement>>(new Map());
  const colDragArm = useRef<{ key: string; x: number; y: number; armed: boolean } | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<string | null>(null);

  if (!boardGroupBy) return <div style={{ padding: "1rem", color: "var(--text-muted)" }}>{t("database.boardNoGroupField", "Keine Eigenschaft zum Gruppieren gefunden.")}</div>;

  const groups: Record<string, any[]> = { "__UNGROUPED__": [] };

  if (!isRelationGroup && dbConfig?.columns?.[boardGroupBy]?.options) {
    const opts = dbConfig.columns[boardGroupBy].options;
    if (Array.isArray(opts)) {
      opts.forEach((opt: any) => {
        groups[opt.label || opt.value || String(opt)] = [];
      });
    }
  }

  dbData.forEach(row => {
    let val = row[boardGroupBy];
    if (val === undefined && boardGroupBy.startsWith('note.')) val = row[boardGroupBy.substring(5)];

    if (isRelationGroup) {
      const links: string[] = Array.isArray(val) ? val.map(String) : val == null || val === "" ? [] : [String(val)];
      if (links.length === 0) {
        groups["__UNGROUPED__"].push(row);
      } else {
        for (const link of links) {
          if (!groups[link]) groups[link] = [];
          groups[link].push(row);
        }
      }
      return;
    }

    const strVal = (val === undefined || val === null || val === "") ? "__UNGROUPED__" : String(val);
    if (!groups[strVal]) groups[strVal] = [];
    groups[strVal].push(row);
  });

  // Empty view (plan Designsprache P7/C7): a filtered-out view used to render
  // a bare canvas — now the shared EmptyState says so.
  if (dbData.length === 0) {
    return <EmptyState>{t("database.emptyView", { defaultValue: "Keine Einträge in dieser Ansicht." })}</EmptyState>;
  }

  // Column order: option order for select/status boards (a drag reorders those
  // options), else the per-view saved order; never plain alphabetical.
  const optionOrder: string[] = isRelationGroup
    ? []
    : Array.isArray(dbConfig?.columns?.[boardGroupBy]?.options)
      ? dbConfig.columns[boardGroupBy].options.map((o: any) => o?.label || o?.value || String(o))
      : [];
  const orderedKeys = orderBoardGroups(Object.keys(groups), { optionOrder, savedOrder: boardColumnOrder });

  // Palette slot for a group's whole-column tint (WP3): only for option groups
  // in "column" mode; null = neutral column (header chip / plain label instead).
  const optionsForGroup: any[] = !isRelationGroup && Array.isArray(dbConfig?.columns?.[boardGroupBy!]?.options)
    ? dbConfig.columns[boardGroupBy!].options
    : [];
  const groupTintIndex = (key: string): number | null => {
    if (boardColorMode !== "column" || !isColoredGroup || key === "__UNGROUPED__") return null;
    const opt = optionsForGroup.find((o) => (o?.label || o?.value || String(o)) === key || o?.value === key);
    return chipPaletteIndex(key, opt?.color);
  };

  // Header drag: arm after a small move (so a plain click never flickers), then
  // hit-test the columns by rect and, on drop, hand the host the new key order.
  const colHeaderHandlers = (key: string) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0 || !onReorderColumns) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      colDragArm.current = { key, x: e.clientX, y: e.clientY, armed: false };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const arm = colDragArm.current;
      if (!arm) return;
      if (!arm.armed) {
        if (Math.hypot(e.clientX - arm.x, e.clientY - arm.y) < 4) return;
        arm.armed = true;
        setDragCol(arm.key);
      }
      setOverCol(hitTest(colRefs.current, e.clientX, e.clientY));
    },
    onPointerUp: (e: React.PointerEvent) => {
      const arm = colDragArm.current;
      colDragArm.current = null;
      try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
      const to = hitTest(colRefs.current, e.clientX, e.clientY);
      if (arm?.armed && to && to !== arm.key) onReorderColumns?.(reorderBoardKeys(orderedKeys, arm.key, to));
      setDragCol(null);
      setOverCol(null);
    },
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <div className="custom-scrollbar" style={{ display: "flex", gap: "1rem", padding: "1rem", overflowX: "auto", flex: 1, alignItems: "flex-start" }}>
        {orderedKeys.map(groupKey => {
          const tintIdx = groupTintIndex(groupKey);
          const tinted = tintIdx != null;
          return (
          <div
            key={groupKey}
            ref={(el) => { registerTarget(groupKey)(el); if (el) colRefs.current.set(groupKey, el); else colRefs.current.delete(groupKey); }}
            style={{ width: "280px", flexShrink: 0, background: tinted ? `var(--chip-${tintIdx}-bg)` : "var(--bg-secondary)", borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", maxHeight: "100%", outline: (overTarget === groupKey && draggingPath) || (overCol === groupKey && dragCol && dragCol !== groupKey) ? "2px solid var(--accent-color)" : "none", outlineOffset: -2, opacity: dragCol === groupKey ? 0.5 : 1 }}
          >
            <div
              {...(onReorderColumns ? colHeaderHandlers(groupKey) : {})}
              style={{ padding: "0.75rem", borderBottom: tinted ? "1px solid transparent" : "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between", fontWeight: 600, cursor: onReorderColumns ? "grab" : "default", touchAction: "none", userSelect: "none" }}
              data-testid={`board-col-header-${groupKey}`}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                {onReorderColumns && <GripHorizontal size={ICON.ui} style={{ flexShrink: 0, color: tinted ? `var(--chip-${tintIdx}-fg)` : "var(--text-faint)" }} aria-hidden="true" />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupKey === "__UNGROUPED__" ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{t("database.boardUngrouped", "Kein Wert")}</span> : tinted ? <span style={{ color: `var(--chip-${tintIdx}-fg)`, fontWeight: 600 }}>{groupKey}</span> : (renderTypedDisplay(boardGroupBy, groupKey) ?? groupKey)}</span>
              </span>
              <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", background: "var(--bg-primary)", padding: "2px 6px", borderRadius: "var(--radius-lg)", flexShrink: 0 }}>{groups[groupKey].length}</span>
            </div>
            <div className="custom-scrollbar" style={{ padding: "0.5rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.5rem", flex: 1 }}>
              {groups[groupKey].map((row, idx) => (
                <div
                  key={row['file.path'] || idx}
                  {...(isReverseGroup ? {} : cardHandlers(cardKeyOf(row['file.path'], groupKey)))}
                  onClick={(e) => onOpenNote?.(row['file.path'], e)}
                  style={{ background: "var(--bg-primary)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", boxShadow: "var(--shadow-1)", cursor: isReverseGroup ? "pointer" : "grab", touchAction: "none", opacity: draggingPath === cardKeyOf(row['file.path'], groupKey) ? 0.45 : 1 }}
                >
                  <div
                    data-tip={row['file.name']}
                    style={{ fontWeight: 500, fontSize: "var(--text-md)", marginBottom: "0.5rem", cursor: "pointer", color: "var(--text-main)", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                  >{row['file.name']}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {visibleColumns.filter(c => c !== 'file.name' && c !== boardGroupBy).map(col => {
                      let val = row[col];
                      if (val === undefined && col.startsWith('note.')) val = row[col.substring(5)];
                      const { displayVal } = formatValueForDisplay(val, col);
                      return (
                        <div key={col} style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "var(--text-md)" }}>
                          <span style={{ color: "var(--text-muted)" }}>{columnLabel(col)}</span>
                          <div style={{ color: "var(--text-main)" }}>{renderEditableCell(row, col, val, displayVal)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
          );
        })}
        {/* Relation groups mirror the linked notes — a "new group" would be a new
            note, which the relation editors already offer; hide the button. */}
        {isRelationGroup ? null : !addingGroup ? (
          <button onClick={() => setAddingGroup(true)} className="pv-btn pv-btn--secondary" style={{ flexShrink: 0, width: "200px" }}>
            <Plus size={ICON.ui} /> {t("database.newGroup", "Neue Gruppe")}
          </button>
        ) : (
          <div style={{ flexShrink: 0, width: "200px", background: "var(--bg-secondary)", border: "1px dashed var(--border-color)", borderRadius: "var(--radius-md)", padding: "0.5rem", display: "flex", flexDirection: "column", gap: 4 }}>
            <input
              autoFocus
              type="text"
              className="base-cfg-input"
              placeholder={t("database.newGroupPrompt", "Name der neuen Gruppe:")}
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") commitNewGroup(); if (e.key === "Escape") { setAddingGroup(false); setNewGroupName(""); } }}
              onBlur={() => { if (!newGroupName.trim()) setAddingGroup(false); }}
            />
            <button className="base-cfg-addbtn" onClick={commitNewGroup} disabled={!newGroupName.trim()} style={{ opacity: newGroupName.trim() ? 1 : 0.5 }}>{t("database.add", "Hinzufügen")}</button>
          </div>
        )}
      </div>
      {draggedRow && (
        <DragGhost
          setEl={ghostProps.setEl}
          baseStyle={ghostProps.style}
          style={{ width: 256, background: "var(--bg-primary)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", border: "1px solid var(--accent-color)", boxShadow: "var(--shadow-2)", transform: "rotate(1.5deg)", fontSize: "var(--text-md)", fontWeight: 500, color: "var(--text-main)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
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
