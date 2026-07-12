import { Fragment, useEffect, useMemo, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Hash } from "lucide-react";
import { getISOWeek } from "date-fns";
import { buildMonthCells, startOfMonth } from "@plainva/ui";
import { mSelect } from "../services/mobileDialogs";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { getMobileSettings } from "../services/mobileSettings";
import { isoOf } from "../lib/dates";
import { usePullToRefresh } from "../lib/usePullToRefresh";

/**
 * Calendar screen (R2.3; polished in package I): month grid over the
 * daily-notes folder. Days with an existing daily note carry a dot; tapping
 * any day opens (or creates) it. Tapping the month label jumps via
 * month/year pickers (desktop popover parity), and ISO week numbers toggle
 * on — persisted device-locally like the desktop's checkbox.
 */

const WEEKS_KEY = "m-calendar-show-weeks";

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
  const [showWeeks, setShowWeeks] = useState(() => {
    try {
      return localStorage.getItem(WEEKS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const todayIso = isoOf(new Date());
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

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

  const toggleWeeks = () => {
    setShowWeeks((s) => {
      try {
        localStorage.setItem(WEEKS_KEY, s ? "0" : "1");
      } catch {
        /* device-local nicety only */
      }
      return !s;
    });
  };

  // Month/year jump (desktop popover parity): two quick pickers.
  const jump = () => {
    void (async () => {
      const monthFmt = new Intl.DateTimeFormat(i18nInstance.language, { month: "long" });
      const pickedMonth = await mSelect({
        title: monthLabel,
        options: Array.from({ length: 12 }, (_, m) => ({
          value: String(m),
          label: monthFmt.format(new Date(2026, m, 1)),
        })),
        value: String(viewDate.getMonth()),
      });
      if (pickedMonth === null) return;
      const baseYear = viewDate.getFullYear();
      const pickedYear = await mSelect({
        title: monthLabel,
        options: Array.from({ length: 11 }, (_, i) => {
          const y = baseYear - 5 + i;
          return { value: String(y), label: String(y) };
        }),
        value: String(baseYear),
      });
      if (pickedYear === null) return;
      setViewDate(new Date(Number(pickedYear), Number(pickedMonth), 1));
    })();
  };

  // Rows of 7 for the optional ISO week number column.
  const rows = useMemo(() => {
    const out: Date[][] = [];
    for (let i = 0; i < cells.length; i += 7) out.push(cells.slice(i, i + 7));
    return out;
  }, [cells]);

  const dayCell = (d: Date) => {
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
  };

  return (
    <div className="m-page" ref={ptrRef}>
      {ptrIndicator}
      {onBack && (
        <header className="m-header">
          <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={22} />
          </button>
          <h1>{t("mobile.tabCalendar")}</h1>
        </header>
      )}
      <div className="m-cal-head">
        <button className="m-cal-month" onClick={jump} type="button">
          {monthLabel}
        </button>
        <span className="m-headactions">
          <button
            aria-label={t("calendar.showWeeks")}
            aria-pressed={showWeeks}
            className={`m-iconbtn${showWeeks ? " is-active" : ""}`}
            onClick={toggleWeeks}
          >
            <Hash size={18} />
          </button>
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
      <div className={showWeeks ? "m-cal-grid m-cal-grid--weeks" : "m-cal-grid"}>
        {showWeeks && <span className="m-cal-wd" />}
        {cells.slice(0, 7).map((d) => (
          <span className="m-cal-wd" key={`wd-${d.getDay()}`}>
            {weekday.format(d)}
          </span>
        ))}
        {rows.map((row) => (
          <Fragment key={`row-${isoOf(row[0])}`}>
            {showWeeks && <span className="m-cal-week">{getISOWeek(row[0])}</span>}
            {row.map(dayCell)}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
