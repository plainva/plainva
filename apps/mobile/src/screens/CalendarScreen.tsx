import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buildMonthCells, startOfMonth } from "@plainva/ui";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { getMobileSettings } from "../services/mobileSettings";
import { isoOf } from "../lib/dates";

/**
 * Calendar screen (R2.3): month grid over the daily-notes folder. Days with
 * an existing daily note carry a dot; tapping any day opens (or creates) it.
 * Grid math is the shared desktop helper (@plainva/ui calendarGrid).
 */
export function CalendarScreen({
  vault,
  bump,
  onBack,
  onOpenDate,
}: {
  vault: MobileVault;
  bump: number;
  onBack?: () => void;
  onOpenDate: (iso: string) => void;
}) {
  const { t, i18n: i18nInstance } = useTranslation();
  const [viewDate, setViewDate] = useState(() => startOfMonth(new Date()));
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const todayIso = isoOf(new Date());

  useEffect(() => {
    let stale = false;
    const folder = getMobileSettings().dailyFolder;
    void vaultOps
      .listFolder(vault, folder)
      .then((l) => {
        if (stale) return;
        const set = new Set<string>();
        for (const n of l.notes) if (/^\d{4}-\d{2}-\d{2}$/.test(n.title)) set.add(n.title);
        setExisting(set);
      })
      .catch(() => {
        if (!stale) setExisting(new Set());
      });
    return () => {
      stale = true;
    };
  }, [vault, bump]);

  const cells = useMemo(() => buildMonthCells(viewDate), [viewDate]);
  const monthLabel = new Intl.DateTimeFormat(i18nInstance.language, {
    month: "long",
    year: "numeric",
  }).format(viewDate);
  // Weekday header from the first grid row (rows always start on Monday).
  const weekday = new Intl.DateTimeFormat(i18nInstance.language, { weekday: "short" });
  const month = viewDate.getMonth();

  const shift = (delta: number) =>
    setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + delta, 1));

  return (
    <div className="m-page">
      {onBack && (
        <header className="m-header">
          <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={22} />
          </button>
          <h1>{t("mobile.tabCalendar")}</h1>
        </header>
      )}
      <div className="m-cal-head">
        <span className="m-cal-month">{monthLabel}</span>
        <span className="m-headactions">
          <button aria-label={t("calendar.prevMonth")} className="m-iconbtn" onClick={() => shift(-1)}>
            <ChevronLeft size={20} />
          </button>
          <button
            className="m-cal-today"
            onClick={() => setViewDate(startOfMonth(new Date()))}
            type="button"
          >
            {t("calendar.today")}
          </button>
          <button aria-label={t("calendar.nextMonth")} className="m-iconbtn" onClick={() => shift(1)}>
            <ChevronRight size={20} />
          </button>
        </span>
      </div>
      <div className="m-cal-grid">
        {cells.slice(0, 7).map((d) => (
          <span className="m-cal-wd" key={`wd-${d.getDay()}`}>
            {weekday.format(d)}
          </span>
        ))}
        {cells.map((d) => {
          const iso = isoOf(d);
          const inMonth = d.getMonth() === month;
          const classes = [
            "m-cal-day",
            inMonth ? "" : "is-outside",
            iso === todayIso ? "is-today" : "",
            existing.has(iso) ? "has-daily" : "",
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <button className={classes} key={iso} onClick={() => onOpenDate(iso)}>
              <span>{d.getDate()}</span>
              <span className="m-cal-dot" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
