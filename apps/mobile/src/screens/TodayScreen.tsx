import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, FileText, Trash2 } from "lucide-react";
import { DocIcon } from "@plainva/ui";
import { isoOf } from "../lib/dates";
import { getMobileSettings } from "../services/mobileSettings";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { useLongPress } from "../lib/useLongPress";
import { RowActionSheet } from "../components/RowActionSheet";
import { confirmDeleteFile } from "../lib/deleteFile";
import type { MobileVault } from "../services/vaultService";

/**
 * Today tab as a day view (R3.5; M3E mockup 6): the strip SELECTS a day
 * (today preselected, dots mark days with an existing daily note); below it
 * a daily-note card (template + folder line, open/create) and the notes
 * edited on that day (index mtime window, folder · time meta).
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
  const [dailyDays, setDailyDays] = useState<Set<string>>(new Set());
  const [edited, setEdited] = useState<Array<{ path: string; title: string; mtime_local: number }>>([]);
  const [docIcons, setDocIcons] = useState<Map<string, { icon: string; color?: string }>>(new Map());
  const [sheet, setSheet] = useState<{ path: string; title: string } | null>(null);
  const rowPress = useLongPress<{ path: string; title: string }>((x) => setSheet(x));
  const settings = getMobileSettings();
  const dailyPath = `${settings.dailyFolder}/${selectedIso}.md`;
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef);

  const stripRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // Land on today (the strip starts four weeks back). Runs before paint so the
    // strip is already centered when the enter animation plays — a post-paint
    // scroll fought the animation and read as a bounce (maintainer).
    stripRef.current
      ?.querySelector(".is-selected")
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, []);

  // One folder listing marks every strip day that has a daily note (mockup dots).
  useEffect(() => {
    let stale = false;
    void vault.files
      .listDir(settings.dailyFolder)
      .then((entries) => {
        if (stale) return;
        setDailyDays(new Set(entries.filter((e) => !e.isDirectory).map((e) => e.name.replace(/\.md$/, ""))));
      })
      .catch(() => {
        if (!stale) setDailyDays(new Set());
      });
    return () => {
      stale = true;
    };
  }, [vault, settings.dailyFolder, bump]);

  useEffect(() => {
    let stale = false;
    // Custom note icons (desktop tree parity) — same source as Home/folders.
    void vault.queryService
      ?.getDocumentIcons()
      .then((m) => {
        if (!stale) setDocIcons(m);
      })
      .catch(() => {});
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
  const longDate = new Intl.DateTimeFormat(i18nInstance.language, { day: "numeric", month: "long", year: "numeric" });
  const timeOf = new Intl.DateTimeFormat(i18nInstance.language, { hour: "2-digit", minute: "2-digit" });
  const [sy, sm, sd] = selectedIso.split("-").map(Number);
  const selectedDate = new Date(sy, sm - 1, sd);
  const folderOf = (path: string) => {
    const dir = path.split("/").slice(0, -1).join("/");
    return dir || t("mobile.vaultRoot");
  };

  return (
    <div className="m-page m-page--today" ref={ptrRef}>
      {ptrIndicator}
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
              {dailyDays.has(iso) ? <span className="m-datestrip-dot" /> : <span className="m-datestrip-dot is-off" />}
            </button>
          );
        })}
      </div>

      <div className="m-bigcard">
        <h4>
          {t("mobile.todayDailyCard")} · {longDate.format(selectedDate)}
        </h4>
        <p>
          {settings.dailyTemplate
            ? `${t("mobile.todayFromTemplate", { name: settings.dailyTemplate.replace(/\.md$/, "") })} · ${t("mobile.todayInFolder", { folder: settings.dailyFolder })}`
            : t("mobile.todayInFolder", { folder: settings.dailyFolder })}
        </p>
        <button className="m-btn m-btn--tonal" onClick={() => onOpenDate(selectedIso)}>
          {dailyExists ? t("mobile.open") : t("mobile.create")}
        </button>
      </div>

      <p className="m-sectionlabel">{t("mobile.todayEdited")}</p>
      {edited.length === 0 ? (
        <p className="m-hint">{t("mobile.todayNothing")}</p>
      ) : (
        edited.map((n) => (
          <button
            className="m-row"
            key={n.path}
            onClick={() => { if (rowPress.clicked()) onOpenNote(n.path); }}
            onContextMenu={(e) => { e.preventDefault(); setSheet(n); }}
            onPointerCancel={rowPress.clear}
            onPointerDown={() => rowPress.start(n)}
            onPointerLeave={rowPress.clear}
            onPointerUp={rowPress.clear}
          >
            {docIcons.get(n.path) ? (
              <span className="m-rowicon">
                <DocIcon color={docIcons.get(n.path)!.color} icon={docIcons.get(n.path)!.icon} size={20} />
              </span>
            ) : (
              <FileText className="m-accent" size={18} />
            )}
            <span className="m-row-txt">
              <b>{n.title}</b>
              <span>
                {folderOf(n.path)} · {timeOf.format(new Date(n.mtime_local))}
              </span>
            </span>
          </button>
        ))
      )}
      {sheet && (
        <RowActionSheet
          title={sheet.title}
          onClose={() => setSheet(null)}
          actions={[
            { icon: <FileText size={18} />, label: t("mobile.sheetOpen"), onClick: () => { const s = sheet; setSheet(null); onOpenNote(s.path); } },
            { icon: <Trash2 size={18} />, label: t("common.delete"), danger: true, onClick: () => { const s = sheet; setSheet(null); void confirmDeleteFile(vault, s.path, s.title, t); } },
          ]}
        />
      )}
    </div>
  );
}
