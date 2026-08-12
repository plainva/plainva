import {
  ICON,
  Segmented,
  barFor,
  isMilestone,
  parseDependencies,
  findScheduleConflicts,
  type DependencyNode,
  chipPaletteIndex,
  compareRows,
  dayKey,
  dayPartOf,
  edgeDrag,
  moveBar,
  stepWindow,
  windowAround,
  windowDays,
  type TimelineScale,
  type TimelineWindow,
} from "@plainva/ui";
import React from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { OPEN_SPLIT_TARGET, SplitDropZone } from "./baseViewerShared";
import type { BaseCells } from "./useBaseCells";

// Timeline view of the BaseViewer — a ROW per entry since S21 (plan P10).
//
// It used to be a column per day, with a multi-day entry appearing as a start
// card followed by look-alike continuation chips: the same chain the calendar
// stopped in S5 and S20. A bar needs a row, and an edge you can take hold of
// needs a bar. Dragging an edge writes the start or end column; dragging the
// bar itself moves both and keeps its length.

const NAME_COL = 180;

export function BaseTimelineView({
  dbData,
  dateProp,
  endProp,
  timelineWindow,
  setTimelineWindow,
  colorProp,
  columns,
  visibleColumns,
  cells,
  onOpenNote,
  onDropToSplit,
}: {
  dbData: any[];
  dateProp: string | null;
  endProp: string | null;
  timelineWindow: TimelineWindow;
  setTimelineWindow: React.Dispatch<React.SetStateAction<TimelineWindow>>;
  /** Column whose value decides the bar colour (S21) — null keeps the accent. */
  colorProp: string | null;
  /** The view's column definitions — for the colour column's curated options. */
  columns: Record<string, any>;
  /** Properties enabled in the config panel — shown on the row (P4-Nachtrag). */
  visibleColumns: string[];
  cells: BaseCells;
  onOpenNote?: (path: string, ev?: React.MouseEvent) => void;
  /** Dropping a row on the split zone opens it in the neighboring pane (P5). */
  onDropToSplit?: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { handleCellSave, formatValueForDisplay } = cells;
  const locale = i18n.language || "de";

  const days = React.useMemo(() => windowDays(timelineWindow), [timelineWindow]);
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  // Wider scales trade detail for reach; the column width is what makes a
  // quarter fit at all.
  const dayWidth = timelineWindow.scale === "quarter" ? 22 : timelineWindow.scale === "threeWeeks" ? 56 : 120;

  // Name, start and end are already visible on the row — the extra lines show
  // the remaining enabled properties, skipping empty values.
  const entryColumns = visibleColumns.filter((c) => c !== "file.name" && c !== dateProp && c !== endProp);

  // ── Dragging an edge, or the whole bar ────────────────────────────────────
  // Pointer-driven (plan W6 — HTML5 DnD is swallowed by Tauri). The preview is
  // local state so the bar follows the finger; the write happens once, on
  // release, and only when something actually changed.
  const [drag, setDrag] = React.useState<{
    path: string;
    mode: "start" | "end" | "move";
    /** Column under the pointer right now. */
    col: number;
    /** Column the gesture started on — `move` shifts by the difference. */
    fromCol: number;
  } | null>(null);

  /** Which day column the pointer is over — measured against the grid, so the
   * answer stays right when the timeline is scrolled sideways. */
  const colAt = (clientX: number): number => {
    const el = gridRef.current;
    if (!el) return 0;
    const x = clientX - el.getBoundingClientRect().left + el.scrollLeft - NAME_COL;
    return Math.max(0, Math.min(days.length - 1, Math.floor(x / dayWidth)));
  };

  const beginDrag = (path: string, mode: "start" | "end" | "move") => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const col = colAt(e.clientX);
    setDrag({ path, mode, col, fromCol: col });
  };

  const dragRef = React.useRef(drag);
  React.useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  const endDrag = async () => {
    const d = dragRef.current;
    setDrag(null);
    if (!d || !dateProp) return;
    const row = dbData.find((r) => r["file.path"] === d.path);
    const toDay = days[d.col];
    if (!row || !toDay) return;
    const opts = { currentStart: row[dateProp], currentEnd: endProp ? row[endProp] : undefined, hasEnd: !!endProp };
    const res =
      d.mode === "move"
        ? moveBar({ ...opts, toDay: days[Math.max(0, Math.min(days.length - 1, (barFor(opts.currentStart, opts.currentEnd, days)?.startCol ?? 0) + (d.col - d.fromCol)))]! })
        : edgeDrag({ ...opts, edge: d.mode, toDay });
    if (res.start !== undefined) await handleCellSave(d.path, dateProp, res.start);
    if (res.end !== undefined && endProp) await handleCellSave(d.path, endProp, res.end);
  };

  // The gesture is followed on the WINDOW, not on the grid: pointer capture on
  // the handle would send every further event to the handle itself, and a
  // pointer that leaves the row mid-drag would otherwise simply stop being
  // heard. Same reason `useCardPointerDrag` does it this way.
  React.useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const col = colAt(e.clientX);
      setDrag((d) => (d && col !== d.col ? { ...d, col } : d));
    };
    const up = () => void endDrag();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.path, drag?.mode, drag?.fromCol, days, dayWidth]);

  /** The bar as it should look RIGHT NOW, drag included. */
  const previewBar = (row: any) => {
    const bar = barFor(row[dateProp!], endProp ? row[endProp] : undefined, days);
    if (!bar || !drag || drag.path !== row["file.path"]) return bar;
    if (drag.mode === "end") return { ...bar, endCol: Math.max(bar.startCol, drag.col), clippedEnd: false };
    if (drag.mode === "start") return { ...bar, startCol: Math.min(bar.endCol, drag.col), clippedStart: false };
    const shift = drag.col - drag.fromCol;
    const width = bar.endCol - bar.startCol;
    const startCol = Math.max(0, Math.min(days.length - 1 - width, bar.startCol + shift));
    return { ...bar, startCol, endCol: startCol + width };
  };

  // ── Colour by property (S21) ──────────────────────────────────────────────
  // The same palette the board and the chips use, so one value has one colour
  // everywhere. Without a colour column every bar keeps the accent.
  const colorOptions: any[] = React.useMemo(
    () => (colorProp && Array.isArray(columns?.[colorProp]?.options) ? columns[colorProp].options : []),
    [columns, colorProp]
  );
  const barTone = (row: any): { bg: string; fg: string } => {
    if (!colorProp) return { bg: "var(--accent-container)", fg: "var(--on-accent-container)" };
    const raw = row[colorProp] ?? row[colorProp?.replace(/^note\./, "") ?? ""];
    const value = Array.isArray(raw) ? String(raw[0] ?? "") : String(raw ?? "");
    if (!value) return { bg: "var(--surface-container)", fg: "var(--text-muted)" };
    const opt = colorOptions.find((o) => o?.value === value || (o?.label || String(o)) === value);
    const idx = chipPaletteIndex(value, opt?.color);
    return { bg: `var(--chip-${idx}-bg)`, fg: `var(--chip-${idx}-fg)` };
  };

  const rows = React.useMemo(() => {
    if (!dateProp) return [];
    return dbData
      .filter((r) => dayPartOf(r[dateProp]))
      .sort((a, b) =>
        compareRows(
          { start: a[dateProp], end: endProp ? a[endProp] : undefined, name: String(a["file.name"] ?? "") },
          { start: b[dateProp], end: endProp ? b[endProp] : undefined, name: String(b["file.name"] ?? "") }
        )
      );
  }, [dbData, dateProp, endProp]);

  // ── Dependencies (S9) ─────────────────────────────────────────────────────
  // Only finish-to-start is drawn and checked. A successor that begins before
  // its predecessor is finished is MARKED, never corrected: the dates are the
  // user's statement about the world, and silently moving one would rewrite a
  // note nobody asked to change.
  const depNodes: DependencyNode[] = React.useMemo(() => {
    const titleToKey = new Map<string, string>();
    for (const r of rows) {
      const path = String(r["file.path"] ?? "");
      titleToKey.set(String(r["file.name"] ?? ""), path);
      titleToKey.set(path, path);
      titleToKey.set(path.replace(/\.md$/i, ""), path);
    }
    const resolve = (uid: string): string | null => {
      const inner = uid.trim().replace(/^\[\[/, "").replace(/\]\]$/, "").split("|")[0]!.trim();
      return titleToKey.get(inner) ?? titleToKey.get(inner.replace(/\.md$/i, "")) ?? null;
    };
    return rows.map((r) => ({
      key: String(r["file.path"] ?? ""),
      blockedBy: parseDependencies(r["blockedBy"] ?? r["note.blockedBy"]).flatMap((d) => {
        const key = resolve(d.uid);
        // A predecessor outside this view simply has no line to draw.
        return key ? [{ key, reltype: d.reltype, gap: d.gap }] : [];
      }),
    }));
  }, [rows]);

  const conflicts = React.useMemo(() => {
    const dates = new Map(
      rows.map((r) => [
        String(r["file.path"] ?? ""),
        { start: dayPartOf(r[dateProp!]) || undefined, end: endProp ? dayPartOf(r[endProp]) || undefined : undefined },
      ])
    );
    return new Set(findScheduleConflicts(depNodes, dates).map((c) => `${c.key}\n${c.predecessor}`));
  }, [depNodes, rows, dateProp, endProp]);

  const rowIndexByPath = React.useMemo(
    () => new Map(rows.map((r, i) => [String(r["file.path"] ?? ""), i])),
    [rows]
  );

  // Geometry of the links, in the same pixel space as the ROWS — which is why
  // the overlay lives inside the rows container and the vertical centres are
  // MEASURED rather than derived from a constant. A row is at least 38px tall
  // but grows with the entry columns under the name, and the day header above
  // is one line in the quarter scale and two everywhere else. Both were assumed
  // in the first draft, and the arrow landed a row too high (found in the final
  // review of this plan, not by a test — the assertion only counted arrows).
  const rowsRef = React.useRef<HTMLDivElement | null>(null);
  const [rowCentres, setRowCentres] = React.useState<number[]>([]);
  React.useLayoutEffect(() => {
    const host = rowsRef.current;
    if (!host) return;
    const measure = () => {
      // Only the rows — the overlay itself is a child of this container too,
      // and counting it would shift every index by one.
      const kids = Array.from(host.querySelectorAll<HTMLElement>(':scope > [data-testid="base-row"]'));
      const next = kids.map((el) => el.offsetTop + el.offsetHeight / 2);
      // Setting unconditionally would loop: the observer fires on the layout
      // that the state change causes.
      setRowCentres((prev) => (prev.length === next.length && prev.every((v, i) => v === next[i]) ? prev : next));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    return () => ro.disconnect();
  }, [rows, dayWidth, days.length, entryColumns]);

  const depLinks = React.useMemo(() => {
    const out: { key: string; d: string; conflict: boolean }[] = [];
    for (const node of depNodes) {
      const toIdx = rowIndexByPath.get(node.key);
      if (toIdx === undefined) continue;
      const toRow = rows[toIdx]!;
      const toBar = barFor(toRow[dateProp!], endProp ? toRow[endProp] : undefined, days);
      if (!toBar) continue;
      for (const dep of node.blockedBy) {
        if (dep.reltype !== "FINISHTOSTART") continue;
        const fromIdx = rowIndexByPath.get(dep.key);
        if (fromIdx === undefined) continue;
        const fromRow = rows[fromIdx]!;
        const fromBar = barFor(fromRow[dateProp!], endProp ? fromRow[endProp] : undefined, days);
        if (!fromBar) continue;
        const y1 = rowCentres[fromIdx];
        const y2 = rowCentres[toIdx];
        // Before the first measurement there is nothing to draw over.
        if (y1 === undefined || y2 === undefined) continue;
        const x1 = NAME_COL + (fromBar.endCol + 1) * dayWidth;
        const x2 = NAME_COL + toBar.startCol * dayWidth;
        const mid = Math.max(x1 + 8, x2 - 8);
        out.push({
          key: `${dep.key}->${node.key}`,
          d: `M ${x1} ${y1} H ${mid} V ${y2} H ${x2}`,
          conflict: conflicts.has(`${node.key}\n${dep.key}`),
        });
      }
    }
    return out;
  }, [depNodes, rowIndexByPath, rows, dateProp, endProp, days, dayWidth, conflicts, rowCentres]);

  const todayKey = dayKey(new Date());
  const todayCol = days.indexOf(todayKey);
  const rangeLabel =
    days.length === 0
      ? ""
      : `${new Date(`${days[0]}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${new Date(`${days[days.length - 1]}T00:00:00`).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`;


  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {!dateProp ? (
        <div style={{ padding: "1rem", color: "var(--text-muted)" }}>{t("database.noDateField", "Kein Datumsfeld konfiguriert. Bitte oben ein Feld wählen.")}</div>
      ) : (
        <>
          <div className="base-period-toolbar">
            <button onClick={() => setTimelineWindow((w) => stepWindow(w, -1))} className="base-nav-btn" aria-label={t("database.prevPeriod", "Zurück")} data-tip={t("database.prevPeriod", "Zurück")}><ChevronLeft size={ICON.ui} /></button>
            <span style={{ fontWeight: 600, minWidth: 170, textAlign: "center" }}>{rangeLabel}</span>
            <button onClick={() => setTimelineWindow((w) => stepWindow(w, 1))} className="base-nav-btn" aria-label={t("database.nextPeriod", "Weiter")} data-tip={t("database.nextPeriod", "Weiter")}><ChevronRight size={ICON.ui} /></button>
            <button onClick={() => setTimelineWindow((w) => windowAround(todayKey, w.scale))} className="base-today-btn">{t("database.today", "Heute")}</button>
            <Segmented
              value={timelineWindow.scale}
              onChange={(v) => setTimelineWindow((w) => windowAround(w.from, v as TimelineScale))}
              options={[
                { value: "week", label: t("database.scaleWeek"), testId: "tl-scale-week" },
                { value: "threeWeeks", label: t("database.scaleThreeWeeks"), testId: "tl-scale-3w" },
                { value: "quarter", label: t("database.scaleQuarter"), testId: "tl-scale-quarter" },
              ]}
            />
          </div>
          <div
            ref={gridRef}
            className="custom-scrollbar"
            style={{ overflow: "auto", flex: 1, position: "relative" }}
          >
            <div style={{ minWidth: NAME_COL + days.length * dayWidth, position: "relative" }}>
              {/* Day header */}
              <div className="base-tl-head" style={{ display: "grid", gridTemplateColumns: `${NAME_COL}px repeat(${days.length}, ${dayWidth}px)`, background: "var(--bg-secondary)", borderBottom: "1px solid var(--border-color)" }}>
                <div style={{ padding: "0.4rem 0.6rem", fontSize: "var(--text-xs)", color: "var(--text-muted)", fontWeight: 600 }}>{t("database.entry", { defaultValue: "Eintrag" })}</div>
                {days.map((key) => {
                  const d = new Date(`${key}T00:00:00`);
                  const weekend = d.getDay() === 0 || d.getDay() === 6;
                  return (
                    <div key={key} data-testid={`tl-day-${key}`} style={{ padding: "0.3rem 0.2rem", textAlign: "center", fontSize: "var(--text-xs)", color: key === todayKey ? "var(--accent-color)" : "var(--text-muted)", fontWeight: key === todayKey ? 700 : 400, background: weekend ? "var(--surface-container-low)" : "transparent" }}>
                      {timelineWindow.scale === "quarter" ? (
                        d.getDate() === 1 || days[0] === key ? d.toLocaleDateString(locale, { month: "short" }) : d.getDate() % 7 === 1 ? String(d.getDate()) : ""
                      ) : (
                        <>
                          <div style={{ textTransform: "uppercase", opacity: 0.7 }}>{d.toLocaleDateString(locale, { weekday: "short" })}</div>
                          <div>{d.getDate()}</div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Today line — a thin rule the whole height, not a coloured cell:
                  it must read as "now" across every row at once. */}
              {todayCol >= 0 && (
                <div
                  data-testid="tl-today-line"
                  aria-hidden
                  className="base-tl-today"
                  style={{ left: NAME_COL + todayCol * dayWidth + dayWidth / 2, width: 2, background: "var(--accent-color)", opacity: 0.5 }}
                />
              )}

              <div ref={rowsRef} style={{ position: "relative" }}>
              {/* Dependency links. Drawn as one overlay rather than per row so a
                  line can cross rows; conflicts are red, everything else is a
                  quiet rule — a dependency is context, not an alarm. */}
              {depLinks.length > 0 && (
                <svg
                  data-testid="tl-deps"
                  aria-hidden
                  style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", overflow: "visible" }}
                >
                  {depLinks.map((l) => (
                    <path
                      key={l.key}
                      data-testid={l.conflict ? "tl-dep-conflict" : "tl-dep"}
                      d={l.d}
                      fill="none"
                      stroke={l.conflict ? "var(--error-text)" : "var(--text-faint)"}
                      strokeWidth={l.conflict ? 2 : 1.5}
                      markerEnd={l.conflict ? "url(#pv-tl-arrow-warn)" : "url(#pv-tl-arrow)"}
                    />
                  ))}
                  <defs>
                    <marker id="pv-tl-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="var(--text-faint)" />
                    </marker>
                    <marker id="pv-tl-arrow-warn" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                      <path d="M0,0 L6,3 L0,6 Z" fill="var(--error-text)" />
                    </marker>
                  </defs>
                </svg>
              )}

              {rows.map((row) => {
                const bar = previewBar(row);
                const milestone = isMilestone(row[dateProp!], endProp ? row[endProp] : undefined);
                const path = String(row["file.path"] ?? "");
                const tone = barTone(row);
                const dragging = drag?.path === path;
                return (
                  <div key={path} data-testid="base-row" style={{ display: "grid", gridTemplateColumns: `${NAME_COL}px repeat(${days.length}, ${dayWidth}px)`, borderBottom: "1px solid var(--border-color-light)", alignItems: "center", minHeight: 38 }}>
                    <div
                      onClick={(e) => onOpenNote?.(path, e)}
                      onContextMenu={(e) => cells.onRowContextMenu?.(path, e)}
                      data-tip={row["file.name"]}
                      className="base-tl-name"
                      style={{ padding: "0.35rem 0.6rem", fontSize: "var(--text-sm)", cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", background: "var(--bg-primary)" }}
                    >
                      <div style={{ fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis" }}>{row["file.name"]}</div>
                      {entryColumns.map((col) => {
                        let v = row[col];
                        if (v === undefined && col.startsWith("note.")) v = row[col.substring(5)];
                        const { displayVal, isMissing } = formatValueForDisplay(v, col);
                        if (isMissing) return null;
                        return (
                          <div key={col} style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {displayVal}
                          </div>
                        );
                      })}
                    </div>
                    {bar && milestone ? (
                      // A moment, not a span: a diamond on its day. It carries
                      // no edge handles because there is no end to drag.
                      <div
                        data-testid="tl-milestone"
                        data-path={path}
                        onPointerDown={beginDrag(path, "move")}
                        onClick={(e) => { if (!dragging) onOpenNote?.(path, e); }}
                        onContextMenu={(e) => cells.onRowContextMenu?.(path, e)}
                        data-tip={row["file.name"]}
                        style={{
                          gridColumn: `${bar.startCol + 2} / ${bar.startCol + 3}`,
                          justifySelf: "center",
                          width: 14,
                          height: 14,
                          transform: "rotate(45deg)",
                          background: tone.bg,
                          border: `2px solid ${tone.fg}`,
                          cursor: dragging ? "grabbing" : "grab",
                          touchAction: "none",
                          opacity: dragging ? 0.75 : 1,
                        }}
                      />
                    ) : bar ? (
                      <div
                        data-testid="tl-bar"
                        data-path={path}
                        onPointerDown={beginDrag(path, "move")}
                        onClick={(e) => {
                          if (!dragging) onOpenNote?.(path, e);
                        }}
                        onContextMenu={(e) => cells.onRowContextMenu?.(path, e)}
                        data-tip={row["file.name"]}
                        style={{
                          gridColumn: `${bar.startCol + 2} / ${bar.endCol + 3}`,
                          background: tone.bg,
                          color: tone.fg,
                          height: 22,
                          borderRadius: "var(--radius-sm)",
                          borderTopLeftRadius: bar.clippedStart ? 0 : undefined,
                          borderBottomLeftRadius: bar.clippedStart ? 0 : undefined,
                          borderTopRightRadius: bar.clippedEnd ? 0 : undefined,
                          borderBottomRightRadius: bar.clippedEnd ? 0 : undefined,
                          display: "flex",
                          alignItems: "center",
                          fontSize: "var(--text-xs)",
                          cursor: dragging ? "grabbing" : "grab",
                          touchAction: "none",
                          position: "relative",
                          opacity: dragging ? 0.75 : 1,
                          minWidth: 0,
                        }}
                      >
                        {/* Handles only where the bar really ends — an edge that
                            is merely clipped by the window is not this entry's
                            edge, and offering a grip there would move the wrong
                            end. */}
                        {!bar.clippedStart && (
                          <span
                            data-testid="tl-handle-start"
                            aria-label={t("database.dragStart")}
                            onPointerDown={beginDrag(path, "start")}
                            style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 8, cursor: "ew-resize", borderRadius: "inherit" }}
                          />
                        )}
                        <span style={{ padding: "0 0.5rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", pointerEvents: "none" }}>
                          {bar.clippedStart ? null : row["file.name"]}
                        </span>
                        {!bar.clippedEnd && endProp && (
                          <span
                            data-testid="tl-handle-end"
                            aria-label={t("database.dragEnd")}
                            onPointerDown={beginDrag(path, "end")}
                            style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 8, cursor: "ew-resize", borderRadius: "inherit" }}
                          />
                        )}
                      </div>
                    ) : (
                      <div style={{ gridColumn: `2 / -1`, fontSize: "var(--text-xs)", color: "var(--text-faint)", paddingLeft: "0.5rem" }}>
                        {t("database.outsideWindow", { defaultValue: "Außerhalb des Zeitraums" })}
                      </div>
                    )}
                  </div>
                );
              })}
              </div>
            </div>
          </div>
        </>
      )}
      <SplitDropZone
        active={!!drag && !!onDropToSplit}
        over={false}
        registerTarget={() => {}}
        label={t("database.dropOpenInSplit", "Hier ablegen: im Split öffnen")}
      />
    </div>
  );
}

export { OPEN_SPLIT_TARGET };
