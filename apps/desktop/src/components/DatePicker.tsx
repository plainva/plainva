import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { format, addMonths, subMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, isSameMonth, isSameDay } from "date-fns";
import { de } from "date-fns/locale";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";

interface Props {
  value: string;
  onChange: (val: string) => void;
  includeTime?: boolean;
  /** Open the popover immediately on mount (used when editing a table cell). */
  autoOpen?: boolean;
  /** Called when the popover is dismissed without picking (outside click / toggle close). */
  onClose?: () => void;
}

export function CustomDatePicker({ value, onChange, includeTime, autoOpen, onClose }: Props) {
  const [isOpen, setIsOpen] = useState(!!autoOpen);
  
  // Parse initial value or default to now
  let initialDate = new Date();
  if (value) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) initialDate = d;
  }
  
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(initialDate));
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [timeStr, setTimeStr] = useState(format(initialDate, "HH:mm"));

  const popoverRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  // The popover is fixed-positioned (anchored to the trigger rect) so it is
  // never clipped by a scrolling container — the table used to reserve 100px of
  // bottom padding for the old absolute-positioned popover (plan W5/P14).
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const place = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const POPOVER_HEIGHT = 400;
    const openUp = window.innerHeight - r.bottom < POPOVER_HEIGHT && r.top > window.innerHeight - r.bottom;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 258));
    setPos(openUp ? { left, bottom: window.innerHeight - r.top + 4 } : { left, top: r.bottom + 4 });
  };
  useLayoutEffect(() => {
    if (isOpen) place();
  }, [isOpen]);
  useEffect(() => {
    if (!isOpen) return;
    const onScrollOrResize = (e: Event) => {
      if (e.target instanceof Node && popoverRef.current?.contains(e.target)) return;
      place();
    };
    window.addEventListener("scroll", onScrollOrResize, true);
    window.addEventListener("resize", onScrollOrResize);
    return () => {
      window.removeEventListener("scroll", onScrollOrResize, true);
      window.removeEventListener("resize", onScrollOrResize);
    };
  }, [isOpen]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        onClose?.();
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen, onClose]);

  // Generate calendar days
  const startDate = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
  const endDate = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: startDate, end: endDate });

  const handleDayClick = (day: Date) => {
    setSelectedDate(day);
    if (!includeTime) {
      onChange(format(day, "yyyy-MM-dd"));
      setIsOpen(false);
    }
  };

  const handleConfirm = () => {
    if (includeTime) {
      const [hh, mm] = timeStr.split(":");
      const d = new Date(selectedDate);
      d.setHours(parseInt(hh || "0", 10));
      d.setMinutes(parseInt(mm || "0", 10));
      onChange(format(d, "yyyy-MM-dd'T'HH:mm"));
    } else {
      onChange(format(selectedDate, "yyyy-MM-dd"));
    }
    setIsOpen(false);
  };

  return (
    <div ref={anchorRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      <div
        onClick={() => { const next = !isOpen; setIsOpen(next); if (!next) onClose?.(); }}
        style={{ 
          padding: "0.25rem 0.5rem", 
          borderRadius: "var(--radius-xs)", 
          border: "1px solid var(--border-color)", 
          background: "transparent", 
          color: "var(--text-main)", 
          cursor: "pointer",
          minHeight: "26px",
          display: "flex",
          alignItems: "center"
        }}
      >
        {value ? (includeTime ? format(new Date(value), "dd.MM.yyyy, HH:mm") : format(new Date(value), "dd.MM.yyyy")) : t("editor.value", "Wert...")}
      </div>

      {isOpen && pos && (
        <div
          ref={popoverRef}
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            zIndex: "var(--z-menu)",
            background: "var(--bg-primary)",
            border: "1px solid var(--border-color)",
            borderRadius: "var(--radius-md)",
            boxShadow: "var(--shadow-2)",
            padding: "0.75rem",
            width: "250px",
            color: "var(--text-main)"
          }}
        >
          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem" }}>
            <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="pv-iconbtn pv-iconbtn--sm"><ChevronLeft size={16} /></button>
            <div style={{ fontWeight: 600, fontSize: "0.9rem" }}>{format(currentMonth, "MMMM yyyy", { locale: de })}</div>
            <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="pv-iconbtn pv-iconbtn--sm"><ChevronRight size={16} /></button>
          </div>

          {/* Weekday Labels */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", textAlign: "center", fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "4px", fontWeight: 600 }}>
            <div>Mo</div><div>Di</div><div>Mi</div><div>Do</div><div>Fr</div><div>Sa</div><div>So</div>
          </div>

          {/* Days Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "2px" }}>
            {days.map(day => {
              const isSelected = isSameDay(day, selectedDate);
              const isCurrentMonth = isSameMonth(day, currentMonth);
              return (
                <button
                  key={day.toISOString()}
                  onClick={() => handleDayClick(day)}
                  style={{
                    padding: "6px 0",
                    background: isSelected ? "var(--accent-color)" : "transparent",
                    color: isSelected ? "var(--accent-on)" : (isCurrentMonth ? "var(--text-main)" : "var(--text-faint)"),
                    border: "none",
                    borderRadius: "var(--radius-xs)",
                    cursor: "pointer",
                    fontSize: "0.85rem",
                    fontWeight: isSelected ? 600 : 400
                  }}
                  onMouseOver={e => { if(!isSelected) e.currentTarget.style.background = "var(--bg-hover)"; }}
                  onMouseOut={e => { if(!isSelected) e.currentTarget.style.background = "transparent"; }}
                >
                  {format(day, "d")}
                </button>
              )
            })}
          </div>

          {/* Time Picker */}
          {includeTime && (
            <div style={{ marginTop: "1rem", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border-color)", paddingTop: "0.75rem" }}>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{t("editor.time", "Uhrzeit")}</span>
              <input
                type="time"
                value={timeStr}
                onChange={e => setTimeStr(e.target.value)}
                className="pv-field"
                style={{ width: "auto" }}
              />
            </div>
          )}

          {/* Confirm Button */}
          {includeTime && (
            <div style={{ marginTop: "0.75rem", display: "flex", justifyContent: "flex-end" }}>
              <button
                onClick={handleConfirm}
                className="pv-btn pv-btn--primary"
              >
                {t("common.confirm", "Bestätigen")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
