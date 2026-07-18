import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CheckSquare, MapPin, Repeat, Square } from "lucide-react";
import { layoutDayEvents, minutesInDay, snapMinutes, pxToMinutes, minutesToPx, minutesToHHMM, moveEventMinutes, resizeEventEndMinutes } from "@plainva/ui";
import type { PimEventRow } from "@plainva/core";
import { localIsoKey } from "../../services/dailyNotePath";
import { formatTimeRange } from "../../services/pim/calendarModel";
import type { DueTask } from "../../services/pim/taskOverlay";

/**
 * A Google-Calendar-style time grid for 1..7 day columns sharing one hour
 * gutter (feedback round 3). Timed events are positioned by start/duration and
 * fanned into lanes when they overlap; all-day events and due tasks sit in a
 * strip above the grid. Clicking an empty slot creates a 30-min event; dragging
 * sets the duration. An existing event can be dragged to reschedule (body →
 * move, incl. across day columns) or resized (bottom edge → change duration);
 * a tiny drag stays a click and opens the dialog. Layout math is the shared
 * @plainva/ui time-grid helpers.
 */

/** Default hour height before the container is measured; the grid then STRETCHES
 * the 24 hours to fill the pane (responsive) and only scrolls when the window is
 * too short for MIN_PX_PER_HOUR. */
const DEFAULT_PX_PER_HOUR = 44;
const MIN_PX_PER_HOUR = 34;
const MIN_BLOCK_PX = 16;
const DRAG_THRESHOLD_PX = 4;
/** A drag under one snap step (15 min) and without a column change is a click. */
const MOVE_SNAP = 15;
const DAY_MS = 24 * 60 * 60 * 1000;
const RESIZE_HANDLE_PX = 7;

export interface DayTimeGridProps {
  days: Date[];
  byDay: Map<string, PimEventRow[]>;
  tasksByDay?: Map<string, DueTask[]>;
  colorOf: (e: PimEventRow) => string;
  calName: (e: PimEventRow) => string;
  /** Current wall-clock ms; events ending before it render dimmer (past). */
  nowTs: number;
  todayKey: string;
  locale: string;
  /** Whether new events can be created (a writable calendar exists). */
  canCreate: boolean;
  /** Whether THIS event can be dragged/resized (writable calendar, not a
   * series instance) — series stay read-only until the scope editor covers
   * them. Non-editable events are click-only. */
  canEditEvent: (e: PimEventRow) => boolean;
  onEventClick: (e: PimEventRow) => void;
  onOpenTask?: (path: string) => void;
  /** Click/drag on an empty slot → create. Minutes are snapped day-minutes;
   * `anchor` is the pointer position for the quick-create popover. */
  onCreateSlot: (dayKey: string, startMin: number, endMin: number, anchor: { x: number; y: number }) => void;
  /** Drop after dragging an event body — reschedule to absolute ms (duration
   * preserved; the day may change across columns). */
  onEventMove: (e: PimEventRow, newStartMs: number, newEndMs: number) => void;
  /** Drop after dragging an event's bottom edge — new absolute end ms. */
  onEventResize: (e: PimEventRow, newEndMs: number) => void;
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

interface BlockDrag {
  ev: PimEventRow;
  mode: "move" | "resize";
  pointerId: number;
  originCol: number;
  /** Move only: minutes between the event start and the grab point. */
  grabOffsetMin: number;
  /** Move only: preserved duration. */
  durationMin: number;
  /** The event's own start-of-day minutes (resize keeps it). */
  startMin: number;
  curCol: number;
  curStartMin: number;
  curEndMin: number;
  moved: boolean;
}

const eventKey = (e: PimEventRow) => `${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`;

export function DayTimeGrid(props: DayTimeGridProps) {
  const { days, byDay, tasksByDay, colorOf, calName, nowTs, todayKey, locale, canCreate, canEditEvent, onEventClick, onOpenTask, onCreateSlot, onEventMove, onEventResize, showColumnHeaders } = props;
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const laneRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [blockDrag, setBlockDrag] = useState<BlockDrag | null>(null);
  /** Set on a moved event drag so the trailing click does not open the dialog. */
  const suppressClickRef = useRef(false);
  // The 24 hours STRETCH to fill the pane: the hour height tracks the scroll
  // container's measured height (÷24), floored at MIN_PX_PER_HOUR so a short
  // window scrolls instead of squashing beyond legibility.
  const [pxPerHour, setPxPerHour] = useState(DEFAULT_PX_PER_HOUR);
  const dayHeight = 24 * pxPerHour;
  const [nowMin, setNowMin] = useState(() => {
    const n = new Date();
    return n.getHours() * 60 + n.getMinutes();
  });

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const h = el.clientHeight;
      if (h > 0) setPxPerHour(Math.max(MIN_PX_PER_HOUR, h / 24));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

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
    el.scrollTop = focusHour * pxPerHour;
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
      const laid = layoutDayEvents(clamped, (c) => eventKey(c.ev));
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
    return Math.max(0, Math.min(dayHeight, clientY - lane.getBoundingClientRect().top));
  };
  const minAt = (col: number, clientY: number) => pxToMinutes(relY(col, clientY), pxPerHour);
  /** Which day column the pointer's x is over (clamped to the visible range). */
  const colAt = (clientX: number, fallback: number): number => {
    let best = fallback;
    for (let i = 0; i < perDay.length; i++) {
      const el = laneRefs.current[i];
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (clientX >= r.left && clientX <= r.right) return i;
      if (i === 0 && clientX < r.left) best = 0;
      if (i === perDay.length - 1 && clientX > r.right) best = perDay.length - 1;
    }
    return best;
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
      const startMin = snapMinutes(pxToMinutes(top, pxPerHour));
      let endMin = d.moved ? snapMinutes(pxToMinutes(bottom, pxPerHour)) : startMin + 30;
      if (endMin <= startMin) endMin = startMin + (d.moved ? 15 : 30);
      onCreateSlot(d.dayKey, startMin, Math.min(24 * 60, endMin), { x: e.clientX, y: e.clientY });
    }
  };

  // ---- existing-event drag: move (body) / resize (bottom edge) -------------
  const startBlockDrag = (mode: "move" | "resize", col: number, block: { ev: PimEventRow; startMin: number; endMin: number }, e: React.PointerEvent) => {
    e.stopPropagation(); // never let the column start a create-drag
    if (!canEditEvent(block.ev) || e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const pointerMin = minAt(col, e.clientY);
    setBlockDrag({
      ev: block.ev,
      mode,
      pointerId: e.pointerId,
      originCol: col,
      grabOffsetMin: pointerMin - block.startMin,
      durationMin: Math.max(MOVE_SNAP, block.endMin - block.startMin),
      startMin: block.startMin,
      curCol: col,
      curStartMin: block.startMin,
      curEndMin: block.endMin,
      moved: false,
    });
  };
  const onBlockMove = (e: React.PointerEvent) => {
    setBlockDrag((d) => {
      if (!d || d.pointerId !== e.pointerId) return d;
      if (d.mode === "resize") {
        const endMin = resizeEventEndMinutes({ pointerMin: minAt(d.originCol, e.clientY), startMin: d.startMin });
        return { ...d, curEndMin: endMin, moved: d.moved || Math.abs(endMin - (d.startMin + d.durationMin)) >= MOVE_SNAP };
      }
      const col = colAt(e.clientX, d.originCol);
      const { startMin, endMin } = moveEventMinutes({ pointerMin: minAt(col, e.clientY), grabOffsetMin: d.grabOffsetMin, durationMin: d.durationMin });
      const moved = d.moved || col !== d.originCol || Math.abs(startMin - d.startMin) >= MOVE_SNAP;
      return { ...d, curCol: col, curStartMin: startMin, curEndMin: endMin, moved };
    });
  };
  const onBlockUp = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
    const d = blockDrag;
    setBlockDrag(null);
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.moved) return; // a tiny drag stays a click → onClick opens the dialog
    suppressClickRef.current = true; // a real drag happened; swallow the click
    if (d.mode === "resize") {
      const originStart = perDay[d.originCol]?.dayStartMs ?? 0;
      onEventResize(d.ev, originStart + d.curEndMin * 60000);
    } else {
      const dayStartMs = perDay[d.curCol]?.dayStartMs ?? perDay[d.originCol]?.dayStartMs ?? 0;
      onEventMove(d.ev, dayStartMs + d.curStartMin * 60000, dayStartMs + d.curEndMin * 60000);
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
          {/* Gutter label: clip it so a long localized "GANZTÄGIG" never spills
              into the first day column and collides with a task's checkbox. */}
          <div style={{ width: gutterWidth, flexShrink: 0, fontSize: 9, color: "var(--text-faint)", textAlign: "right", padding: "4px 6px 0 0", textTransform: "uppercase", letterSpacing: "0.02em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "clip" }}>
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
                  style={{ display: "block", textAlign: "left", border: "none", borderRadius: "var(--radius-xs)", padding: "2px 6px", cursor: "pointer", background: colorOf(e), color: "var(--accent-on)", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: e.end.ts <= nowTs ? 0.5 : 1 }}
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
        <div style={{ display: "flex", position: "relative", height: dayHeight }}>
          {/* Hour gutter */}
          <div style={{ width: gutterWidth, flexShrink: 0, position: "relative" }}>
            {hours.map((h) => (
              <div key={h} style={{ position: "absolute", top: h * pxPerHour, right: 6, transform: "translateY(-50%)", fontSize: 10, color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
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
                  <div key={h} style={{ position: "absolute", left: 0, right: 0, top: h * pxPerHour, borderTop: "1px solid var(--border-color-light)", opacity: 0.6 }} />
                ))}

                {/* Drag selection preview (create) */}
                {drag && drag.col === col && (() => {
                  const top = Math.min(drag.y0, drag.y1);
                  const height = Math.max(MIN_BLOCK_PX, Math.abs(drag.y1 - drag.y0));
                  const s = snapMinutes(pxToMinutes(top, pxPerHour));
                  const e = drag.moved ? snapMinutes(pxToMinutes(top + height, pxPerHour)) : s + 30;
                  return (
                    <div style={{ position: "absolute", left: 2, right: 2, top, height, background: "var(--accent-soft)", border: "1.5px dashed var(--accent-color)", borderRadius: "var(--radius-xs)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--accent-color)", fontWeight: 600, pointerEvents: "none", zIndex: 4 }}>
                      {minutesToHHMM(s)}–{minutesToHHMM(e)}
                    </div>
                  );
                })()}

                {/* Event-drag ghost (move/resize) */}
                {blockDrag && blockDrag.moved && blockDrag.curCol === col && (() => {
                  const top = minutesToPx(blockDrag.curStartMin, pxPerHour);
                  const height = Math.max(MIN_BLOCK_PX, minutesToPx(blockDrag.curEndMin - blockDrag.curStartMin, pxPerHour));
                  return (
                    <div style={{ position: "absolute", left: 2, right: 2, top, height, background: "var(--accent-soft)", border: "1.5px dashed var(--accent-color)", borderRadius: "var(--radius-xs)", display: "flex", alignItems: "flex-start", padding: "2px 5px", fontSize: 11, color: "var(--accent-color)", fontWeight: 600, pointerEvents: "none", zIndex: 6, whiteSpace: "nowrap", overflow: "hidden" }}>
                      {minutesToHHMM(blockDrag.curStartMin)}–{minutesToHHMM(blockDrag.curEndMin)}
                    </div>
                  );
                })()}

                {/* Timed event blocks */}
                {d.blocks.map((b) => {
                  const top = minutesToPx(b.startMin, pxPerHour);
                  const height = Math.max(MIN_BLOCK_PX, minutesToPx(b.endMin - b.startMin, pxPerHour));
                  const widthPct = 100 / b.lanes;
                  const leftPct = b.lane * widthPct;
                  const editable = canEditEvent(b.ev);
                  const dragging = blockDrag?.moved && eventKey(blockDrag.ev) === eventKey(b.ev);
                  return (
                    <button
                      key={eventKey(b.ev)}
                      type="button"
                      data-testid="calendar-timed-event"
                      onPointerDown={(e) => {
                        // Clear a stale suppression left by a prior drag that
                        // ended off the block (resize) so this click still works.
                        suppressClickRef.current = false;
                        if (editable) startBlockDrag("move", col, b, e);
                        else e.stopPropagation();
                      }}
                      onPointerMove={onBlockMove}
                      onPointerUp={onBlockUp}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                        onEventClick(b.ev);
                      }}
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
                        cursor: editable ? "grab" : "pointer",
                        opacity: dragging ? 0.4 : b.ev.end.ts <= nowTs ? 0.5 : 1,
                        touchAction: "none",
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
                      {/* Resize handle (bottom edge) — only for editable, tall-enough blocks */}
                      {editable && height >= MIN_BLOCK_PX + RESIZE_HANDLE_PX && (
                        <span
                          data-testid="calendar-event-resize"
                          onPointerDown={(e) => startBlockDrag("resize", col, b, e)}
                          onPointerMove={(e) => { e.stopPropagation(); onBlockMove(e); }}
                          onPointerUp={(e) => { e.stopPropagation(); onBlockUp(e); }}
                          onClick={(e) => e.stopPropagation()}
                          aria-hidden
                          style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: RESIZE_HANDLE_PX, cursor: "ns-resize", touchAction: "none" }}
                        />
                      )}
                    </button>
                  );
                })}

                {/* Now line (today only) */}
                {isToday && (
                  <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: minutesToPx(nowMin, pxPerHour), height: 0, borderTop: "2px solid var(--error-text)", zIndex: 5 }}>
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
