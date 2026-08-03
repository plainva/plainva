import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, CheckSquare, FileText, Square, Trash2 } from "lucide-react";
import { type AgendaTask, buildDayAgenda, buildDayStrip, Button, dayWindow, DocIcon, ICON, parseBaseConfig, resolveTaskCompletionModel, taskDbRows } from "@plainva/ui";
import { isoOf } from "../lib/dates";
import { listPimEvents } from "../services/pim/pimService";
import { getMobileSettings } from "../services/mobileSettings";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { useLongPress } from "../lib/useLongPress";
import { RowActionSheet } from "../components/RowActionSheet";
import { confirmDeleteFile } from "../lib/deleteFile";
import { vaultOps, type MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";

/**
 * Today tab as a day view (R3.5; M3E mockup 6): the strip SELECTS a day
 * (today preselected, dots mark days with an existing daily note); below it
 * a daily-note card (template + folder line, open/create) and the notes
 * edited on that day (index mtime window, folder · time meta).
 *
 * S32 makes it an actual DAY rather than a file listing with a date on it:
 * the day's appointments and the tasks due on it sit between the daily note
 * and the edit log, in the one order both shells agree on (`buildDayAgenda`).
 * A day surface that omits where you have to be answers half the question.
 */
export function TodayScreen({
  onSearch,
  vault,
  bump = 0,
  onBack,
  onOpenDate,
  onOpenNote,
}: {
  /** Absent when this surface is pushed — the root offers the search. */
  onSearch?: () => void;
  vault: MobileVault;
  bump?: number;
  onBack?: () => void;
  onOpenDate: (iso: string) => void;
  onOpenNote: (path: string) => void;
}) {
  const { t, i18n: i18nInstance } = useTranslation();
  // Both directions (redesign § 3.6). It used to end at TOMORROW, which made
  // the surface a review tool: you could see what you had done and not what is
  // coming. Two weeks each way fits a month of context without an endless rail.
  const days = buildDayStrip(new Date(), 14, 14);
  const todayIso = isoOf(new Date());
  const [selectedIso, setSelectedIso] = useState(todayIso);
  const [dailyExists, setDailyExists] = useState(false);
  const [dailyDays, setDailyDays] = useState<Set<string>>(new Set());
  const [edited, setEdited] = useState<Array<{ path: string; title: string; mtime_local: number }>>([]);
  const [agenda, setAgenda] = useState<ReturnType<typeof buildDayAgenda>>([]);
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

  // The day's appointments and what is due on it. Both are best-effort: a vault
  // without a calendar account or without a task database simply contributes
  // nothing, and neither may keep the daily note from rendering.
  useEffect(() => {
    let stale = false;
    void (async () => {
      const { start, end } = dayWindow(selectedIso);
      const rows = await listPimEvents(start, end).catch(() => []);
      const events = rows.map((e) => ({
        uid: `${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`,
        title: e.title,
        allDay: e.allDay,
        startMs: e.start.ts,
        timeLabel: e.allDay
          ? ""
          : new Intl.DateTimeFormat(i18nInstance.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(e.start.ts)),
        location: e.location,
      }));

      let due: AgendaTask[] = [];
      const db = getMobileSettings().taskDatabase.trim();
      if (db && vault.queryService) {
        try {
          const config = parseBaseConfig(await vaultOps.read(vault, db));
          const raw = (await vault.queryService.queryDatabaseFiles(config)) as Record<string, unknown>[];
          const completion = resolveTaskCompletionModel(config);
          // No filtering here: `buildDayAgenda` is the one place that decides
          // what a day shows (due on this day, unfinished unless asked).
          due = taskDbRows(raw, config, completion);
        } catch {
          due = [];
        }
      }
      if (!stale) setAgenda(buildDayAgenda(selectedIso, events, due));
    })();
    return () => {
      stale = true;
    };
  }, [vault, selectedIso, bump, i18nInstance.language]);

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
      <AppBar large={!onBack} onBack={onBack} onSearch={onSearch} title={t("mobile.tabToday")} />
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

      <div className="pv-card m-bigcard">
        <h4>
          {t("mobile.todayDailyCard")} · {longDate.format(selectedDate)}
        </h4>
        <p>
          {settings.dailyTemplate
            ? `${t("mobile.todayFromTemplate", { name: settings.dailyTemplate.replace(/\.md$/, "") })} · ${t("mobile.todayInFolder", { folder: settings.dailyFolder })}`
            : t("mobile.todayInFolder", { folder: settings.dailyFolder })}
        </p>
        <Button variant="tonal" onClick={() => onOpenDate(selectedIso)}>
          {dailyExists ? t("mobile.open") : t("mobile.create")}
        </Button>
      </div>

      {/* Where I have to be, and what I owe — between what I wrote and what I
          touched. Empty on a vault with neither a calendar nor a task database,
          and then this section simply is not there. */}
      {agenda.length > 0 && (
        <>
          <p className="m-sectionlabel">{t("mobile.todayAgenda")}</p>
          <div className="pv-card m-card">
            {agenda.map((item) =>
              item.kind === "event" ? (
                <div className="m-row" key={item.event.uid}>
                  <CalendarDays className="m-accent" size={ICON.head} />
                  <span className="m-row-txt">
                    <b>{item.event.title}</b>
                    <span>
                      {item.event.allDay ? t("pim.allDay") : item.event.timeLabel}
                      {item.event.location ? ` · ${item.event.location}` : ""}
                    </span>
                  </span>
                </div>
              ) : (
                <button
                  className="m-row"
                  key={item.task.path}
                  onClick={() => onOpenNote(item.task.path)}
                >
                  {item.task.done ? <CheckSquare className="m-accent" size={ICON.head} /> : <Square size={ICON.head} />}
                  <span className="m-row-txt">
                    <b>{item.task.title}</b>
                    <span>{t("pim.dueOn", { date: longDate.format(selectedDate) })}</span>
                  </span>
                </button>
              )
            )}
          </div>
        </>
      )}

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
                <DocIcon color={docIcons.get(n.path)!.color} icon={docIcons.get(n.path)!.icon} size={ICON.head} />
              </span>
            ) : (
              <FileText className="m-accent" size={ICON.head} />
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
            { icon: <FileText size={ICON.head} />, label: t("mobile.sheetOpen"), onClick: () => { const s = sheet; setSheet(null); onOpenNote(s.path); } },
            { icon: <Trash2 size={ICON.head} />, label: t("common.delete"), danger: true, onClick: () => { const s = sheet; setSheet(null); void confirmDeleteFile(vault, s.path, s.title, t); } },
          ]}
        />
      )}
    </div>
  );
}
