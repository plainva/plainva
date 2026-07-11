import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, ChevronLeft, ChevronRight, FileText, Plus } from "lucide-react";
import { isoOf } from "../lib/dates";
import { getMobileSettings } from "../services/mobileSettings";
import type { MobileVault } from "../services/vaultService";

/**
 * Today tab as a day view (R3.5, maintainer question "what is this tab
 * supposed to do?"): the strip SELECTS a day (today preselected); below it
 * sit that day's daily note (open or create) and the notes edited on that
 * day (index mtime window). Nothing opens on a strip tap anymore.
 */
export function TodayScreen({
  vault,
  bump = 0,
  onBack,
  onOpenDate,
  onOpenNote,
}: {
  vault: MobileVault;
  bump?: number;
  onBack?: () => void;
  onOpenDate: (iso: string) => void;
  onOpenNote: (path: string) => void;
}) {
  const { t, i18n: i18nInstance } = useTranslation();
  const days: Date[] = [];
  for (let offset = -27; offset <= 1; offset++) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    days.push(d);
  }
  const todayIso = isoOf(new Date());
  const [selectedIso, setSelectedIso] = useState(todayIso);
  const [dailyExists, setDailyExists] = useState(false);
  const [edited, setEdited] = useState<Array<{ path: string; title: string }>>([]);
  const dailyPath = `${getMobileSettings().dailyFolder}/${selectedIso}.md`;

  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Land on today (the strip starts four weeks back).
    stripRef.current
      ?.querySelector(".is-selected")
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);

  useEffect(() => {
    let stale = false;
    void vault.files.exists(dailyPath).then((yes) => {
      if (!stale) setDailyExists(yes);
    });
    const [y, m, d] = selectedIso.split("-").map(Number);
    const start = new Date(y, m - 1, d).getTime();
    const end = start + 24 * 60 * 60 * 1000;
    if (vault.queryService) {
      void vault.queryService.listNotesModifiedBetween(start, end).then((rows) => {
        if (!stale) setEdited(rows.filter((r) => r.path !== dailyPath));
      });
    }
    return () => {
      stale = true;
    };
  }, [vault, selectedIso, dailyPath, bump]);

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
          const cls =
            `m-datestrip-day${iso === selectedIso ? " is-selected" : ""}` +
            (iso === todayIso ? " is-today" : "");
          return (
            <button aria-pressed={iso === selectedIso} className={cls} key={iso} onClick={() => setSelectedIso(iso)}>
              <span className="m-datestrip-wd">{weekday.format(d)}</span>
              <span className="m-datestrip-num">{d.getDate()}</span>
            </button>
          );
        })}
      </div>

      <button className="m-row" onClick={() => onOpenDate(selectedIso)}>
        {dailyExists ? <Calendar className="m-accent" size={18} /> : <Plus className="m-accent" size={18} />}
        <span>
          {dailyExists ? t("mobile.todayOpenDaily") : t("mobile.todayCreateDaily")}
          <span className="m-soon"> · {selectedIso}</span>
        </span>
        <ChevronRight className="m-chevron" size={18} />
      </button>

      <p className="m-sectionlabel">{t("mobile.todayEdited")}</p>
      {edited.length === 0 ? (
        <p className="m-hint">{t("mobile.todayNothing")}</p>
      ) : (
        edited.map((n) => (
          <button className="m-row" key={n.path} onClick={() => onOpenNote(n.path)}>
            <FileText size={18} />
            <span>{n.title}</span>
          </button>
        ))
      )}
    </div>
  );
}
