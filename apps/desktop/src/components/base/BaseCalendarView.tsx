import {
  ICON,
  IconButton,
  Segmented,
  compareByTime,
  entryDayKeys,
  getWeekStartSetting,
  layoutSpanningEvents,
  rangeRows,
  stepCursor,
  timeLabel,
  weekStartDayOf,
  WEEK_START_CHANGED_EVENT,
  type CalendarCursor,
  type WeekStartDay,
} from "@plainva/ui";
import React from "react";
import { useTranslation } from "react-i18next";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import { useVault } from "../../contexts/VaultContext";
import { loadEventBackdrop, type BackdropDay } from "../../services/pim/eventBackdrop";
import { useCardPointerDrag } from "./useCardPointerDrag";
import { DragGhost, OPEN_SPLIT_TARGET, SplitDropZone } from "./baseViewerShared";
import type { BaseCells } from "./useBaseCells";

// Calendar view of the BaseViewer (structural split, plan C3; three periods
// since S20). The cursor lives in the BaseViewer so switching views does not
// reset the browsing position; dragging a note onto a day (pointer-driven, plan
// W6 — HTML5 DnD is swallowed by Tauri) writes the date into its frontmatter.
export function BaseCalendarView({
  dbData,
  dateProp,
  endProp,
  cursor,
  setCursor,
  visibleColumns,
  cells,
  onOpenNote,
  onDropToSplit,
}: {
  dbData: any[];
  dateProp: string | null;
  /** The view's end column — an entry that has one spans (S20). */
  endProp: string | null;
  cursor: CalendarCursor;
  setCursor: React.Dispatch<React.SetStateAction<CalendarCursor>>;
  /** Properties enabled in the config panel — shown on each entry (P4). */
  visibleColumns: string[];
  cells: BaseCells;
  onOpenNote?: (path: string, ev?: React.MouseEvent) => void;
  /** Dropping an entry on the split zone opens it in the neighboring pane (P5). */
  onDropToSplit?: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { handleCellSave, formatValueForDisplay } = cells;
  const { pimRuntime } = useVault();

  // The same week-start setting the real calendar honours — a vault set to
  // Sunday must not get a Monday week inside its databases.
  const [weekStartDay, setWeekStartDay] = React.useState<WeekStartDay>(1);
  React.useEffect(() => {
    let alive = true;
    const read = () => {
      void getWeekStartSetting()
        .then((v) => {
          if (alive) setWeekStartDay(weekStartDayOf(v));
        })
        .catch(() => {});
    };
    read();
    window.addEventListener(WEEK_START_CHANGED_EVENT, read);
    return () => {
      alive = false;
      window.removeEventListener(WEEK_START_CHANGED_EVENT, read);
    };
  }, []);

  const rows = React.useMemo(() => rangeRows(cursor, weekStartDay), [cursor, weekStartDay]);
  const anchorDate = React.useMemo(() => new Date(`${cursor.day}T00:00:00`), [cursor.day]);

  // Real appointments as a BACKDROP (S18, plan P9a — the other direction):
  // planning inside a database is easier when one can see what the day already
  // holds. Off by default and device-local: it is a way of looking, not part of
  // the view's configuration, and it must never be mistaken for its rows.
  const [showEvents, setShowEvents] = React.useState(false);
  const [backdrop, setBackdrop] = React.useState<Map<string, BackdropDay>>(new Map());
  React.useEffect(() => {
    let alive = true;
    if (!showEvents || !pimRuntime) {
      setBackdrop(new Map());
      return;
    }
    void loadEventBackdrop(pimRuntime, anchorDate.getFullYear(), anchorDate.getMonth())
      .then((m) => {
        if (alive) setBackdrop(m);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [showEvents, pimRuntime, anchorDate]);

  // The entry title and the day cell already communicate name and date — the
  // extra lines show the remaining enabled properties, skipping empty values
  // to keep the small day cells readable (P4).
  const entryColumns = visibleColumns.filter((c) => c !== "file.name" && c !== dateProp && c !== endProp);

  const { cardHandlers, registerTarget, draggingPath, overTarget, ghostProps } = useCardPointerDrag<string>({
    onDrop: (path, dateStr) => {
      if (dateStr === OPEN_SPLIT_TARGET) { onDropToSplit?.(path); return; }
      if (dateProp) void handleCellSave(path, dateProp, dateStr);
    },
  });
  const draggedRow = draggingPath ? dbData.find((r) => r["file.path"] === draggingPath) : null;

  const today = new Date();
  const locale = i18n.language || "de";
  // 2024-01-01 was a Monday: offsetting by the week-start day names the columns right.
  const weekdays = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 1 + ((i + weekStartDay - 1 + 7) % 7)).toLocaleDateString(locale, { weekday: "short" }));
  const isToday = (key: string) => key === `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const periodLabel =
    cursor.range === "month"
      ? anchorDate.toLocaleDateString(locale, { month: "long", year: "numeric" })
      : cursor.range === "day"
        ? anchorDate.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric" })
        : (() => {
            const first = rows[0]?.[0];
            const last = rows[0]?.[6];
            if (!first || !last) return "";
            const f = new Date(`${first}T00:00:00`);
            const l = new Date(`${last}T00:00:00`);
            return `${f.toLocaleDateString(locale, { day: "numeric", month: "short" })} – ${l.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}`;
          })();

  // Which entry sits on which day — computed once per data change, not per cell.
  const byDay = React.useMemo(() => {
    const map = new Map<string, any[]>();
    if (!dateProp) return map;
    for (const row of dbData) {
      for (const key of entryDayKeys(row[dateProp], endProp ? row[endProp] : undefined)) {
        const list = map.get(key);
        if (list) list.push(row);
        else map.set(key, [row]);
      }
    }
    for (const list of map.values()) list.sort((a, b) => compareByTime(a[dateProp], b[dateProp]));
    return map;
  }, [dbData, dateProp, endProp]);

  /**
   * A multi-day entry is ONE bar, not a chip on every day it touches — the same
   * helper the real calendar uses for multi-day appointments (S5), so the two
   * surfaces cannot drift apart on where a bar is cut.
   */
  const spansOf = (rowKeys: (string | null)[]) =>
    layoutSpanningEvents(
      rowKeys.filter((k): k is string => !!k),
      dateProp && endProp ? dbData : [],
      {
        keysOf: (row: any) => entryDayKeys(row[dateProp!], row[endProp!]),
        compare: (a: any, b: any) => entryDayKeys(b[dateProp!], b[endProp!]).length - entryDayKeys(a[dateProp!], a[endProp!]).length,
      }
    );


  const entryCard = (row: any, key: string) => {
    const time = dateProp ? timeLabel(row[dateProp]) : "";
    return (
      <div
        key={row["file.path"] || key}
        {...cardHandlers(row["file.path"])}
        data-testid="base-row"
        onContextMenu={(e) => cells.onRowContextMenu?.(row["file.path"], e)}
        onClick={(e) => onOpenNote?.(row["file.path"], e)}
        data-tip={row["file.name"]}
        style={{ background: "var(--bg-secondary)", color: "var(--text-main)", padding: "0.3rem 0.45rem", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)", cursor: "pointer", borderLeft: "2px solid var(--accent-color)", touchAction: "none", opacity: draggingPath === row["file.path"] ? 0.45 : 1 }}
      >
        <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", fontWeight: 500 }}>
          {time && <span style={{ color: "var(--text-muted)", marginRight: "0.35rem", fontVariantNumeric: "tabular-nums" }}>{time}</span>}
          {row["file.name"]}
        </div>
        {entryColumns.map((col) => {
          let v = row[col];
          if (v === undefined && col.startsWith("note.")) v = row[col.substring(5)];
          const { displayVal, isMissing } = formatValueForDisplay(v, col);
          if (isMissing) return null;
          return (
            <div key={col} style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 2 }}>
              {displayVal}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", position: "relative" }}>
      {!dateProp ? (
        <div style={{ padding: "1rem", color: "var(--text-muted)" }}>{t("database.noDateField", "Kein Datumsfeld konfiguriert. Bitte oben ein Feld wählen.")}</div>
      ) : (
        <>
          <div className="base-period-toolbar">
            <button onClick={() => setCursor((c) => stepCursor(c, -1))} className="base-nav-btn" aria-label={t("database.prevPeriod", "Zurück")} data-tip={t("database.prevPeriod", "Zurück")}><ChevronLeft size={ICON.ui} /></button>
            <span style={{ fontWeight: 600, minWidth: 150, textAlign: "center" }}>{periodLabel}</span>
            <button onClick={() => setCursor((c) => stepCursor(c, 1))} className="base-nav-btn" aria-label={t("database.nextPeriod", "Weiter")} data-tip={t("database.nextPeriod", "Weiter")}><ChevronRight size={ICON.ui} /></button>
            <button onClick={() => setCursor((c) => ({ ...c, day: `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}` }))} className="base-today-btn">{t("database.today", "Heute")}</button>
            <Segmented
              value={cursor.range}
              onChange={(v) => setCursor((c) => ({ ...c, range: v as CalendarCursor["range"] }))}
              options={[
                { value: "month", label: t("database.rangeMonth"), testId: "base-range-month" },
                { value: "week", label: t("database.rangeWeek"), testId: "base-range-week" },
                { value: "day", label: t("database.rangeDay"), testId: "base-range-day" },
              ]}
            />
            {pimRuntime && (
              <IconButton
                label={t("database.showEvents", { defaultValue: "Termine im Hintergrund" })}
                aria-pressed={showEvents}
                data-testid="base-toggle-events"
                onClick={() => setShowEvents((v) => !v)}
              >
                <CalendarRange size={ICON.ui} style={{ color: showEvents ? "var(--accent-color)" : undefined }} />
              </IconButton>
            )}
          </div>
          <div className="custom-scrollbar" style={{ overflowY: "auto", flex: 1 }}>
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${cursor.range === "day" ? 1 : 7}, minmax(0, 1fr))`, background: "var(--border-color)", gap: "1px" }}>
              {cursor.range !== "day" &&
                weekdays.map((d, wi) => (
                  <div key={`h${wi}`} style={{ background: "var(--bg-secondary)", padding: "0.5rem", textAlign: "center", fontWeight: 600, fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{d}</div>
                ))}
              {rows.map((rowKeys, ri) => {
                const layout = spansOf(rowKeys);
                return (
                  <React.Fragment key={`r${ri}`}>
                    {/* The span lane sits ABOVE its week and is drawn once, in a
                        grid of its own that shares the columns — a bar that
                        leaves the week is clipped, never repeated. */}
                    {layout.bars.length > 0 && (
                      <div style={{ gridColumn: `1 / -1`, background: "var(--bg-primary)", display: "grid", gridTemplateColumns: `repeat(${cursor.range === "day" ? 1 : 7}, minmax(0, 1fr))`, gap: 2, padding: "0.25rem 0.25rem 0" }}>
                        {layout.bars.map((bar, bi) => (
                          <div
                            key={`b${bi}`}
                            {...cardHandlers((bar.event as any)["file.path"])}
                            data-testid="base-span-bar"
                            onContextMenu={(e) => cells.onRowContextMenu?.((bar.event as any)["file.path"], e)}
                            onClick={(e) => onOpenNote?.((bar.event as any)["file.path"], e)}
                            data-tip={(bar.event as any)["file.name"]}
                            style={{
                              gridColumn: `${bar.startCol + 1} / ${bar.endCol + 2}`,
                              gridRow: bar.lane + 1,
                              background: "var(--accent-container)",
                              color: "var(--on-accent-container)",
                              fontSize: "var(--text-xs)",
                              padding: "0.15rem 0.4rem",
                              borderRadius: "var(--radius-sm)",
                              borderTopLeftRadius: bar.clippedStart ? 0 : undefined,
                              borderBottomLeftRadius: bar.clippedStart ? 0 : undefined,
                              borderTopRightRadius: bar.clippedEnd ? 0 : undefined,
                              borderBottomRightRadius: bar.clippedEnd ? 0 : undefined,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              cursor: "pointer",
                              touchAction: "none",
                            }}
                          >
                            {/* Only the first row of a bar carries the title —
                                repeating it is exactly the chain S5 ended. */}
                            {bar.clippedStart ? " " : (bar.event as any)["file.name"]}
                          </div>
                        ))}
                      </div>
                    )}
                    {rowKeys.map((key, ci) => {
                      if (!key) return <div key={`c${ri}-${ci}`} style={{ background: "var(--bg-primary)", minHeight: 96 }} />;
                      const items = byDay.get(key) ?? [];
                      const bg = showEvents ? backdrop.get(key) : undefined;
                      const dayNum = Number(key.slice(8));
                      return (
                        <div
                          key={`c${ri}-${ci}`}
                          ref={registerTarget(key)}
                          data-testid={`base-day-${key}`}
                          style={{ background: "var(--bg-primary)", padding: "0.4rem", display: "flex", flexDirection: "column", gap: "0.25rem", minHeight: cursor.range === "month" ? 96 : 220, outline: overTarget === key && draggingPath ? "2px solid var(--accent-color)" : "none", outlineOffset: -2 }}
                        >
                          {bg ? (
                            <span className="pv-base-backdrop" data-testid="base-event-backdrop" data-tip={bg.titles.join("\n")}>
                              {t("database.eventsOnDay", { count: bg.count, defaultValue: "{{count}} Termine" })}
                            </span>
                          ) : null}
                          <div style={{ alignSelf: "flex-end", fontSize: "var(--text-sm)", fontWeight: isToday(key) ? 700 : 400, color: isToday(key) ? "var(--accent-on)" : "var(--text-muted)", background: isToday(key) ? "var(--accent-color)" : "transparent", borderRadius: "var(--radius-pill)", minWidth: 20, height: 20, display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "0 5px" }}>{dayNum}</div>
                          {/* An entry drawn as a bar is NOT also rendered here.
                              Hiding it with CSS would leave it in the tree —
                              four times over, for anyone reading the document
                              rather than looking at it. */}
                          {items.filter((row) => !layout.spanned.has(row)).map((row, idx) => entryCard(row, String(idx)))}
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </>
      )}
      {draggedRow && (
        <DragGhost
          setEl={ghostProps.setEl}
          baseStyle={ghostProps.style}
          style={{ maxWidth: 200, background: "var(--bg-secondary)", color: "var(--text-main)", padding: "0.3rem 0.45rem", borderRadius: "var(--radius-sm)", fontSize: "var(--text-sm)", borderLeft: "2px solid var(--accent-color)", boxShadow: "var(--shadow-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
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
