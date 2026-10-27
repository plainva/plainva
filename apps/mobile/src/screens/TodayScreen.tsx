import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Browser } from "@capacitor/browser";
import { consumePendingNew, consumeEventSeed } from "@plainva/ui";
import { useTranslation } from "react-i18next";
import { CalendarClock, CalendarDays, FileText, ListTodo, Trash2 } from "lucide-react";
import { doneTasksOnDay, dueTimeOf, errorText, noteDisplayName, setPendingSearchJump, TaskCheckButton, TaskDoneFold, taskDueMovedText, TaskTitle, toast, useDoneFold, useTodayKey, type DuePick, type PlannerRow, type TaskDueChange } from "@plainva/ui";
import { TaskDueSheet } from "../components/TaskDueSheet";
import { announceTaskDue, moveTaskDueOnPhone } from "../services/taskDueAction";
import { loadPhoneDueTasks, taskJumpTerm, tickPhoneDueTask, type PhoneDueTasks } from "../services/dueTasks";
import { buildDayAgenda, minutesToHHMM, buildDayStrip, Button, Chip, dailyNotePathFor, dayWindow, DocIcon, existingDailyNoteDays, GroupCard, ICON, isOpenState, journalToday, RowList, Row, SectionLabel, useJournalDayKey } from "@plainva/ui";
import { isoOf } from "../lib/dates";
import { listShownPimEvents } from "../services/pim/pimService";
import { getMobileSettings } from "../services/mobileSettings";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { useLinkTargetLookup } from "../lib/useLinkTargetLookup";
import { useLongPress } from "../lib/useLongPress";
import { RowActionSheet } from "../components/RowActionSheet";
import { SwipeRow } from "../components/SwipeRow";
import { useTaskRowActions } from "../components/useTaskRowActions";
import { openLink } from "../services/openLink";
import { confirmDeleteFile } from "../lib/deleteFile";
import type { MobileVault } from "../services/vaultService";
import { AppBar } from "../components/AppBar";
import { useEventEditor } from "../components/useEventEditor";
import type { PimEventRow } from "@plainva/core";
import { TodayJournalSection } from "../components/TodayJournalSection";

/** Before the first read, and after one that failed. */
const NO_DUE_TASKS: PhoneDueTasks = { rows: [], dueKey: null, database: false, databaseTickable: false };

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
  onMenu,
  onOpenDate,
  onOpenTasks,
  onOpenJournal,
  onOpenNote,
}: {
  /** Absent when this surface is pushed — the root offers the search. */
  onSearch?: () => void;
  vault: MobileVault;
  bump?: number;
  onBack?: () => void;
  /** App settings in the leading slot of a root surface (N1.5). */
  onMenu?: () => void;
  onOpenDate: (iso: string) => void;
  /** Opens the tasks screen on its "Today" list (planner B1) — what is due and what is late, across both sources. */
  onOpenTasks?: () => void;
  /** Opens the journal screen — "all days" of the journal section (plan Journal, J5). */
  onOpenJournal?: () => void;
  onOpenNote: (path: string) => void;
}) {
  const { t, i18n: i18nInstance } = useTranslation();
  // Both directions (redesign § 3.6). It used to end at TOMORROW, which made
  // the surface a review tool: you could see what you had done and not what is
  // coming. Two weeks each way fits a month of context without an endless rail.
  const days = buildDayStrip(journalToday(), 14, 14);
  // The DIARY day, not the calendar one (plan Journal-Erweiterungen, X1/X2):
  // this screen is where the daily note and the journal section live, and at
  // 01:30 with a 04:00 boundary they are still yesterday's. The calendar tab
  // and every due date keep asking the calendar.
  const todayIso = useJournalDayKey();
  // What is late is asked of the CALENDAR: a due date is a calendar date. On
  // the diary's today, the due section leads with it (`dueTasksForDay`).
  const calendarToday = useTodayKey();
  const [selectedIso, setSelectedIso] = useState(todayIso);
  const [dailyExists, setDailyExists] = useState(false);
  const [dailyDays, setDailyDays] = useState<Set<string>>(new Set());
  const [edited, setEdited] = useState<Array<{ path: string; title: string; mtime_local: number }>>([]);
  const [dayEventItems, setDayEventItems] = useState<Parameters<typeof buildDayAgenda>[1]>([]);
  // The tasks of the vault, both sources — loaded once per change, not per
  // selected day: a tap on the strip only chooses among them (`buildDayAgenda`).
  // Kept with the vault they were read in: after a switch the old vault's rows
  // are not offered for a tick in the new one while the fresh read runs.
  const [dueRead, setDueRead] = useState<{ vault: string; tasks: PhoneDueTasks } | null>(null);
  const dueTasks = dueRead && dueRead.vault === vault.vaultId ? dueRead.tasks : NO_DUE_TASKS;
  // A task's date on this screen is the way to change it (plan Befunde
  // 2026-10-06, W2), as in the tasks screen: the same sheet, the same write,
  // the same notice with Undo. The task then leaves the day it was listed under.
  const [dueTarget, setDueTarget] = useState<PlannerRow | null>(null);
  const [dueTick, setDueTick] = useState(0);
  const moveDue = (changes: readonly TaskDueChange[], pick: DuePick | null) => {
    void moveTaskDueOnPhone(vault, taskDueKey, changes)
      .then((outcome) => {
        setDueTick((x) => x + 1);
        // An undo is confirmed by the row coming back; it needs no second notice.
        if (pick === null) return;
        announceTaskDue(
          outcome,
          { moved: taskDueMovedText(pick), skipped: (count) => t("tasks.dueSkipped", { count }), undo: t("common.undo") },
          (back) => moveDue(back, null),
        );
      })
      .catch((error) => toast.error(errorText(error)));
  };
  // The agenda carries only what a day surface DISPLAYS; opening an appointment
  // needs the whole row, so it is kept beside the list under the same key.
  const [eventRows, setEventRows] = useState<Map<string, PimEventRow>>(new Map());
  const [docIcons, setDocIcons] = useState<Map<string, { icon: string; color?: string }>>(new Map());
  const [sheet, setSheet] = useState<{ path: string; title: string } | null>(null);
  const rowPress = useLongPress<{ path: string; title: string }>((x) => setSheet(x));
  const settings = getMobileSettings();
  // Through the configured format, never hard ISO (Build-91 feedback, P4):
  // a vault set to `YY.MM.DD` had this card say "create" for a note that
  // existed — the tap went the right way and opened it.
  const dailySettings = { folder: settings.dailyFolder, format: settings.dailyFormat };
  const [selY, selM, selD] = selectedIso.split("-").map(Number);
  const dailyPath = dailyNotePathFor(new Date(selY, selM - 1, selD), dailySettings);
  // The same editor the calendar uses (N1.3) — an appointment opens the same
  // way from either surface, including the series question and the RSVPs.
  const editor = useEventEditor({ bump, onOpenNote });
  const taskDueKey = dueTasks.dueKey;
  const agenda = useMemo(
    () => buildDayAgenda(selectedIso, dayEventItems, dueTasks.rows, { today: calendarToday, diaryToday: todayIso }),
    [selectedIso, dayEventItems, dueTasks.rows, calendarToday, todayIso],
  );
  const dayEvents = agenda.filter((i) => i.kind === "event");
  const dayTasks = agenda.filter((i) => i.kind === "task");
  /** A database task's day moves through its date column; a checkbox's through its `📅`. */
  const canMoveDue = (row: PlannerRow) => (row.source === "database" ? taskDueKey !== null : row.line !== undefined);
  /** A task opens where it lives: a checkbox at its line, a database entry as its note. */
  const openTask = (row: PlannerRow) => {
    const term = taskJumpTerm(row);
    if (term) setPendingSearchJump({ path: row.path, term });
    onOpenNote(row.path);
  };
  const tick = (row: PlannerRow) => {
    void tickPhoneDueTask(vault, row)
      .then((result) => {
        setDueTick((x) => x + 1);
        if (result.spawnedDue) toast.info(t("tasks.repeatSpawned", { date: result.spawnedDue }));
        if (result.spawnFailed) toast.error(t("tasks.repeatFailed"));
      })
      // A database tick writes the note's completion property — the sentence a
      // property write gets, as on the task screen; a checkbox says its reason.
      .catch((e) => {
        if (row.source === "database") toast.error(t("mobile.propertyWriteFailed", { message: errorText(e) }));
        else toast.error(errorText(e));
      });
  };
  const reloadDue = useCallback(() => setDueTick((x) => x + 1), []);
  /**
   * What a task under Due can do (E1, 2026-10-24): the same as in the tasks tab
   * — one builder for both lists, so the hold opens the same sheet and the
   * swipe offers the same strip. This screen hands in its own tick, its own way
   * to open a task and its own date sheet.
   */
  const taskRows = useTaskRowActions({
    vault,
    taskDb: settings.taskDatabase.trim(),
    abilities: { databaseTickable: dueTasks.databaseTickable, databaseDue: taskDueKey !== null },
    reloadKey: `${bump}:${dueTick}`,
    open: openTask,
    toggle: tick,
    due: (row) => setDueTarget(row),
    onChanged: reloadDue,
  });
  // What was finished on the selected day (E5), folded under Due. On the
  // diary's today before the vault's day boundary, the calendar's today too —
  // as Due reaches up to it (`dueTasksForDay`).
  const doneOnDay = useMemo(
    () => doneTasksOnDay(dueTasks.rows, selectedIso, selectedIso === todayIso && calendarToday > selectedIso ? calendarToday : selectedIso),
    [dueTasks.rows, selectedIso, todayIso, calendarToday],
  );
  const [doneOpen, toggleDone] = useDoneFold();
  // Links in a task's title open their note (E3), read from the note the task stands in.
  const titleLinks = useMemo(() => ({
    onOpenNote: (target: string, _newTab: boolean, kind?: "wiki" | "markdown", fromPath?: string) => {
      void openLink({ text: target, kind: kind ?? "wiki", sourcePath: fromPath }, { vault, onOpenNote }).catch(() => undefined);
    },
    onOpenUrl: (url: string) => { void Browser.open({ url }).catch(() => undefined); },
  }), [vault, onOpenNote]);
  // A link to a note that does not exist yet reads as unresolved, as in the editor.
  const linkLookup = useLinkTargetLookup(vault, bump);
  /** One task row of Due — open, late or (in the fold) finished. */
  const taskRow = (row: PlannerRow, overdue: boolean, keyPrefix = "") => {
    const closed = !isOpenState(row.state);
    const [dy, dm, dd] = (row.due ?? selectedIso).split("-").map(Number);
    const move = canMoveDue(row) ? () => setDueTarget(row) : undefined;
    const acts = taskRows.capsOf(row);
    return (
      <SwipeRow actions={taskRows.swipeActions(acts)} key={keyPrefix + row.id}>
        <Row
          // The box ticks the task where it is stored (the task
          // screen's write); the row opens it.
          icon={<TaskCheckButton state={row.state} label={closed ? t("tasks.open") : t("tasks.done")} onToggle={() => tick(row)} disabled={row.source === "database" && !dueTasks.databaseTickable} testId="today-task-toggle" />}
          onClick={() => {
            if (taskRows.rowPress.clicked()) openTask(row);
          }}
          onPointerDown={(e: ReactPointerEvent) => taskRows.startRowPress(e, () => taskRows.setTaskSheet(acts))}
          onPointerUp={taskRows.rowPress.clear}
          onPointerLeave={taskRows.rowPress.clear}
          onPointerCancel={taskRows.rowPress.clear}
          // The date is a control of its own (W2): a tap on it opens
          // the date sheet, a tap beside it still opens the task.
          controls
          data-testid="today-task-row"
          data-source={row.source}
          data-state={row.state}
          data-overdue={overdue ? "true" : undefined}
          subtitle={
            <>
              {row.due && (
                <Chip
                  size="sm"
                  tone={overdue ? "warning" : undefined}
                  icon={move ? <CalendarClock size={ICON.meta} /> : undefined}
                  testId="today-task-due"
                  onClick={move}
                >
                  {/* Its own day: late, or — before the day boundary — the calendar's today. */}
                  {row.due !== selectedIso || row.dueMinutes === null
                    ? t("pim.dueOn", { date: longDate.format(new Date(dy, dm - 1, dd)) })
                    : t("pim.dueAt", { defaultValue: "fällig {{time}}", time: minutesToHHMM(row.dueMinutes) })}
                </Chip>
              )}
              {/* A checkbox says which note it lives in, as in the planner. */}
              {row.source === "note" && <Chip size="sm" tone="muted">{noteDisplayName(row.noteTitle ?? row.path)}</Chip>}
            </>
          }
          title={
            <span className={closed ? "pv-planner-closed" : undefined}>
              {row.source === "database" ? noteDisplayName(row.title) : <TaskTitle text={row.title} notePath={row.path} links={titleLinks} linkLookup={linkLookup} />}
            </span>
          }
          wrap
        />
      </SwipeRow>
    );
  };
  /**
   * Where a new appointment starts when it is created from a day rather than
   * from a tapped slot: 09:00 on the SELECTED day, not "now" — on any day but
   * today, "now" would land the event on the wrong date entirely.
   */
  const newEventStart = () => dayWindow(selectedIso).start + 9 * 60 * 60_000;
  // "New term" from the FAB or the palette (Design-Runde E4): the shell opened
  // this tab and parked the request; the editor opens for the selected day —
  // once it knows the writable calendars, or it would find none (E28).
  useEffect(() => consumePendingNew("event", () => editor.openCreate(dayWindow(selectedIso).start + 9 * 60 * 60_000), editor.ready), [editor, selectedIso]);
  // An appointment the assistant drafted and the user opened (AI harness P5-6): the same sheet, with its fields filled
  // in. It waits while a sheet or a preview is open — that one reads its fields once — and opens when it is gone.
  useEffect(() => consumeEventSeed((parked) => editor.openCreateWith(parked), editor.ready && editor.idle), [editor]);
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

  // The strip's dots: the expected path per day, asked of the disk — the
  // same rule as the desktop calendar (P4). A folder listing compared raw
  // file names against ISO keys and never lit under a dotted format.
  useEffect(() => {
    let stale = false;
    void existingDailyNoteDays(days, dailySettings, (p) => vault.files.exists(p))
      .then((set) => {
        if (!stale) setDailyDays(set);
      })
      .catch(() => {
        if (!stale) setDailyDays(new Set());
      });
    return () => {
      stale = true;
    };
    // `days` is rebuilt every render around the same today; the settings decide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vault, settings.dailyFolder, settings.dailyFormat, bump]);

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

  // The day's appointments. Best-effort: a vault without a calendar account
  // simply contributes nothing, and it may not keep the daily note from
  // rendering.
  useEffect(() => {
    let stale = false;
    void (async () => {
      const { start, end } = dayWindow(selectedIso);
      const rows = await listShownPimEvents(start, end).catch(() => []);
      const rowByUid = new Map<string, PimEventRow>();
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
      for (const [i, e] of rows.entries()) rowByUid.set(events[i]!.uid, e);

      if (!stale) {
        setDayEventItems(events);
        setEventRows(rowByUid);
      }
    })();
    return () => {
      stale = true;
    };
  }, [selectedIso, bump, i18nInstance.language]);

  // What is due: both sources — the task database and the checkboxes in notes
  // — the way the planner's Today list reads them (TestFlight, build 136: a
  // checkbox due today was on the planner and missing here). No filtering
  // here: `buildDayAgenda` is the one place that decides what a day shows
  // (due on this day, on today what is late, unfinished).
  useEffect(() => {
    let stale = false;
    void loadPhoneDueTasks(vault)
      .catch(() => NO_DUE_TASKS)
      .then((tasks) => {
        if (!stale) setDueRead({ vault: vault.vaultId, tasks });
      });
    return () => {
      stale = true;
    };
  }, [vault, bump, dueTick]);

  const weekday = new Intl.DateTimeFormat(i18nInstance.language, { weekday: "short" });
  const longDate = new Intl.DateTimeFormat(i18nInstance.language, { day: "numeric", month: "long", year: "numeric" });
  const timeOf = new Intl.DateTimeFormat(i18nInstance.language, { hour: "2-digit", minute: "2-digit" });
  const [sy, sm, sd] = selectedIso.split("-").map(Number);
  const selectedDate = new Date(sy, sm - 1, sd);
  /* The bar says WHICH day is selected (N5.1): the strip shows the choice as a
     highlight, and a highlight cannot say "Sonntag, 2. August". */
  const barDate = new Intl.DateTimeFormat(i18nInstance.language, {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(selectedDate);

  const folderOf = (path: string) => {
    const dir = path.split("/").slice(0, -1).join("/");
    return dir || t("mobile.vaultRoot");
  };

  return (
    <div className="m-page m-page--today" ref={ptrRef}>
      <AppBar large={!onBack} onBack={onBack} onMenu={onMenu} onSearch={onSearch} subtitle={barDate} title={t("mobile.tabToday")} />
      {ptrIndicator}
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
        <Button data-testid={dailyExists ? "today-daily-open" : "today-daily-create"} variant="tonal" onClick={() => onOpenDate(selectedIso)}>
          {dailyExists ? t("mobile.open") : t("mobile.create")}
        </Button>
      </div>

      {/* The journal of the selected day, right under its daily note — that is
          where the entries live (plan Journal, J5). */}
      {onOpenJournal && <TodayJournalSection bump={bump} dayKey={selectedIso} onOpenJournal={onOpenJournal} onOpenNote={onOpenNote} onOpenTasks={onOpenTasks} vault={vault} />}

      {/* Where I have to be, and what I owe — as TWO named sections with
          counters, the way the mockup shows them. They used to be one mixed
          list under a single heading, so "two appointments and three things
          due" read as "five somethings" (Gesamtplan § 3.6).

          Both sections stay when they are empty and offer something, rather
          than the whole block disappearing: a day with nothing on it is an
          answer, and vanishing is not one. The task section used to stand only
          with a task database set; since it reads the checkboxes in notes as
          well, every vault has tasks it can answer for. */}
      <SectionLabel end={dayEvents.length > 0 ? dayEvents.length : undefined}>
        {t("mobile.todayEvents")}
      </SectionLabel>
      {dayEvents.length === 0 ? (
        <GroupCard className="m-daycard-empty">
          <p className="m-hint">{t("mobile.todayNoEvents")}</p>
          {editor.writableCount > 0 && (
            <Button onClick={() => editor.openCreate(newEventStart())} variant="tonal">
              {t("pim.newEvent")}
            </Button>
          )}
        </GroupCard>
      ) : (
        <GroupCard>
          <RowList>
            {dayEvents.map((item) => (
              <Row
                data-testid="pim-event"
                icon={<CalendarDays className="m-accent" size={ICON.head} />}
                key={item.event.uid}
                onClick={() => {
                  const row = eventRows.get(item.event.uid);
                  if (row) void editor.openEvent(row);
                }}
                subtitle={
                  <>
                    <Chip size="sm">{item.event.allDay ? t("pim.allDay") : item.event.timeLabel}</Chip>
                    {item.event.location ? <Chip size="sm">{item.event.location}</Chip> : null}
                  </>
                }
                title={item.event.title}
                wrap
              />
            ))}
          </RowList>
        </GroupCard>
      )}

      <SectionLabel end={dayTasks.length > 0 ? dayTasks.length : undefined}>
        {t("mobile.todayDue")}
      </SectionLabel>
      {/* This card answers for the SELECTED day, from both sources, and on
          today with what is late; the planner's lists go further (upcoming,
          inbox, done). A row, because it leads somewhere. */}
      {onOpenTasks && (
        <GroupCard>
          <RowList>
            <Row data-testid="today-open-planner" icon={<ListTodo size={ICON.head} />} title={t("tasks.plannerOpenToday")} onClick={onOpenTasks} />
          </RowList>
        </GroupCard>
      )}
      {dayTasks.length === 0 && (
        <GroupCard className="m-daycard-empty">
          <p className="m-hint">{t("mobile.todayNoDue")}</p>
        </GroupCard>
      )}
      {(dayTasks.length > 0 || doneOnDay.length > 0) && (
        <GroupCard>
          <RowList>
            {dayTasks.map((item) => taskRow(item.task, item.overdue))}
            {/* What was finished on the day (E5): closed until opened, and the
                device remembers which. A tick in the fold takes the task back
                up to Due. */}
            {doneOnDay.length > 0 && <TaskDoneFold count={doneOnDay.length} open={doneOpen} onToggle={toggleDone} />}
            {doneOpen && doneOnDay.map((row) => taskRow(row, false, "done:"))}
          </RowList>
        </GroupCard>
      )}

      {/* No counter here, unlike the two above: those answer "how much is on
          this day", and this one is a log whose length says nothing. */}
      <SectionLabel>{t("mobile.todayEdited")}</SectionLabel>
      {edited.length === 0 ? (
        <GroupCard className="m-daycard-empty">
          <p className="m-hint">{t("mobile.todayNothing")}</p>
        </GroupCard>
      ) : (
        <GroupCard>
          <RowList>
            {edited.map((n) => (
              <Row
                icon={
                  docIcons.get(n.path) ? (
                    <DocIcon color={docIcons.get(n.path)!.color} icon={docIcons.get(n.path)!.icon} size={ICON.head} />
                  ) : (
                    <FileText className="m-accent" size={ICON.head} />
                  )
                }
                key={n.path}
                onClick={() => { if (rowPress.clicked()) onOpenNote(n.path); }}
                onContextMenu={(e: React.MouseEvent) => { e.preventDefault(); setSheet(n); }}
                onPointerCancel={rowPress.clear}
                onPointerDown={() => rowPress.start(n)}
                onPointerLeave={rowPress.clear}
                onPointerUp={rowPress.clear}
                subtitle={
                  <>
                    <Chip size="sm">{folderOf(n.path)}</Chip>
                    <Chip size="sm">{timeOf.format(new Date(n.mtime_local))}</Chip>
                  </>
                }
                title={n.title}
                wrap
              />
            ))}
          </RowList>
        </GroupCard>
      )}
      {dueTarget && (
        <TaskDueSheet
          value={dueTarget.due}
          time={dueTimeOf(dueTarget.dueMinutes)}
          timeAllowed={dueTarget.source === "database"}
          onClose={() => setDueTarget(null)}
          onPick={(pick) => {
            const target = dueTarget;
            setDueTarget(null);
            if (pick.day === target.due && (target.source !== "database" || pick.time === dueTimeOf(target.dueMinutes))) return;
            // Each source the way it stores its day: the date column of a
            // database entry (with its time), the `📅` of a checkbox line (`applyTaskDueChanges`).
            if (target.source === "database") moveDue([{ source: "database", path: target.path, day: pick.day, time: pick.time }], pick);
            else if (target.line) moveDue([{ source: "note", path: target.path, task: target.line, day: pick.day }], pick);
          }}
        />
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

      {taskRows.element}
      {editor.element}
    </div>
  );
}
