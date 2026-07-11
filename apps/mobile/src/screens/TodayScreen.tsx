import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { isoOf } from "../lib/dates";

/** Today tab (M4/E6): four weeks back through tomorrow, today preselected. */
export function TodayScreen({
  onBack,
  onOpenDate,
}: {
  onBack?: () => void;
  onOpenDate: (iso: string) => void;
}) {
  const { t, i18n: i18nInstance } = useTranslation();
  const days: Date[] = [];
  for (let offset = -27; offset <= 1; offset++) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    days.push(d);
  }
  const todayIso = isoOf(new Date());
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Land on today (the strip starts four weeks back).
    stripRef.current
      ?.querySelector(".is-today")
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);
  const weekday = new Intl.DateTimeFormat(i18nInstance.language, { weekday: "short" });
  return (
    <div className="m-page">
      {onBack && (
        <header className="m-header">
          <button aria-label="Back" className="m-iconbtn" onClick={onBack}>
            <ChevronLeft size={22} />
          </button>
          <h1>{t("mobile.tabToday")}</h1>
        </header>
      )}
      <div className="m-datestrip" ref={stripRef}>
        {days.map((d) => {
          const iso = isoOf(d);
          return (
            <button
              className={`m-datestrip-day${iso === todayIso ? " is-today" : ""}`}
              key={iso}
              onClick={() => onOpenDate(iso)}
            >
              <span className="m-datestrip-wd">{weekday.format(d)}</span>
              <span className="m-datestrip-num">{d.getDate()}</span>
            </button>
          );
        })}
      </div>
      <button className="m-row" onClick={() => onOpenDate(todayIso)}>
        <Calendar className="m-accent" size={18} />
        <span>{todayIso}</span>
        <ChevronRight className="m-chevron" size={18} />
      </button>
    </div>
  );
}
