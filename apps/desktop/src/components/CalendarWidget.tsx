import React, { useEffect, useRef, useState } from "react";
import { CalendarCheck, ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { localIsoKey } from "../services/dailyNotePath";
import { buildMonthCells, isoWeeksForCells, startOfMonth } from "@plainva/ui";

interface CalendarWidgetProps {
  onSelectDate: (date: Date) => void;
  /** Resolves which of the given dates already have a daily note (for dots). */
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

export const CalendarWidget: React.FC<CalendarWidgetProps> = ({ onSelectDate, loadMarkedDates, activeDate, refreshToken }) => {
  const { t, i18n } = useTranslation();
  const today = new Date();
  const [viewDate, setViewDate] = useState<Date>(startOfMonth(today));
  const [marked, setMarked] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(() => today.getFullYear());
  const [showWeeks, setShowWeeks] = useState(() => localStorage.getItem(SHOW_WEEKS_KEY) === "true");
  const navRef = useRef<HTMLDivElement | null>(null);
  const lang = i18n.language || "en";

  const monthLabel = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(viewDate);

  // Monday-first weekday headers (2024-01-01 was a Monday).
  const weekdayFmt = new Intl.DateTimeFormat(lang, { weekday: "short" });
  const weekdays = Array.from({ length: 7 }, (_, i) => weekdayFmt.format(new Date(2024, 0, 1 + i)));
  const monthFmt = new Intl.DateTimeFormat(lang, { month: "short" });
  const monthNames = Array.from({ length: 12 }, (_, i) => monthFmt.format(new Date(2024, i, 1)));

  const cells = buildMonthCells(viewDate);
  const weekNumbers = showWeeks ? isoWeeksForCells(cells) : null;

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

  // Close the month/year picker on outside click or Escape.
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (navRef.current && !navRef.current.contains(e.target as Node)) setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPickerOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [pickerOpen]);

  // Mark days that already have a daily note (dot under the day number).
  useEffect(() => {
    if (!loadMarkedDates) { setMarked(new Set()); return; }
    let active = true;
    const days = buildMonthCells(viewDate);
    loadMarkedDates(days).then((s) => { if (active) setMarked(s); }).catch(() => { if (active) setMarked(new Set()); });
    return () => { active = false; };
  }, [viewDate, refreshToken, loadMarkedDates]);

  // Opening a daily note jumps the calendar to its month so the highlight is
  // visible. `activeDate`'s identity only changes when the open note changes
  // (App recomputes it on file/vault change), so this never fights the user's
  // manual month navigation while the same note stays open.
  useEffect(() => {
    if (activeDate) setViewDate(startOfMonth(activeDate));
  }, [activeDate]);

  const navBtn: React.CSSProperties = {
    background: "transparent", border: "none", color: "var(--text-muted)",
    cursor: "pointer", padding: "0.2rem", display: "flex", alignItems: "center", flexShrink: 0,
  };

  const renderDay = (d: Date, key: number) => {
    const inMonth = d.getMonth() === viewDate.getMonth();
    const isToday = sameDay(d, today);
    const isActive = activeDate ? sameDay(d, activeDate) : false;
    const isMarked = marked.has(localIsoKey(d));
    // Visual precedence: the open daily note (filled accent) wins over today,
    // which drops to an outline so it stays recognizable but subordinate.
    const outlined = isToday && !isActive;
    return (
      <button
        key={key}
        onClick={() => onSelectDate(d)}
        aria-current={isActive ? "date" : undefined}
        title={new Intl.DateTimeFormat(lang, { dateStyle: "full" }).format(d)}
        style={{
          position: "relative", aspectRatio: "1 / 1", border: "none", borderRadius: "var(--radius-xs)", cursor: "pointer",
          fontSize: "0.8rem", padding: 0, display: "flex", alignItems: "center", justifyContent: "center",
          background: isActive ? "var(--accent-color)" : "transparent",
          color: isActive ? "var(--accent-on)" : outlined ? "var(--accent-color)" : inMonth ? "var(--text-main)" : "var(--text-faint)",
          fontWeight: isActive ? 700 : outlined ? 600 : 400,
          boxShadow: outlined ? "inset 0 0 0 1.5px var(--accent-color)" : undefined,
        }}
        onMouseOver={(e) => { if (!isActive && !isToday) e.currentTarget.style.background = "var(--bg-hover)"; }}
        onMouseOut={(e) => { if (!isActive && !isToday) e.currentTarget.style.background = "transparent"; }}
      >
        {d.getDate()}
        {isMarked && (
          <span
            aria-hidden="true"
            style={{
              position: "absolute", bottom: "3px", left: "50%", transform: "translateX(-50%)",
              width: "4px", height: "4px", borderRadius: "50%",
              background: isActive ? "var(--accent-on)" : "var(--accent-color)",
            }}
          />
        )}
      </button>
    );
  };

  const weekCellStyle: React.CSSProperties = {
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "0.6rem", color: "var(--text-faint)", fontVariantNumeric: "tabular-nums",
    paddingRight: "2px", borderRight: "1px solid var(--border-color-light)", marginRight: "2px",
  };

  return (
    <div style={{ padding: "0.75rem", borderBottom: "1px solid var(--border-color-light)", flexShrink: 0 }}>
      <div ref={navRef} style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem", gap: "2px" }}>
        <button onClick={prevMonth} style={navBtn} aria-label={t("calendar.prevMonth")} title={t("calendar.prevMonth")}><ChevronLeft size={16} /></button>
        <button
          onClick={togglePicker}
          data-testid="calendar-month-label"
          aria-expanded={pickerOpen}
          title={t("calendar.selectMonthYear")}
          style={{ background: "transparent", border: "none", color: "var(--text-main)", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600, textTransform: "capitalize", flex: 1, minWidth: 0, display: "flex", alignItems: "center", justifyContent: "center", gap: "3px" }}
        >
          <span style={{ minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{monthLabel}</span>
          <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.6 }} aria-hidden="true" />
        </button>
        <button onClick={nextMonth} style={navBtn} aria-label={t("calendar.nextMonth")} title={t("calendar.nextMonth")}><ChevronRight size={16} /></button>
        <button onClick={goToday} data-testid="calendar-today" style={navBtn} aria-label={t("calendar.today")} title={t("calendar.today")}><CalendarCheck size={15} /></button>

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
              <button onClick={() => setPickerYear((y) => y - 1)} data-testid="calendar-picker-prev-year" style={navBtn} aria-label={t("calendar.prevYear")} title={t("calendar.prevYear")}><ChevronLeft size={14} /></button>
              <span data-testid="calendar-picker-year" style={{ fontSize: "0.85rem", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{pickerYear}</span>
              <button onClick={() => setPickerYear((y) => y + 1)} data-testid="calendar-picker-next-year" style={navBtn} aria-label={t("calendar.nextYear")} title={t("calendar.nextYear")}><ChevronRight size={14} /></button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "2px" }}>
              {monthNames.map((m, i) => {
                const isCurrent = i === viewDate.getMonth() && pickerYear === viewDate.getFullYear();
                return (
                  <button
                    key={i}
                    data-testid={`calendar-pick-month-${i}`}
                    onClick={() => { setViewDate(new Date(pickerYear, i, 1)); setPickerOpen(false); }}
                    style={{
                      padding: "0.35rem 0.2rem", fontSize: "0.75rem", border: "none", borderRadius: "var(--radius-xs)", cursor: "pointer",
                      textTransform: "capitalize", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      background: isCurrent ? "var(--accent-color)" : "transparent",
                      color: isCurrent ? "var(--accent-on)" : "var(--text-main)",
                    }}
                    onMouseOver={(e) => { if (!isCurrent) e.currentTarget.style.background = "var(--bg-hover)"; }}
                    onMouseOut={(e) => { if (!isCurrent) e.currentTarget.style.background = "transparent"; }}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--text-muted)", cursor: "pointer" }}>
              <input type="checkbox" data-testid="calendar-show-weeks" checked={showWeeks} onChange={toggleWeeks} />
              {t("calendar.showWeeks")}
            </label>
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: showWeeks ? "auto repeat(7, minmax(0, 1fr))" : "repeat(7, minmax(0, 1fr))", gap: "1px" }}>
        {showWeeks && (
          <div style={{ ...weekCellStyle, fontSize: "0.65rem", textTransform: "uppercase", padding: "0.2rem 2px 0.2rem 0" }}>{t("calendar.weekShort")}</div>
        )}
        {weekdays.map((w, i) => (
          <div key={`wd-${i}`} style={{ textAlign: "center", fontSize: "0.65rem", color: "var(--text-faint)", padding: "0.2rem 0", textTransform: "uppercase", overflow: "hidden", whiteSpace: "nowrap" }}>{w}</div>
        ))}
        {Array.from({ length: 6 }, (_, row) => {
          const rowCells = cells.slice(row * 7, row * 7 + 7);
          return (
            <React.Fragment key={`row-${row}`}>
              {weekNumbers && (
                <div data-testid="calendar-week-number" title={`${t("calendar.weekShort")} ${weekNumbers[row]}`} style={weekCellStyle}>
                  {weekNumbers[row]}
                </div>
              )}
              {rowCells.map((d, i) => renderDay(d, row * 7 + i))}
            </React.Fragment>
          );
        })}
      </div>
    </div>
  );
};
