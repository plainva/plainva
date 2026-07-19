import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Clock, MapPin } from "lucide-react";
import { Button } from "@plainva/ui";

/**
 * Google-Calendar-style quick-create popover (feedback round 3): appears at the
 * clicked/dragged slot with title, time, calendar and location. "Save" writes
 * the event straight away; "More options" hands the same draft to the full
 * EventEditModal (recurrence, attendees, meeting note). Positioned fixed at the
 * anchor and clamped into the viewport.
 */

export interface QuickCreateValues {
  title: string;
  calendarKey: string;
  location: string;
}

interface QuickCreatePopoverProps {
  anchor: { x: number; y: number };
  dateLabel: string;
  timeLabel: string;
  calendarOptions: { value: string; label: string }[];
  initialCalendarKey: string;
  onSave: (v: QuickCreateValues) => void;
  onMore: (v: QuickCreateValues) => void;
  onCancel: () => void;
}

const WIDTH = 262;

export function QuickCreatePopover(props: QuickCreatePopoverProps) {
  const { anchor, dateLabel, timeLabel, calendarOptions, initialCalendarKey, onSave, onMore, onCancel } = props;
  const { t } = useTranslation();
  const [title, setTitle] = useState("");
  const [calendarKey, setCalendarKey] = useState(initialCalendarKey || calendarOptions[0]?.value || "");
  const [location, setLocation] = useState("");
  const cardRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const [pos, setPos] = useState({ left: anchor.x, top: anchor.y });

  useLayoutEffect(() => {
    const el = cardRef.current;
    const h = el?.offsetHeight ?? 200;
    const margin = 8;
    const left = Math.max(margin, Math.min(anchor.x, window.innerWidth - WIDTH - margin));
    const top = Math.max(margin, Math.min(anchor.y, window.innerHeight - h - margin));
    setPos({ left, top });
  }, [anchor.x, anchor.y]);

  useEffect(() => {
    titleRef.current?.focus();
  }, []);

  const values = (): QuickCreateValues => ({ title: title.trim(), calendarKey, location: location.trim() });

  return (
    <>
      <div onPointerDown={onCancel} style={{ position: "fixed", inset: 0, zIndex: 60 }} />
      <div
        ref={cardRef}
        data-testid="calendar-quick-create"
        role="dialog"
        aria-label={t("pim.newEvent", { defaultValue: "Neuer Termin" })}
        onKeyDown={(e) => {
          if (e.key === "Escape") { e.stopPropagation(); onCancel(); }
        }}
        style={{
          position: "fixed",
          left: pos.left,
          top: pos.top,
          width: WIDTH,
          zIndex: 61,
          background: "var(--bg-primary)",
          border: "1px solid var(--border-color)",
          borderRadius: "var(--radius-md)",
          boxShadow: "var(--shadow-2)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "12px 14px 6px" }}>
          <input
            ref={titleRef}
            className="pv-field"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSave(values()); } }}
            placeholder={t("pim.quickCreateTitle", { defaultValue: "Titel hinzufügen" })}
            data-testid="calendar-quick-title"
            style={{ width: "100%", fontWeight: 600 }}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "4px 14px 8px", fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Clock size={14} style={{ flexShrink: 0, color: "var(--text-faint)" }} />
            <span>{dateLabel} · {timeLabel}</span>
          </div>
          {calendarOptions.length > 1 && (
            <select
              className="pv-field pv-field--select"
              value={calendarKey}
              onChange={(e) => setCalendarKey(e.target.value)}
              aria-label={t("pim.eventCalendar", { defaultValue: "Kalender" })}
              data-testid="calendar-quick-calendar"
              style={{ width: "100%" }}
            >
              {calendarOptions.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <MapPin size={14} style={{ flexShrink: 0, color: "var(--text-faint)" }} />
            <input
              className="pv-field"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={t("pim.quickCreateLocation", { defaultValue: "Ort hinzufügen" })}
              style={{ flex: 1, minWidth: 0 }}
            />
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 12px", borderTop: "1px solid var(--border-color-light)", background: "var(--bg-secondary)" }}>
          <Button variant="ghost" size="sm" onClick={() => onMore(values())} data-testid="calendar-quick-more">
            {t("pim.quickCreateMore", { defaultValue: "Weitere Optionen" })}
          </Button>
          <Button variant="primary" size="sm" onClick={() => onSave(values())} data-testid="calendar-quick-save">
            {t("common.save", { defaultValue: "Speichern" })}
          </Button>
        </div>
      </div>
    </>
  );
}
