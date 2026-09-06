import { ICON } from "@plainva/ui";
import { useRef, useState } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { GripHorizontal, Plus } from "lucide-react";
import { BoardCardChecklist } from "./BoardCardChecklist";
import { hitTest, useCardPointerDrag } from "./useCardPointerDrag";
import { DragGhost, dueChipStyle, OPEN_SPLIT_TARGET, SplitDropZone } from "./baseViewerShared";
import { orderBoardGroups, reorderBoardKeys } from "@plainva/ui";
import { Button, chipPaletteIndex, groupRowsByLane, laneWriteValue, rowDueTone, TextInput, UNGROUPED_KEY, type TaskCompletionModel } from "@plainva/ui";
import { ChevronDown, ChevronRight } from "lucide-react";
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
  boardWipLimits,
  boardLaneBy = null,
  collapsedLanes,
  onToggleLane,
  cells,
  dueModel = null,
  onOpenNote,
  onDropToSplit,
  onAddGroup,
  onReorderColumns,
  onSetWipLimit,
}: {
  dbData: any[];
  dbConfig: any;
  visibleColumns: string[];
  boardGroupBy: string | null;
  /** Per-view saved column order (relation/text boards), from the active view. */
  boardColumnOrder?: string[];
  /** Whole-column tint vs header-chip only (WP3); applies to option-typed groups. */
  boardColorMode?: "chip" | "column";
  /** WIP limits per column key (issue #83): the header reads `n/limit` and
   * turns to the warning tone once a column holds more than it should. */
  boardWipLimits?: Record<string, number>;
  /** Swimlanes (issue #83): a second grouping property — a row per value,
   * dropping a card on a cell writes column AND lane. Null = no lanes. */
  boardLaneBy?: string | null;
  /** Lane keys folded away (per file, app-side) and the toggle. */
  collapsedLanes?: ReadonlySet<string>;
  onToggleLane?: (laneKey: string) => void;
  cells: BaseCells;
  /** The database's completion model — a date on a card of an unfinished row
   * that is today or earlier gets the overdue pill (issues #83/#84). */
  dueModel?: TaskCompletionModel | null;
  onOpenNote?: (path: string, ev?: React.MouseEvent) => void;
  /** Dropping a card on the split zone opens it in the neighboring pane (P5). */
  onDropToSplit?: (path: string) => void;
  onAddGroup: (name: string) => void;
  /** Persist a new column order after a header drag (report 2026-07-07). */
  onReorderColumns?: (orderedKeys: string[]) => void;
  /** Sets or clears (null) a column's WIP limit — the count badge edits it inline. */
  onSetWipLimit?: (groupKey: string, limit: number | null) => void;
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
  // A card key names the path, the source column (relation boards move the
  // link away from it) and the source lane (a multi-valued lane shows the same
  // card twice). JSON, so no separator can collide with a path.
  const cardKeyOf = (path: string, groupKey: string, laneKey: string | null = null) => JSON.stringify([path, isRelationGroup ? groupKey : "", laneKey ?? ""]);
  const parseCardKey = (key: string): { path: string; group: string; lane: string } => {
    try {
      const [path, group, lane] = JSON.parse(key) as [string, string, string];
      return { path, group, lane };
    } catch {
      return { path: key, group: "", lane: "" };
    }
  };
  const pathOfCardKey = (key: string | null) => (key ? parseCardKey(key).path : null);
  // A drop target is a column, or — with lanes — a column inside a lane.
  const targetKeyOf = (groupKey: string, laneKey: string | null) => (laneKey === null ? groupKey : JSON.stringify([laneKey, groupKey]));
  const parseTargetKey = (key: string): { group: string; lane: string | null } => {
    if (!boardLaneBy || !key.startsWith("[")) return { group: key, lane: null };
    try {
      const [lane, group] = JSON.parse(key) as [string, string];
      return { group, lane };
    } catch {
      return { group: key, lane: null };
    }
  };

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
    onDrop: (cardKey, targetKey) => {
      const card = parseCardKey(cardKey);
      const path = card.path;
      if (targetKey === OPEN_SPLIT_TARGET) { onDropToSplit?.(path); return; }
      if (!boardGroupBy) return;
      const target = parseTargetKey(targetKey);
      // The lane write follows the column write — two frontmatter edits of one
      // note, one after the other, never side by side.
      const laneWrite = async () => {
        if (!boardLaneBy || target.lane === null || target.lane === card.lane) return;
        await handleCellSave(path, boardLaneBy, laneWriteValue(lanes.map((l) => ({ key: l.key ?? "", value: l.value })), target.lane));
      };
      if (isRelationGroup) {
        regroupRelation(path, card.group, target.group);
        void laneWrite();
        return;
      }
      void Promise.resolve(handleCellSave(path, boardGroupBy, target.group === "__UNGROUPED__" ? "" : target.group)).then(laneWrite);
    },
  });
  const draggingCardPath = pathOfCardKey(draggingPath);
  const draggedRow = draggingCardPath ? dbData.find((r) => r["file.path"] === draggingCardPath) : null;

  // WIP limit editing (issue #83): clicking a column's count badge turns it
  // into a number field; Enter/blur commits, empty clears. No prompt, no
  // menu — the number sits where it is read.
  const [editingLimit, setEditingLimit] = useState<{ key: string; value: string } | null>(null);
  const commitLimit = () => {
    if (!editingLimit) return;
    const n = Number(editingLimit.value.trim());
    onSetWipLimit?.(editingLimit.key, Number.isInteger(n) && n > 0 ? n : null);
    setEditingLimit(null);
  };

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

  // Cards bucketed by column; called once for the whole board (column order)
  // and once per lane (issue #83, P6). A card with several values sits in
  // every matching column, exactly as before.
  const bucketByColumn = (source: any[]): Record<string, any[]> => {
    const out: Record<string, any[]> = { "__UNGROUPED__": [] };
    if (!isRelationGroup && dbConfig?.columns?.[boardGroupBy]?.options) {
      const opts = dbConfig.columns[boardGroupBy].options;
      if (Array.isArray(opts)) {
        opts.forEach((opt: any) => {
          out[opt.label || opt.value || String(opt)] = [];
        });
      }
    }
    source.forEach(row => {
      let val = row[boardGroupBy];
      if (val === undefined && boardGroupBy.startsWith('note.')) val = row[boardGroupBy.substring(5)];

      if (isRelationGroup) {
        const links: string[] = Array.isArray(val) ? val.map(String) : val == null || val === "" ? [] : [String(val)];
        if (links.length === 0) {
          out["__UNGROUPED__"].push(row);
        } else {
          for (const link of links) {
            if (!out[link]) out[link] = [];
            out[link].push(row);
          }
        }
        return;
      }

      const strVal = (val === undefined || val === null || val === "") ? "__UNGROUPED__" : String(val);
      if (!out[strVal]) out[strVal] = [];
      out[strVal].push(row);
    });
    return out;
  };
  const groups = bucketByColumn(dbData);

  // Column order: option order for select/status boards (a drag reorders those
  // options), else the per-view saved order; never plain alphabetical.
  const optionOrder: string[] = isRelationGroup
    ? []
    : Array.isArray(dbConfig?.columns?.[boardGroupBy]?.options)
      ? dbConfig.columns[boardGroupBy].options.map((o: any) => o?.label || o?.value || String(o))
      : [];
  const orderedKeys = orderBoardGroups(Object.keys(groups), { optionOrder, savedOrder: boardColumnOrder });

  // Swimlanes: the second axis, in the lane property's option order, "No
  // value" last. Without a lane property there is exactly one, unnamed lane —
  // the board as it always was.
  const laneOptionOrder: string[] = boardLaneBy && Array.isArray(dbConfig?.columns?.[boardLaneBy]?.options)
    ? dbConfig.columns[boardLaneBy].options.map((o: any) => o?.label || o?.value || String(o))
    : [];
  const lanes: Array<{ key: string | null; value: string; rows: any[] }> = boardLaneBy
    ? groupRowsByLane(dbData, boardLaneBy, laneOptionOrder)
    : [{ key: null, value: "", rows: dbData }];

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

  const renderColumn = (groupKey: string, rows: any[], laneKey: string | null, laneIndex: number) => {
    const tintIdx = groupTintIndex(groupKey);
    const tinted = tintIdx != null;
    return (
          <div
            key={targetKeyOf(groupKey, laneKey)}
            ref={(el) => { registerTarget(targetKeyOf(groupKey, laneKey))(el); if (laneIndex === 0) { if (el) colRefs.current.set(groupKey, el); else colRefs.current.delete(groupKey); } }}
            style={{ width: "280px", flexShrink: 0, background: tinted ? `var(--chip-${tintIdx}-bg)` : "var(--bg-secondary)", borderRadius: "var(--radius-md)", display: "flex", flexDirection: "column", maxHeight: "100%", outline: (overTarget === targetKeyOf(groupKey, laneKey) && draggingPath) || (overCol === groupKey && dragCol && dragCol !== groupKey) ? "2px solid var(--accent-color)" : "none", outlineOffset: -2, opacity: dragCol === groupKey ? 0.5 : 1 }}
          >
            <div
              {...(onReorderColumns && laneIndex === 0 ? colHeaderHandlers(groupKey) : {})}
              style={{ padding: "0.75rem", borderBottom: tinted ? "1px solid transparent" : "1px solid var(--border-color)", display: "flex", alignItems: "center", justifyContent: "space-between", fontWeight: 600, cursor: onReorderColumns ? "grab" : "default", touchAction: "none", userSelect: "none" }}
              data-testid={laneKey === null ? `board-col-header-${groupKey}` : `board-col-header-${groupKey}-${laneKey}`}
            >
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                {onReorderColumns && <GripHorizontal size={ICON.ui} style={{ flexShrink: 0, color: tinted ? `var(--chip-${tintIdx}-fg)` : "var(--text-faint)" }} aria-hidden="true" />}
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{groupKey === "__UNGROUPED__" ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{t("database.boardUngrouped", "Kein Wert")}</span> : tinted ? <span style={{ color: `var(--chip-${tintIdx}-fg)`, fontWeight: 600 }}>{groupKey}</span> : (renderTypedDisplay(boardGroupBy, groupKey) ?? groupKey)}</span>
              </span>
              {(() => {
                const count = rows.length;
                const limit = boardWipLimits?.[groupKey];
                const over = limit != null && count > limit;
                if (editingLimit?.key === groupKey) {
                  return (
                    <TextInput
                      compact
                      type="number"
                      min={1}
                      autoFocus
                      value={editingLimit.value}
                      aria-label={t("database.wipLimit")}
                      data-testid={`board-col-limit-${groupKey}`}
                      onPointerDown={(e) => e.stopPropagation()}
                      onChange={(e) => setEditingLimit({ key: groupKey, value: e.target.value })}
                      onBlur={commitLimit}
                      onKeyDown={(e) => { if (e.key === "Enter") commitLimit(); if (e.key === "Escape") setEditingLimit(null); }}
                      style={{ width: "4.5rem", flexShrink: 0 }}
                    />
                  );
                }
                const badge = (
                  <span
                    data-testid={laneKey === null ? `board-col-count-${groupKey}` : `board-col-count-${groupKey}-${laneKey}`}
                    data-over={over ? "true" : undefined}
                    style={{ fontSize: "var(--text-sm)", color: over ? "var(--warning-text)" : "var(--text-muted)", background: over ? "var(--warning-bg)" : "var(--bg-primary)", padding: "2px 6px", borderRadius: "var(--radius-lg)", flexShrink: 0, fontWeight: over ? 600 : 400, fontVariantNumeric: "tabular-nums" }}
                  >
                    {limit != null ? `${count}/${limit}` : count}
                  </span>
                );
                if (!onSetWipLimit) return badge;
                return (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={over ? t("database.wipLimitOver", { count, limit }) : t("database.wipLimit")}
                    data-tip={over ? t("database.wipLimitOver", { count, limit }) : t("database.wipLimitHint")}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); setEditingLimit({ key: groupKey, value: limit != null ? String(limit) : "" }); }}
                    style={{ padding: 0, minWidth: 0, height: "auto" }}
                  >
                    {badge}
                  </Button>
                );
              })()}
            </div>
            <div className="custom-scrollbar" style={{ padding: "0.5rem", overflowY: "auto", display: "flex", flexDirection: "column", gap: "0.5rem", flex: 1 }}>
              {rows.map((row, idx) => (
                <div
                  key={row['file.path'] || idx}
                  data-testid="base-row"
                  onContextMenu={(e) => cells.onRowContextMenu?.(row['file.path'], e)}
                  {...(isReverseGroup ? {} : cardHandlers(cardKeyOf(row['file.path'], groupKey, laneKey)))}
                  onClick={(e) => onOpenNote?.(row['file.path'], e)}
                  style={{ background: "var(--bg-primary)", padding: "var(--space-3)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-color)", boxShadow: "var(--shadow-1)", cursor: isReverseGroup ? "pointer" : "grab", touchAction: "none", opacity: draggingPath === cardKeyOf(row['file.path'], groupKey, laneKey) ? 0.45 : 1 }}
                >
                  <div
                    data-tip={row['file.name']}
                    style={{ fontWeight: 500, fontSize: "var(--text-md)", marginBottom: "0.5rem", cursor: "pointer", color: "var(--text-main)", overflowWrap: "anywhere", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                  >{row['file.name']}</div>
                  {/* The note's own checklist (issue #83, P4): progress from the
                      index, the lines on demand. Not a column row — a card shows it
                      whenever the note has one. */}
                  <BoardCardChecklist path={row['file.path']} progress={row['file.tasks']} />
                  <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                    {visibleColumns.filter(c => c !== 'file.name' && c !== 'file.tasks' && c !== boardGroupBy && c !== boardLaneBy).map(col => {
                      let val = row[col];
                      if (val === undefined && col.startsWith('note.')) val = row[col.substring(5)];
                      const { displayVal } = formatValueForDisplay(val, col);
                      const input = getColumnSchema(col)?.input;
                      const due = input === "date" || input === "datetime" ? dueChipStyle(rowDueTone(row, dueModel, val)) : undefined;
                      return (
                        <div key={col} style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "var(--text-md)" }}>
                          <span style={{ color: "var(--text-muted)" }}>{columnLabel(col)}</span>
                          <div style={{ color: "var(--text-main)" }}>{due ? <span data-testid="board-due-chip" style={due}>{renderEditableCell(row, col, val, displayVal)}</span> : renderEditableCell(row, col, val, displayVal)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
    );
  };

  const renderColumns = (laneKey: string | null, laneIndex: number, laneRows: any[]) => {
    const laneGroups = laneKey === null ? groups : bucketByColumn(laneRows);
    return orderedKeys.map((groupKey) => renderColumn(groupKey, laneGroups[groupKey] ?? [], laneKey, laneIndex));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      <div className="custom-scrollbar" style={boardLaneBy
        ? { display: "flex", flexDirection: "column", gap: "var(--space-4)", padding: "var(--space-4)", overflow: "auto", flex: 1 }
        : { display: "flex", gap: "var(--space-4)", padding: "var(--space-4)", overflowX: "auto", flex: 1, alignItems: "flex-start" }}
      >
        {boardLaneBy
          ? lanes.map((lane, laneIndex) => {
              const laneKey = lane.key!;
              const collapsed = collapsedLanes?.has(laneKey) ?? false;
              const label = laneKey === UNGROUPED_KEY
                ? <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>{t("database.boardUngrouped", "Kein Wert")}</span>
                : (renderTypedDisplay(boardLaneBy, laneKey) ?? laneKey);
              return (
                <section key={laneKey} data-testid={`board-lane-${laneKey}`} data-collapsed={collapsed ? "true" : undefined} style={{ display: "grid", gap: "var(--space-2)" }}>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-expanded={!collapsed}
                    aria-label={collapsed ? t("database.laneExpand") : t("database.laneCollapse")}
                    data-testid={`board-lane-toggle-${laneKey}`}
                    onClick={() => onToggleLane?.(laneKey)}
                    style={{ justifyContent: "flex-start", gap: "var(--space-2)", fontWeight: 600 }}
                  >
                    {collapsed ? <ChevronRight size={ICON.ui} /> : <ChevronDown size={ICON.ui} />}
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                    <span style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", background: "var(--bg-secondary)", padding: "0 var(--space-2)", borderRadius: "var(--radius-lg)", fontVariantNumeric: "tabular-nums" }}>{lane.rows.length}</span>
                  </Button>
                  {!collapsed && (
                    <div className="custom-scrollbar" style={{ display: "flex", gap: "var(--space-4)", overflowX: "auto", alignItems: "flex-start" }}>
                      {renderColumns(laneKey, laneIndex, lane.rows)}
                    </div>
                  )}
                </section>
              );
            })
          : renderColumns(null, 0, dbData)}
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
