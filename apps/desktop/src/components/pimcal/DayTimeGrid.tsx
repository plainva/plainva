import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckSquare, MapPin, Repeat, Square } from "lucide-react";
import { layoutDayEvents, minutesInDay, snapMinutes, pxToMinutes, minutesToPx, minutesToHHMM } from "@plainva/ui";
import type { PimEventRow } from "@plainva/core";
import { localIsoKey } from "../../services/dailyNotePath";
import { formatTimeRange } from "../../services/pim/calendarModel";
import type { DueTask } from "../../services/pim/taskOverlay";

/**
 * A Google-Calendar-style time grid for 1..7 day columns sharing one hour
 * gutter (feedback round 3). Timed events are positioned by start/duration and
 * fanned into lanes when they overlap; all-day events and due tasks sit in a
 * strip above the grid. Clicking an empty slot creates a 30-min event; dragging
 * sets the duration. Layout math is the shared @plainva/ui time-grid helpers.
 */

const PX_PER_HOUR = 44;
const DAY_HEIGHT = 24 * PX_PER_HOUR;
const MIN_BLOCK_PX = 16;
const DRAG_THRESHOLD_PX = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface DayTimeGridProps {
  days: Date[];
  byDay: Map<string, PimEventRow[]>;
  tasksByDay?: Map<string, DueTask[]>;
  colorOf: (e: PimEventRow) => string;
  calName: (e: PimEventRow) => string;
  todayKey: string;
  locale: string;
  /** Whether new events can be created (a writable calendar exists). */
  canCreate: boolean;
  onEventClick: (e: PimEventRow) => void;
  onOpenTask?: (path: string) => void;
  /** Click/drag on an empty slot → create. Minutes are snapped day-minutes;
   * `anchor` is the pointer position for the quick-create popover. */
  onCreateSlot: (dayKey: string, startMin: number, endMin: number, anchor: { x: number; y: number }) => void;
  /** Show the weekday header row above each column (week/3-day); the month day
   * pane passes its own header outside and hides this. */
  showColumnHeaders: boolean;
}

interface DragState {
  dayKey: string;
  col: number;
  pointerId: number;
  y0: number;
  y1: number;
  moved: boolean;
}

export function DayTimeGrid(props: DayTimeGridProps) {
  const { days, byDay, tasksByDay, colorOf, calName, todayKey, locale, canCreate, onEventClick, onOpenTask, onCreateSlot, showColumnHeaders } = props;
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const laneRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [nowMin, setNowMin] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  // Keep the "now" line current (minute granularity is plenty).
  useEffect(() => {
    const id = window.setInterval(() => {
      const n = new Date();
      setNowMin(n.getHours() * 60 + n.getMinutes());
    }, 60000);
    return () => window.clearInterval(id);
  }, []);

  // Auto-scroll near the current hour (or 7:00) once, when the day set changes.
  const dayKeys = useMemo(() => days.map(localIsoKey), [days]);
  const scrollKey = dayKeys.join("|");
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const focusHour = dayKeys.includes(todayKey) ? Math.max(0, new Date().getHours() - 1) : 7;
    el.scrollTop = focusHour * PX_PER_HOUR;
    // Only re-run when the visible days change, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollKey]);

  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => h), []);

  // Timed blocks per day, clamped to the day and laid out into lanes.
  const perDay = useMemo(() => {
    return days.map((day) => {
      const dayStartMs = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
      const dayEndMs = dayStartMs + DAY_MS;
      const key = localIsoKey(day);
      const all = byDay.get(key) ?? [];
      const allDay = all.filter((e) => e.allDay);
      const timed = all.filter((e) => !e.allDay);
      const clamped = timed.map((e) => ({
        ev: e,
        startMs: Math.max(e.start.ts, dayStartMs),
        endMs: Math.min(Math.max(e.end.ts, e.start.ts + 1), dayEndMs),
      }));
      const laid = layoutDayEvents(clamped, (c) => `${c.ev.accountId}-${c.ev.calendarId}-${c.ev.uid}-${c.ev.start.ts}`);
      const blocks = laid.map((l) => {
        const startMin = minutesInDay(l.event.startMs, dayStartMs);
        const endMin = Math.max(startMin + 1, minutesInDay(l.event.endMs, dayStartMs));
        return { ev: l.event.ev, startMin, endMin, lane: l.lane, lanes: l.lanes };
      });
      return { key, dayStartMs, allDay, blocks, tasks: tasksByDay?.get(key) ?? [] };
    });
  }, [days, byDay, tasksByDay]);

  const hasAllDayRow = perDay.some((d) => d.allDay.length > 0 || d.tasks.length > 0);

  // Pointer capture on the column keeps drag robust (move/up land on the same
  // element even outside its bounds) and free of the state/effect race a window
  // listener would have — so a plain click reliably fires create.
  const relY = (col: number, clientY: number) => {
    const lane = laneRefs.current[col];
    if (!lane) return 0;
    return Math.max(0, Math.min(DAY_HEIGHT, clientY - lane.getBoundingClientRect().top));
  };
  const onColDown = (col: number, dayKey: string, e: React.PointerEvent) => {
    if (!canCreate || e.button !== 0) return;
    laneRefs.current[col]?.setPointerCapture(e.pointerId);
    const y = relY(col, e.clientY);
    setDrag({ dayKey, col, pointerId: e.pointerId, y0: y, y1: y, moved: false });
  };
  const onColMove = (col: number, e: React.PointerEvent) => {
    setDrag((d) => {
      if (!d || d.col !== col || d.pointerId !== e.pointerId) return d;
      const y = relY(col, e.clientY);
      return { ...d, y1: y, moved: d.moved || Math.abs(y - d.y0) > DRAG_THRESHOLD_PX };
    });
  };
  const onColUp = (col: number, e: React.PointerEvent) => {
    laneRefs.current[col]?.releasePointerCapture?.(e.pointerId);
    // Read the current drag from state (not inside the updater) so onCreateSlot
    // — which sets CalendarView state — never runs during React's render phase.
    const d = drag;
    setDrag(null);
    if (d && d.col === col && d.pointerId === e.pointerId) {
      const top = Math.min(d.y0, d.y1);
      const bottom = Math.max(d.y0, d.y1);
      const startMin = snapMinutes(pxToMinutes(top, PX_PER_HOUR));
      let endMin = d.moved ? snapMinutes(pxToMinutes(bottom, PX_PER_HOUR)) : startMin + 30;
      if (endMin <= startMin) endMin = startMin + (d.moved ? 15 : 30);
      onCreateSlot(d.dayKey, startMin, Math.min(24 * 60, endMin), { x: e.clientX, y: e.clientY });
    }
  };

  const gutterWidth = 52;

  return (
    <div data-testid="calendar-timegrid" style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Column headers (week / 3-day) */}
      {showColumnHeaders && (
        <div style={{ display: "flex", flexShrink: 0, borderBottom: "1px solid var(--border-color-light)" }}>
          <div style={{ width: gutterWidth, flexShrink: 0 }} />
          {days.map((day) => {
            const key = localIsoKey(day);
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                style={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: "center",
                  padding: "6px 2px",
                  fontSize: "var(--text-xs)",
                  fontWeight: isToday ? 700 : 500,
                  color: isToday ? "var(--accent-color)" : "var(--text-muted)",
                  borderLeft: "1px solid var(--border-color-light)",
                }}
              >
                {new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric" }).format(day)}
              </div>
            );
          })}
        </div>
      )}

      {/* All-day / due-tasks strip */}
      {hasAllDayRow && (
        <div data-testid="calendar-allday-strip" style={{ display: "flex", flexShrink: 0, borderBottom: "1px solid var(--border-color-light)", background: "var(--bg-secondary)", maxHeight: 84, overflow: "auto" }}>
          <div style={{ width: gutterWidth, flexShrink: 0, fontSize: 10, color: "var(--text-faint)", textAlign: "right", padding: "4px 6px 0 0", textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {t("pim.allDay", { defaultValue: "Ganztägig" })}
          </div>
          {perDay.map((d) => (
            <div key={d.key} style={{ flex: 1, minWidth: 0, borderLeft: "1px solid var(--border-color-light)", padding: 3, display: "flex", flexDirection: "column", gap: 2 }}>
              {d.allDay.map((e) => (
                <button
                  key={`${e.accountId}-${e.calendarId}-${e.uid}`}
                  type="button"
                  onClick={() => onEventClick(e)}
                  data-testid="calendar-allday-event"
                  title={`${e.title}${calName(e) ? ` · ${calName(e)}` : ""}`}
                  style={{ display: "block", textAlign: "left", border: "none", borderRadius: "var(--radius-xs)", padding: "2px 6px", cursor: "pointer", background: colorOf(e), color: "var(--accent-on)", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {e.title}
                </button>
              ))}
              {d.tasks.map((task) => (
                <button
                  key={`task-${task.path}`}
                  type="button"
                  onClick={() => onOpenTask?.(task.path)}
                  data-testid="calendar-task"
                  style={{ display: "flex", alignItems: "center", gap: 4, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", padding: "1px 2px", fontSize: 11, color: task.done ? "var(--text-muted)" : "var(--text-main)", minWidth: 0 }}
                >
                  {task.done ? <CheckSquare size={11} style={{ flexShrink: 0, color: "var(--accent-color)" }} /> : <Square size={11} style={{ flexShrink: 0, color: "var(--text-muted)" }} />}
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: task.done ? "line-through" : "none" }}>{task.title}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      {/* Scrollable hour grid */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: "auto", position: "relative" }}>
        <div style={{ display: "flex", position: "relative", height: DAY_HEIGHT }}>
          {/* Hour gutter */}
          <div style={{ width: gutterWidth, flexShrink: 0, position: "relative" }}>
            {hours.map((h) => (
              <div key={h} style={{ position: "absolute", top: h * PX_PER_HOUR, right: 6, transform: "translateY(-50%)", fontSize: 10, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
                {h > 0 ? minutesToHHMM(h * 60) : ""}
              </div>
            ))}
          </div>

          {/* Day columns */}
          {perDay.map((d, col) => {
            const isToday = d.key === todayKey;
            return (
              <div
                key={d.key}
                ref={(el) => { laneRefs.current[col] = el; }}
                data-testid={`calendar-timecol-${d.key}`}
                onPointerDown={(e) => onColDown(col, d.key, e)}
                onPointerMove={(e) => onColMove(col, e)}
                onPointerUp={(e) => onColUp(col, e)}
                style={{ flex: 1, minWidth: 0, position: "relative", borderLeft: "1px solid var(--border-color-light)", cursor: canCreate ? "cell" : "default", touchAction: "none" }}
              >
                {/* Hour lines */}
                {hours.map((h) => (
                  <div key={h} style={{ position: "absolute", left: 0, right: 0, top: h * PX_PER_HOUR, borderTop: "1px solid var(--border-color-light)", opacity: 0.6 }} />
                ))}

                {/* Drag selection preview */}
                {drag && drag.col === col && (() => {
                  const top = Math.min(drag.y0, drag.y1);
                  const height = Math.max(MIN_BLOCK_PX, Math.abs(drag.y1 - drag.y0));
                  const s = snapMinutes(pxToMinutes(top, PX_PER_HOUR));
                  const e = drag.moved ? snapMinutes(pxToMinutes(top + height, PX_PER_HOUR)) : s + 30;
                  return (
                    <div style={{ position: "absolute", left: 2, right: 2, top, height, background: "var(--accent-soft)", border: "1.5px dashed var(--accent-color)", borderRadius: "var(--radius-xs)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--accent-color)", fontWeight: 600, pointerEvents: "none", zIndex: 4 }}>
                      {minutesToHHMM(s)}–{minutesToHHMM(e)}
                    </div>
                  );
                })()}

                {/* Timed event blocks */}
                {d.blocks.map((b) => {
                  const top = minutesToPx(b.startMin, PX_PER_HOUR);
                  const height = Math.max(MIN_BLOCK_PX, minutesToPx(b.endMin - b.startMin, PX_PER_HOUR));
                  const widthPct = 100 / b.lanes;
                  const leftPct = b.lane * widthPct;
                  return (
                    <button
                      key={`${b.ev.accountId}-${b.ev.calendarId}-${b.ev.uid}-${b.ev.start.ts}`}
                      type="button"
                      data-testid="calendar-timed-event"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); onEventClick(b.ev); }}
                      title={`${b.ev.title}${calName(b.ev) ? ` · ${calName(b.ev)}` : ""}`}
                      style={{
                        position: "absolute",
                        top,
                        height,
                        left: `calc(${leftPct}% + 2px)`,
                        width: `calc(${widthPct}% - 4px)`,
                        border: "none",
                        borderLeft: `3px solid var(--accent-on)`,
                        borderRadius: "var(--radius-xs)",
                        background: colorOf(b.ev),
                        color: "var(--accent-on)",
                        textAlign: "left",
                        padding: "2px 5px",
                        overflow: "hidden",
                        cursor: "pointer",
                        display: "flex",
                        flexDirection: "column",
                        gap: 1,
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {b.ev.seriesMaster ? <Repeat size={9} style={{ flexShrink: 0 }} /> : null}
                        {b.ev.title}
                      </span>
                      {height > 30 && <span style={{ fontSize: 10, opacity: 0.9 }}>{formatTimeRange(b.ev, locale)}</span>}
                      {height > 48 && b.ev.location ? (
                        <span style={{ display: "flex", alignItems: "center", gap: 2, fontSize: 10, opacity: 0.85, overflow: "hidden" }}>
                          <MapPin size={9} style={{ flexShrink: 0 }} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.ev.location}</span>
                        </span>
                      ) : null}
                    </button>
                  );
                })}

                {/* Now line (today only) */}
                {isToday && (
                  <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: minutesToPx(nowMin, PX_PER_HOUR), height: 0, borderTop: "2px solid var(--error-text)", zIndex: 5 }}>
                    <span style={{ position: "absolute", left: -3, top: -4, width: 7, height: 7, borderRadius: "var(--radius-pill)", background: "var(--error-text)" }} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
