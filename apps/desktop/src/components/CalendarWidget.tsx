import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarCheck, CalendarRange, ChevronDown, ChevronLeft, ChevronRight, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { buildMonthCells, ICON, isoWeeksForCells, MenuItem, MenuLabel, MenuSurface, startOfMonth, type WeekStartDay } from "@plainva/ui";
import type { PimEventRow } from "@plainva/core";
import { localIsoKey } from "../services/dailyNotePath";
import { useVault } from "../contexts/VaultContext";
import { bucketEventsByDay, formatTimeRange } from "../services/pim/calendarModel";
import { loadDueTasks, type DueTask } from "../services/pim/taskOverlay";
import { getWeekStartSetting, weekStartDayOf, WEEK_START_CHANGED_EVENT } from "../services/weekStart";

/**
 * Sidebar calendar. Since the PIM calendar exists this widget is a day
 * OVERVIEW, not a daily-note launcher: a click opens a small day peek (events
 * + due tasks + the daily-note action), right-click offers the same as a
 * context menu. Day cells mark a daily note with a tiny sunrise glyph and
 * events with per-calendar color dots. The daily note itself is reachable
 * from the peek/menu (and the ribbon's own button).
 */

interface CalendarWidgetProps {
  /** Opens (or creates) the daily note of the given date. */
  onOpenDaily: (date: Date) => void;
  /** Opens the calendar tab focused on the given day. */
  onOpenCalendarDay?: (dayKey: string) => void;
  /** Opens a vault note (task rows in the peek/menu). */
  onOpenNote?: (path: string) => void;
  /** Resolves which of the given dates already have a daily note. */
  loadMarkedDates?: (dates: Date[]) => Promise<Set<string>>;
  /** Date of the open daily note; highlighted with precedence over "today". */
  activeDate?: Date | null;
  /** Bump to force a refresh of the marked dates (e.g. after a note is created). */
  refreshToken?: number;
}

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Widget-local pref, persisted like the right-panel open/order states. */
const SHOW_WEEKS_KEY = "plainva-calendar-show-weeks";

export const CalendarWidget: React.FC<CalendarWidgetProps> = ({ onOpenDaily, onOpenCalendarDay, onOpenNote, loadMarkedDates, activeDate, refreshToken }) => {
  const { t, i18n } = useTranslation();
  const { pimRuntime, vaultPath, vaultAdapter, queryService, fileTreeVersion } = useVault();
  const today = new Date();
  const [viewDate, setViewDate] = useState<Date>(startOfMonth(today));
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => today.getFullYear());
  const [showWeeks, setShowWeeks] = useState(() => localStorage.getItem(SHOW_WEEKS_KEY) === "true");
  const [weekStartDay, setWeekStartDay] = useState<WeekStartDay>(1);
  const [menu, setMenu] = useState<{ dayKey: string; at: { x: number; y: number } } | null>(null);
  const [pimTick, setPimTick] = useState(0);
  const [events, setEvents] = useState<PimEventRow[]>([]);
  const [calColors, setCalColors] = useState<Map<string, string>>(new Map());
  const [tasks, setTasks] = useState<DueTask[]>([]);
  const navRef = useRef<HTMLDivElement | null>(null);
  const lang = i18n.language || "en";

  const monthLabel = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(viewDate);

  useEffect(() => {
    let alive = true;
    const load = () =>
      void getWeekStartSetting()
        .then((s) => {
          if (alive) setWeekStartDay(weekStartDayOf(s));
        })
        .catch(() => {});
    load();
    window.addEventListener(WEEK_START_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(WEEK_START_CHANGED_EVENT, load);
    };
  }, []);

  // Weekday headers rotated to the chosen week start (2024-01-01 was a Monday).
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(lang, { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + ((weekStartDay - 1 + 7 + i) % 7))));
  }, [lang, weekStartDay]);
  const monthFmt = new Intl.DateTimeFormat(lang, { month: "short" });
  const monthNames = Array.from({ length: 12 }, (_, i) => monthFmt.format(new Date(2024, i, 1)));

  const cells = useMemo(() => buildMonthCells(viewDate, weekStartDay), [viewDate, weekStartDay]);
  // ISO week numbers are defined on Monday rows — only offered there.
  const weekNumbers = showWeeks && weekStartDay === 1 ? isoWeeksForCells(cells) : null;

  const prevMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  const nextMonth = () => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  const goToday = () => { setViewDate(startOfMonth(today)); setPickerOpen(false); };
  const togglePicker = () => {
    setPickerYear(viewDate.getFullYear());
    setPickerOpen((o) => !o);
  };
  const toggleWeeks = () => {
    setShowWeeks((v) => {
      const next = !v;
      localStorage.setItem(SHOW_WEEKS_KEY, String(next));
      return next;
    });
  };

  // Close the month/year picker on outside click / Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (navRef.current && !navRef.current.contains(tgt)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  // Mark days that already have a daily note (tiny sunrise under the number).
  useEffect(() => {
    if (!loadMarkedDates) { setMarked(new Set()); return; }
    let active = true;
    loadMarkedDates(cells).then((s) => { if (active) setMarked(s); }).catch(() => { if (active) setMarked(new Set()); });
    return () => { active = false; };
  }, [cells, refreshToken, loadMarkedDates]);

  // Opening a daily note jumps the calendar to its month so the highlight is
  // visible. `activeDate`'s identity only changes when the open note changes
  // (App recomputes it on file/vault change), so this never fights the user's
  // manual month navigation while the same note stays open.
  useEffect(() => {
    if (activeDate) setViewDate(startOfMonth(activeDate));
  }, [activeDate]);

  // PIM events of the visible grid (color dots + the peek/menu content).
  useEffect(() => {
    const onChanged = () => setPimTick((v) => v + 1);
    window.addEventListener("plainva-pim-changed", onChanged);
    return () => window.removeEventListener("plainva-pim-changed", onChanged);
  }, []);
  useEffect(() => {
    let alive = true;
    if (!pimRuntime || cells.length === 0) {
      setEvents([]);
      setCalColors(new Map());
      return;
    }
    void (async () => {
      try {
        const startTs = cells[0].getTime();
        const endTs = cells[cells.length - 1].getTime() + 24 * 60 * 60 * 1000;
        const [evs, cals] = await Promise.all([pimRuntime.cache.listEvents(startTs, endTs), pimRuntime.cache.listCalendars()]);
        if (!alive) return;
        setEvents(evs);
        setCalColors(new Map(cals.map((c) => [`${c.accountId} ${c.id}`, c.color ?? ""])));
      } catch {
        /* cache unreadable — keep previous */
      }
    })();
    return () => {
      alive = false;
    };
  }, [pimRuntime, cells, pimTick]);

  // Due tasks of the standard task database (same loader as the calendar tab).
  useEffect(() => {
    let alive = true;
    if (!vaultPath || !vaultAdapter || !queryService) {
      setTasks([]);
      return;
    }
    void loadDueTasks({ vaultPath, vaultAdapter, queryService })
      .then((out) => {
        if (alive) setTasks(out);
      })
      .catch(() => {
        if (alive) setTasks([]);
      });
    return () => {
      alive = false;
    };
  }, [vaultPath, vaultAdapter, queryService, fileTreeVersion, pimTick]);

  const eventsByDay = useMemo(() => bucketEventsByDay(events), [events]);
  const tasksByDay = useMemo(() => {
    const m = new Map<string, DueTask[]>();
    for (const task of tasks) {
      const arr = m.get(task.due);
      if (arr) arr.push(task);
      else m.set(task.due, [task]);
    }
    return m;
  }, [tasks]);

  const colorOf = useCallback(
    (e: PimEventRow) => calColors.get(`${e.accountId} ${e.calendarId}`) || "var(--accent-color)",
    [calColors]
  );

  const dateOfKey = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  };

  const renderDay = (d: Date, key: number) => {
    const dayKey = localIsoKey(d);
    const inMonth = d.getMonth() === viewDate.getMonth();
    const isToday = sameDay(d, today);
    const isActive = activeDate ? sameDay(d, activeDate) : false;
    const hasDaily = marked.has(dayKey);
    const dayEvents = eventsByDay.get(dayKey) ?? [];
    // One dot per distinct calendar color (max 3 fit the cell).
    const dotColors = [...new Set(dayEvents.map(colorOf))].slice(0, 3);
    // Visual precedence: the open daily note (filled accent) wins over today,
    // which drops to an outline so it stays recognizable but subordinate.
    const outlined = isToday && !isActive;
    return (
      <button
        key={key}
        onClick={() => (onOpenCalendarDay ? onOpenCalendarDay(dayKey) : onOpenDaily(d))}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ dayKey, at: { x: e.clientX, y: e.clientY } });
        }}
        aria-current={isActive ? "date" : undefined}
        data-tip={new Intl.DateTimeFormat(lang, { dateStyle: "full" }).format(d)}
        data-testid={`sidecal-day-${dayKey}`}
        className="pv-rowhover"
        style={{
          position: "relative", aspectRatio: "1 / 1", border: "none", borderRadius: "var(--radius-xs)", cursor: "pointer",
          fontSize: "var(--text-ui)", padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
          background: isActive ? "var(--accent-color)" : undefined,
          color: isActive ? "var(--accent-on)" : outlined ? "var(--accent-color)" : inMonth ? "var(--text-main)" : "var(--text-faint)",
          fontWeight: isActive ? 700 : outlined ? 600 : 400,
          boxShadow: outlined ? "inset 0 0 0 1.5px var(--accent-color)" : undefined,
        }}
      >
        {d.getDate()}
        {(hasDaily || dotColors.length > 0) && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute", bottom: "1px", left: "50%", transform: "translateX(-50%)",
              display: "flex", alignItems: "center", gap: "2px", lineHeight: 0,
            }}
          >
            {hasDaily && <Sun size={ICON.meta} style={{ color: isActive ? "var(--accent-on)" : "var(--accent-color)" }} />}
            {dotColors.map((c, i) => (
              <span key={i} style={{ width: "4px", height: "4px", borderRadius: "var(--radius-pill)", background: isActive ? "var(--accent-on)" : c }} />
            ))}
          </span>
        )}
      </button>
    );
  };

  const weekCellStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "var(--text-xs)", color: "var(--text-faint)", fontVariantNumeric: "tabular-nums",
    paddingRight: "2px", borderRight: "1px solid var(--border-color-light)", marginRight: "2px",
  };

  const menuEvents = menu ? eventsByDay.get(menu.dayKey) ?? [] : [];
  const menuTasks = menu ? tasksByDay.get(menu.dayKey) ?? [] : [];

  return (
    <div style={{ position: "relative", padding: "0.75rem", borderBottom: "1px solid var(--border-color-light)", flexShrink: 0 }}>
      <div ref={navRef} style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem", gap: "2px" }}>
        <button onClick={prevMonth} className="pv-iconbtn pv-iconbtn--sm" aria-label={t("calendar.prevMonth")} data-tip={t("calendar.prevMonth")}><ChevronLeft size={ICON.ui} /></button>
        <button
          onClick={togglePicker}
          data-testid="calendar-month-label"
          aria-expanded={pickerOpen}
          data-tip={t("calendar.selectMonthYear")}
          style={{ background: "transparent", border: "none", color: "var(--text-main)", cursor: "pointer", fontSize: "var(--text-md)", fontWeight: 600, textTransform: "capitalize", flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: "3px" }}
        >
          <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{monthLabel}</span>
          <ChevronDown size={ICON.meta} style={{ flexShrink: 0, opacity: 0.6 }} aria-hidden="true" />
        </button>
        <button onClick={nextMonth} className="pv-iconbtn pv-iconbtn--sm" aria-label={t("calendar.nextMonth")} data-tip={t("calendar.nextMonth")}><ChevronRight size={ICON.ui} /></button>
        <button onClick={goToday} data-testid="calendar-today" className="pv-iconbtn pv-iconbtn--sm" aria-label={t("calendar.today")} data-tip={t("calendar.today")}><CalendarCheck size={ICON.ui} /></button>

        {pickerOpen && (
          <div
            data-testid="calendar-month-picker"
            style={{
              position: "absolute", top: "100%", left: 0, right: 0, marginTop: "4px", zIndex: 30,
              background: "var(--bg-primary)", border: "1px solid var(--border-color)", borderRadius: "var(--radius-md)",
              boxShadow: "var(--shadow-2)", padding: "0.5rem",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
              <button onClick={() => setPickerYear((y) => y - 1)} data-testid="calendar-picker-prev-year" className="pv-iconbtn pv-iconbtn--sm" aria-label={t("calendar.prevYear")} data-tip={t("calendar.prevYear")}><ChevronLeft size={ICON.ui} /></button>
              <span data-testid="calendar-picker-year" style={{ fontSize: "var(--text-md)", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{pickerYear}</span>
              <button onClick={() => setPickerYear((y) => y + 1)} data-testid="calendar-picker-next-year" className="pv-iconbtn pv-iconbtn--sm" aria-label={t("calendar.nextYear")} data-tip={t("calendar.nextYear")}><ChevronRight size={ICON.ui} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "2px" }}>
              {monthNames.map((m, i) => {
                const isCurrent = i === viewDate.getMonth() && pickerYear === viewDate.getFullYear();
                return (
                  <button
                    key={i}
                    data-testid={`calendar-pick-month-${i}`}
                    onClick={() => { setViewDate(new Date(pickerYear, i, 1)); setPickerOpen(false); }}
                    className="pv-rowhover"
                    style={{
                      padding: "0.35rem 0.2rem", fontSize: "var(--text-sm)", border: "none", borderRadius: "var(--radius-xs)", cursor: "pointer",
                      textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      background: isCurrent ? "var(--accent-color)" : undefined,
                      color: isCurrent ? "var(--accent-on)" : "var(--text-main)",
                    }}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
            {weekStartDay === 1 && (
              <label style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "0.5rem", fontSize: "var(--text-sm)", color: "var(--text-muted)", cursor: "pointer" }}>
                <input type="checkbox" className="pv-check" data-testid="calendar-show-weeks" checked={showWeeks} onChange={toggleWeeks} />
                {t("calendar.showWeeks")}
              </label>
            )}
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: weekNumbers ? "auto repeat(7, minmax(0, 1fr))" : "repeat(7, minmax(0, 1fr))", gap: "1px" }}>
        {weekNumbers && (
          <div style={{ ...weekCellStyle, fontSize: "var(--text-xs)", textTransform: "uppercase", padding: "0.2rem 2px 0.2rem 0" }}>{t("calendar.weekShort")}</div>
        )}
        {weekdays.map((w, i) => (
          <div key={`wd-${i}`} style={{ textAlign: "center", fontSize: "var(--text-xs)", color: "var(--text-faint)", padding: "0.2rem 0", textTransform: "uppercase", overflow: "hidden", whiteSpace: "nowrap" }}>{w}</div>
        ))}
        {Array.from({ length: 6 }, (_, row) => {
          const rowCells = cells.slice(row * 7, row * 7 + 7);
          return (
            <React.Fragment key={`row-${row}`}>
              {weekNumbers && (
                <div data-testid="calendar-week-number" data-tip={`${t("calendar.weekShort")} ${weekNumbers[row]}`} style={weekCellStyle}>
                  {weekNumbers[row]}
                </div>
              )}
              {rowCells.map((d, i) => renderDay(d, row * 7 + i))}
            </React.Fragment>
          );
        })}
      </div>


      {menu && (
        <MenuSurface open onClose={() => setMenu(null)} at={menu.at} ariaLabel={t("rightPanel.calendar", { defaultValue: "Kalender" })}>
          <MenuLabel>
            {new Intl.DateTimeFormat(lang, { weekday: "long", day: "numeric", month: "long" }).format(dateOfKey(menu.dayKey))}
          </MenuLabel>
          <MenuItem
            icon={<CalendarRange size={ICON.ui} />}
            data-testid="sidecal-menu-open"
            onSelect={() => {
              const key = menu.dayKey;
              setMenu(null);
              onOpenCalendarDay?.(key);
            }}
          >
            {t("pim.openCalendar", { defaultValue: "Kalender öffnen" })}
          </MenuItem>
          <MenuItem
            icon={<Sun size={ICON.ui} />}
            onSelect={() => {
              const d = dateOfKey(menu.dayKey);
              setMenu(null);
              onOpenDaily(d);
            }}
          >
            {t("sidebar.newDaily", { defaultValue: "Tageseintrag" })}
          </MenuItem>
          {menuEvents.length > 0 && <MenuLabel>{t("pim.eventsLabel", { defaultValue: "Termine" })}</MenuLabel>}
          {menuEvents.map((e) => (
            <MenuItem
              key={`${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`}
              onSelect={() => {
                const key = menu.dayKey;
                setMenu(null);
                onOpenCalendarDay?.(key);
              }}
            >
              {`${e.allDay ? t("pim.allDay", { defaultValue: "Ganztägig" }) : formatTimeRange(e, lang)} · ${e.title}`}
            </MenuItem>
          ))}
          {menuTasks.length > 0 && <MenuLabel>{t("pim.calendarTasks", { defaultValue: "Aufgaben" })}</MenuLabel>}
          {menuTasks.map((task) => (
            <MenuItem
              key={task.path}
              onSelect={() => {
                setMenu(null);
                onOpenNote?.(task.path);
              }}
            >
              {task.title}
            </MenuItem>
          ))}
        </MenuSurface>
      )}
    </div>
  );
};
