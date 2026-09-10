import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { format } from "date-fns";
import { useTranslation } from "react-i18next";
import { DateJumpPicker, formatDateValue, localIsoKey, useWeekStartDay } from "@plainva/ui";

interface Props {
  value: string;
  onChange: (val: string) => void;
  includeTime?: boolean;
  /** Open the popover immediately on mount (used when editing a table cell). */
  autoOpen?: boolean;
  /** Called when the popover is dismissed without picking (outside click / toggle close). */
  onClose?: () => void;
}

/**
 * The date field of a database cell or a property. The grid inside is the
 * shared DateJumpPicker (plan Kalender 2026-09-10, P1): this field used to
 * carry its own 6x7 grid with "Mo Di Mi …" hard-coded in every language, the
 * month title fixed to German, and Monday as the week start whatever the
 * setting said. The field, the time row and the confirm button stay.
 */
export function CustomDatePicker({ value, onChange, includeTime, autoOpen, onClose }: Props) {
  const [isOpen, setIsOpen] = useState(!!autoOpen);
  const weekStart = useWeekStartDay();

  // Parse initial value or default to now
  let initialDate = new Date();
  if (value) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) initialDate = d;
  }

  const [selectedDay, setSelectedDay] = useState(localIsoKey(initialDate));
  const [timeStr, setTimeStr] = useState(format(initialDate, "HH:mm"));

  const popoverRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const { t, i18n } = useTranslation();

  // The popover is fixed-positioned (anchored to the trigger rect) so it is
  // never clipped by a scrolling container — the table used to reserve 100px of
  // bottom padding for the old absolute-positioned popover (plan W5/P14).
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const place = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const POPOVER_HEIGHT = 420;
    const openUp = window.innerHeight - r.bottom < POPOVER_HEIGHT && r.top > window.innerHeight - r.bottom;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 308));
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

  const handleDayPick = (day: string) => {
    setSelectedDay(day);
    if (!includeTime) {
      onChange(day);
      setIsOpen(false);
    }
  };

  const handleConfirm = () => {
    if (includeTime) {
      const [hh, mm] = timeStr.split(":");
      onChange(`${selectedDay}T${String(parseInt(hh || "0", 10)).padStart(2, "0")}:${String(parseInt(mm || "0", 10)).padStart(2, "0")}`);
    } else {
      onChange(selectedDay);
    }
    setIsOpen(false);
  };

  return (
    <div ref={anchorRef} style={{ position: "relative", flex: 1, minWidth: 0 }}>
      {/* A field like every other: same height, border and 14px type via
          .pv-field (it used to be an unstyled div at the browser's 16px), the
          date in the numeric form of the UI language instead of a fixed
          German pattern, and the placeholder from the properties catalog -
          `editor.value` read "Value" in the German file (2026-09-04). */}
      <div
        className="pv-field pv-field--compact"
        onClick={() => { const next = !isOpen; setIsOpen(next); if (!next) onClose?.(); }}
        style={{ cursor: "pointer", display: "flex", alignItems: "center", minWidth: 0, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", color: value ? undefined : "var(--text-faint)" }}
      >
        {value ? formatDateValue(value, !!includeTime, i18n.language || "de", "default") : t("properties.value")}
      </div>

      {isOpen && pos && (
        <div
          ref={popoverRef}
          className="pv-popover pv-popover--fixed pv-datejump-pop"
          data-testid="date-field-picker"
          style={{
            left: pos.left,
            top: pos.top,
            bottom: pos.bottom,
            color: "var(--text-main)",
            visibility: "visible",
          }}
        >
          <DateJumpPicker
            value={selectedDay}
            weekStart={weekStart}
            onPick={handleDayPick}
            onToday={() => handleDayPick(localIsoKey(new Date()))}
            onClose={() => { setIsOpen(false); onClose?.(); }}
            autoFocus
            testId="date-field"
          />

          {/* Time Picker */}
          {includeTime && (
            <div style={{ marginTop: "var(--space-3)", display: "flex", alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border-color)", paddingTop: "var(--space-3)" }}>
              <span style={{ fontSize: "var(--text-md)", color: "var(--text-muted)" }}>{t("editor.time", "Uhrzeit")}</span>
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
            <div style={{ marginTop: "var(--space-3)", display: "flex", justifyContent: "flex-end" }}>
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
