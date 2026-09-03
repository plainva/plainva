import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarRange, CheckSquare, ChevronLeft, Diamond, ChevronRight, Link2, ListChecks, MapPin, Plus, RefreshCw, Repeat, Square, Users } from "lucide-react";
import { buildInviteIcs } from "@plainva/ui/mail";
import { utf8ToBase64 } from "@plainva/ui/mail";
import { listMailAccounts } from "@plainva/ui/mail";
import { errorText, applyEventChanges, chunkWeeks, describeEventChanges, buildContiguousDays, buildMonthCells, buildWeekCells, Button, createCalendarEvent, draftToRow, layoutSpanningEvents, sameEventRef, updateCalendarEvent, EmptyState, ICON, IconButton, markdownToHtml, minutesToHHMM, Segmented, startOfMonth, toast, writeNoteProperty, loadBaseOverlay, overlayCandidates, overlayKey, type OverlayCandidate, type OverlayEntry, type WeekStartDay, logDiagnostic } from "@plainva/ui";
import { PimConflictError, parseRRule, type PimAccountRow, type PimEventRow, type PimCalendar, type PimEventDraft } from "@plainva/core";
import type { EventChange } from "@plainva/ui";
import { useVault, meetingFolderKey, DEFAULT_MEETING_FOLDER, defaultCalendarKey } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { getTaskDatabasePath } from "../../services/taskDatabase";
import { loadCalendarOverlays, saveCalendarOverlays } from "../../services/pim/calendarOverlays";
import { loadTaskOverlay, type DueTask } from "../../services/pim/taskOverlay";
import { toggleTaskDone } from "../../services/taskCompletion";
import type { TaskCompletionModel } from "../../services/taskDatabase";
import { CALENDAR_GOTO_EVENT, consumePendingCalendarDay } from "../../services/pim/calendarNav";
import { getWeekStartSetting, weekStartDayOf, WEEK_START_CHANGED_EVENT } from "@plainva/ui";
import { localIsoKey } from "@plainva/ui";
import { isAuthorizationFailure, runCalendarBlocks } from "../../services/pim/blockCalendars";
import { eventStateClass, eventStateLabelKey, eventVisualState } from "@plainva/ui";
import { applyIndexChanges } from "../../services/fileActions";
import { appConfirm } from "../../services/appDialogs";
import { activeDocument } from "../../services/activeDocument";
import { CALENDAR_TAB_PATH } from "../graph/virtualPaths";
import {
  bucketEventsByDay,
  emptyEventForm,
  eventDisplayTitle,
  eventFormFromEvent,
  eventFormToDraft,
  eventStartDayKey,
  eventDayKeys,
  formatTimeRange,
  buildBlockDraft,
  buildEditCalendarOptions,
  linkCalendarBlocks,
  type EventFormValues,
} from "../../services/pim/calendarModel";
import { resolveOrCreateMeetingNote } from "../../services/pim/meetingNote";
import { BasePeekModal } from "../BasePeekModal";
import { EventEditModal } from "./EventEditModal";
import { EventContextMenu } from "./EventContextMenu";
import { EventPeek } from "./EventPeek";
import { BlockCalendarsModal } from "./BlockCalendarsModal";
import { SeriesScopeModal } from "./SeriesScopeModal";
import { DayTimeGrid } from "./DayTimeGrid";
import { QuickCreatePopover, type QuickCreateValues } from "./QuickCreatePopover";

/**
 * Calendar tab (PIM stage 2c, virtual path plainva://calendar): a month grid
 * over the CACHED events of every connected account plus a day pane listing
 * the selected day. Strictly read-only in this stage — the one write action is
 * "Termin → Meeting-Notiz", which creates a NORMAL vault note anchored to the
 * event (see services/pim/meetingNote.ts). Data refresh rides the pim window
 * events; the manual refresh button triggers a worker cycle.
 */

/** One month-grid bar lane: the bar itself plus the gap under it. */
const MONTH_BAR_H = 18;

const DAY_MS = 24 * 60 * 60 * 1000;

interface CalendarViewProps {
  onOpenPath: (path: string, newTab?: boolean) => void;
  /** Whether this pane is the focused one — only then does the calendar publish
   * its status-bar info line (so a background split pane never clobbers it). */
  isActivePane?: boolean;
}

type CalRow = PimCalendar & { accountId: string; selected: boolean };

type CalTask = DueTask;

const SHOW_TASKS_KEY = "plainva-calendar-show-tasks";
const VIEW_MODE_KEY = "plainva-calendar-view";

type CalViewMode = "day" | "3day" | "week" | "month" | "agenda";
const ALL_VIEW_MODES: CalViewMode[] = ["day", "3day", "week", "month", "agenda"];
const DAY_MS_LOCAL = 24 * 60 * 60 * 1000;
const AGENDA_DAYS = 60;

/* draftToRow / sameEventRef live in @plainva/ui since S24 — both shells write
 * events the same way, so the optimistic row is the same row. */

export function CalendarView({ onOpenPath, isActivePane = true }: CalendarViewProps) {
  const { t, i18n } = useTranslation();
  const { pimRuntime, vaultAdapter, vaultPath, indexer, triggerFileTreeUpdate, queryService, fileTreeVersion } = useVault();

  const todayKey = localIsoKey(new Date());
  const tomorrowKey = ((): string => {
    const [ty, tm, td] = todayKey.split("-").map(Number);
    return localIsoKey(new Date(ty ?? 1970, (tm ?? 1) - 1, (td ?? 1) + 1));
  })();
  // Per-minute "now" so past events dim live (Google-Calendar style) without a
  // re-query; the value drives only presentation.
  const [nowTs, setNowTs] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTs(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);
  const isPast = useCallback((e: PimEventRow) => e.end.ts <= nowTs, [nowTs]);
  const [viewDate, setViewDate] = useState(() => startOfMonth(new Date()));
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const [viewMode, setViewMode] = useState<CalViewMode>(() => {
    try {
      const v = localStorage.getItem(VIEW_MODE_KEY);
      return (ALL_VIEW_MODES as string[]).includes(v ?? "") ? (v as CalViewMode) : "month";
    } catch {
      return "month";
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
      /* preference simply doesn't persist */
    }
  }, [viewMode]);
  // App-wide first-day-of-week (settings; shared with the sidebar widget).
  const [weekStartDay, setWeekStartDay] = useState<WeekStartDay>(1);
  useEffect(() => {
    let alive = true;
    const load = () =>
      void getWeekStartSetting()
        .then((s) => {
          if (alive) setWeekStartDay(weekStartDayOf(s));
        })
        .catch(() => {});
    load();
    window.addEventListener(WEEK_START_CHANGED_EVENT, load);
    return () => {
      alive = false;
      window.removeEventListener(WEEK_START_CHANGED_EVENT, load);
    };
  }, []);
  const [accounts, setAccounts] = useState<PimAccountRow[]>([]);
  const [calendars, setCalendars] = useState<CalRow[]>([]);
  const [events, setEvents] = useState<PimEventRow[]>([]);
  const [status, setStatus] = useState<{ status: string; message?: string }>({ status: "idle" });
  const [tick, setTick] = useState(0);
  // Optional: overlay the standard task database's due-dated tasks (device-local
  // view preference, like the graph pins). Only offered when a task DB exists.
  const [hasTaskDb, setHasTaskDb] = useState(false);
  const [taskError, setTaskError] = useState<string | null>(null);
  const [showTasks, setShowTasks] = useState(() => {
    try {
      return localStorage.getItem(SHOW_TASKS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [tasks, setTasks] = useState<CalTask[]>([]);
  // The database's completion model + date column, so a checkbox here can WRITE
  // the flip back through the shared path (issue #34, wave 4).
  const [taskCompletion, setTaskCompletion] = useState<TaskCompletionModel | null>(null);
  const [taskDueKey, setTaskDueKey] = useState<string | null>(null);

  // Database views shown alongside the appointments (S18, plan P9a). The
  // SELECTION is a vault setting, not a device preference: the calendar of one
  // vault should look the same on both machines, and the settings profile
  // carries it (`calendarOverlays`).
  const [overlayCands, setOverlayCands] = useState<OverlayCandidate[]>([]);
  const [overlayKeys, setOverlayKeys] = useState<string[]>([]);
  const [overlayEntries, setOverlayEntries] = useState<OverlayEntry[]>([]);
  const [draggingOverlay, setDraggingOverlay] = useState<OverlayEntry | null>(null);
  /** An overlay entry opens the preview a database entry already has — it looks,
   * it does not edit, exactly like the event preview from S2. */
  const [peekPath, setPeekPath] = useState<string | null>(null);

  const selectedDate = useMemo(() => {
    const [y, m, d] = selectedDay.split("-").map(Number);
    return new Date(y, (m ?? 1) - 1, d ?? 1);
  }, [selectedDay]);

  const { cells, gridDays, rangeStartTs, rangeEndTs } = useMemo(() => {
    // The queried cache window follows the view: a day, three days, the
    // selected week, the month grid, or the rolling agenda range (today .. +60d).
    if (viewMode === "day" || viewMode === "3day") {
      const dd = buildContiguousDays(selectedDate, viewMode === "3day" ? 3 : 1);
      return { cells: [] as Date[], gridDays: dd, rangeStartTs: dd[0].getTime(), rangeEndTs: dd[dd.length - 1].getTime() + DAY_MS };
    }
    if (viewMode === "week") {
      const wk = buildWeekCells(selectedDate, weekStartDay);
      return { cells: [] as Date[], gridDays: wk, rangeStartTs: wk[0].getTime(), rangeEndTs: wk[6].getTime() + DAY_MS };
    }
    if (viewMode === "agenda") {
      const today = new Date();
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      return { cells: [] as Date[], gridDays: [] as Date[], rangeStartTs: start.getTime(), rangeEndTs: start.getTime() + AGENDA_DAYS * DAY_MS_LOCAL };
    }
    const grid = buildMonthCells(viewDate, weekStartDay);
    return { cells: grid, gridDays: [] as Date[], rangeStartTs: grid[0].getTime(), rangeEndTs: grid[grid.length - 1].getTime() + DAY_MS };
  }, [viewMode, viewDate, selectedDate, weekStartDay]);

  // Sidebar calendar hand-off: "show this day in the calendar tab". A freshly
  // mounting tab consumes the parked day (the event fired before the listener
  // existed); an already-open tab reacts to the event directly.
  useEffect(() => {
    const applyDay = (key: unknown) => {
      if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return;
      setSelectedDay(key);
      const [y, m] = key.split("-").map(Number);
      setViewDate(new Date(y, (m ?? 1) - 1, 1));
    };
    applyDay(consumePendingCalendarDay());
    const onGoto = (e: Event) => applyDay((e as CustomEvent).detail?.dayKey);
    window.addEventListener(CALENDAR_GOTO_EVENT, onGoto);
    return () => window.removeEventListener(CALENDAR_GOTO_EVENT, onGoto);
  }, []);

  // Cache re-query: worker cycles announce fresh data over the window event.
  useEffect(() => {
    const onChanged = () => setTick((v) => v + 1);
    const onStatus = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d && typeof d.status === "string") setStatus({ status: d.status, message: d.message });
    };
    window.addEventListener("plainva-pim-changed", onChanged);
    window.addEventListener("plainva-pim-status", onStatus);
    return () => {
      window.removeEventListener("plainva-pim-changed", onChanged);
      window.removeEventListener("plainva-pim-status", onStatus);
    };
  }, []);

  useEffect(() => {
    let stale = false;
    (async () => {
      if (!pimRuntime) return;
      try {
        const [acc, cals, evs] = await Promise.all([
          pimRuntime.cache.listAccounts(),
          pimRuntime.cache.listCalendars(),
          pimRuntime.cache.listEvents(rangeStartTs, rangeEndTs),
        ]);
        if (stale) return;
        setAccounts(acc);
        setCalendars(cals);
        setEvents(evs);
      } catch {
        /* cache unreadable — leave the previous state */
      }
    })();
    return () => {
      stale = true;
    };
  }, [pimRuntime, rangeStartTs, rangeEndTs, tick]);

  // Does a standard task database exist? (Only then is the toggle offered.)
  useEffect(() => {
    let alive = true;
    if (!vaultPath) {
      setHasTaskDb(false);
      return;
    }
    getTaskDatabasePath(vaultPath)
      .then((p) => {
        if (alive) setHasTaskDb(!!p);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [vaultPath]);

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_TASKS_KEY, showTasks ? "1" : "0");
    } catch {
      /* private mode — the preference simply doesn't persist */
    }
  }, [showTasks]);

  // Task overlay: due-dated rows of the standard task database, classified with
  // the SAME shared status model the reconciler uses (so "done" is consistent).
  useEffect(() => {
    let alive = true;
    if (!showTasks || !vaultPath || !queryService || !vaultAdapter) {
      setTasks([]);
      return;
    }
    void (async () => {
      try {
        const out = await loadTaskOverlay({ vaultPath, vaultAdapter, queryService });
        if (alive) {
          setTasks(out.tasks);
          setTaskCompletion(out.completion);
          setTaskDueKey(out.dueKey);
          setTaskError(null);
        }
      } catch (err) {
        // S18: the tasks simply vanished from the grid. A calendar missing its
        // tasks looks exactly like a calendar with none — nothing on screen
        // distinguished a failed query from an empty week.
        if (alive) { setTasks([]); setTaskError(errorText(err)); }
      }
    })();
    return () => {
      alive = false;
    };
  }, [showTasks, vaultPath, queryService, vaultAdapter, fileTreeVersion, tick]);

  // Which database views COULD be shown, and which are. The candidates are read
  // from the databases themselves (a view qualifies when it is a calendar or a
  // timeline AND names its date column); the selection comes from the settings
  // profile so both machines show the same calendar.
  useEffect(() => {
    let alive = true;
    if (!vaultPath || !queryService || !vaultAdapter) {
      setOverlayCands([]);
      return;
    }
    void (async () => {
      try {
        const bases = await queryService.listBases();
        const out: OverlayCandidate[] = [];
        for (const b of bases) {
          try {
            out.push(...overlayCandidates(b.path, b.title, await vaultAdapter.readTextFile(b.path)));
          } catch {
            /* one unreadable database costs its own views, not the bar */
          }
        }
        if (alive) setOverlayCands(out);
      } catch {
        if (alive) setOverlayCands([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [vaultPath, queryService, vaultAdapter, fileTreeVersion]);

  // The stored selection is read ONCE per vault. Without the guard the async
  // read can land AFTER a click and quietly undo it — the settings store is
  // slower than the user.
  const overlaysHydrated = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!vaultPath || overlaysHydrated.current === vaultPath) return;
    void loadCalendarOverlays(vaultPath)
      .then((keys) => {
        if (!alive || overlaysHydrated.current === vaultPath) return;
        overlaysHydrated.current = vaultPath;
        setOverlayKeys(keys);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [vaultPath]);

  useEffect(() => {
    let alive = true;
    if (overlayKeys.length === 0 || !vaultPath || !queryService || !vaultAdapter) {
      setOverlayEntries([]);
      return;
    }
    void (async () => {
      try {
        const bases = await queryService.listBases();
        const rows = await loadBaseOverlay(overlayKeys, bases, { vaultAdapter, queryService });
        if (alive) setOverlayEntries(rows);
      } catch {
        if (alive) setOverlayEntries([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [overlayKeys, vaultPath, queryService, vaultAdapter, fileTreeVersion, tick]);

  const toggleOverlay = useCallback(
    (key: string) => {
      overlaysHydrated.current = vaultPath ?? null;
      setOverlayKeys((prev) => {
        const next = prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key];
        if (vaultPath) void saveCalendarOverlays(vaultPath, next).catch(() => {});
        return next;
      });
    },
    [vaultPath]
  );

  /** Entries by day — same shape the task overlay uses, so the cells merge them. */
  const overlayByDay = useMemo(() => {
    const map = new Map<string, OverlayEntry[]>();
    for (const e of overlayEntries) {
      const list = map.get(e.day) ?? [];
      list.push(e);
      map.set(e.day, list);
    }
    for (const list of map.values()) list.sort((a, b) => (a.minutes ?? -1) - (b.minutes ?? -1) || a.title.localeCompare(b.title));
    return map;
  }, [overlayEntries]);

  /** Dragging an entry to another day writes its date column (plan P9a). The
   * write goes through the SAME helper the table's cell editor uses. */
  const moveOverlayEntry = useCallback(
    async (entry: OverlayEntry, day: string) => {
      if (!vaultAdapter || day === entry.day) return;
      // Optimistic: the calendar shows the new day at once, the re-index trues it up.
      setOverlayEntries((prev) => prev.map((e) => (e.path === entry.path && e.basePath === entry.basePath ? { ...e, day } : e)));
      try {
        await writeNoteProperty(vaultAdapter, entry.path, entry.dateField, day);
        if (indexer) await applyIndexChanges(indexer, { added: [entry.path] });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
        setOverlayEntries((prev) => prev.map((x) => (x.path === entry.path && x.basePath === entry.basePath ? { ...x, day: entry.day } : x)));
      }
    },
    [vaultAdapter, indexer]
  );

  /**
   * Ticking a task off from the calendar (issue #34, wave 4). It writes through
   * `services/taskCompletion` — the same path the Tasks overview uses — because
   * the gesture is more than a frontmatter flip: it re-indexes, nudges the PIM
   * worker so a mirrored provider task is pushed, and creates the next
   * occurrence of a repeating task. A second implementation would drift, and a
   * drift can un-complete a remote task.
   */
  const toggleTaskFromCalendar = useCallback(
    (task: CalTask) => {
      if (!vaultAdapter || !taskCompletion) return;
      const done = !task.done;
      // Optimistic: the row answers immediately, the reload confirms it.
      setTasks((prev) => prev.map((x) => (x.path === task.path ? { ...x, done } : x)));
      void (async () => {
        try {
          const result = await toggleTaskDone(
            {
              vaultAdapter,
              indexer,
              triggerFileTreeUpdate,
              pimRuntime,
              onChanged: () => setTick((x) => x + 1),
              completion: taskCompletion,
              dueKey: taskDueKey,
            },
            task.path,
            done
          );
          if (result.spawnedDue) {
            toast.info(t("tasks.repeatSpawned", { defaultValue: "Nächste Fälligkeit: {{date}}", date: result.spawnedDue }));
          } else if (result.spawnFailed) {
            toast.error(t("tasks.repeatFailed", { defaultValue: "Die nächste Aufgabe konnte nicht angelegt werden." }));
          }
        } catch (e) {
          console.error("[CalendarView] toggling a task failed", task.path, e);
          setTasks((prev) => prev.map((x) => (x.path === task.path ? { ...x, done: task.done } : x)));
          toast.error(t("tasks.statusUpdateFailed", { defaultValue: "Status konnte nicht geändert werden." }));
        }
      })();
    },
    [vaultAdapter, taskCompletion, taskDueKey, indexer, triggerFileTreeUpdate, pimRuntime, t]
  );

  /**
   * Time appearance of a task, which is the INVERSE of an event's (issue #34,
   * wave 4). A past event is over, so it dims; an overdue task is more urgent,
   * not less. Events keep `isPast` — this scale belongs to tasks alone, and it
   * is identical in the month grid and the agenda.
   */
  const taskTone = useCallback(
    (task: CalTask): { color: string; opacity: number } => {
      if (task.done) return { color: "var(--text-muted)", opacity: 0.65 };
      if (task.due < todayKey) return { color: "var(--warning-text)", opacity: 1 };
      if (task.due === todayKey) return { color: "var(--text-main)", opacity: 1 };
      return { color: "var(--text-muted)", opacity: 0.75 };
    },
    [todayKey]
  );

  const tasksByDay = useMemo(() => {
    const m = new Map<string, CalTask[]>();
    for (const task of tasks) {
      const arr = m.get(task.due);
      if (arr) arr.push(task);
      else m.set(task.due, [task]);
    }
    return m;
  }, [tasks]);

  // Month cell density: how many event/task lines fit a cell is derived from the
  // MEASURED row height (the grid fills the pane), so a tall window shows more
  // rows before collapsing the rest into "+N" instead of a hardcoded cap of 3.
  const monthGridRef = useRef<HTMLDivElement | null>(null);
  const [maxCellItems, setMaxCellItems] = useState(3);
  const monthRows = Math.max(1, Math.round(cells.length / 7));

  useLayoutEffect(() => {
    const el = monthGridRef.current;
    if (!el || viewMode !== "month" || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const rowH = el.clientHeight / monthRows;
      // day number (~16px) + "+N" reserve (~14px); each line ~16px.
      setMaxCellItems(Math.max(1, Math.min(12, Math.floor((rowH - 30) / 16))));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode, monthRows]);

  const linkedEvents = useMemo(() => linkCalendarBlocks(events), [events]);
  const byDay = useMemo(() => bucketEventsByDay(linkedEvents), [linkedEvents]);

  /**
   * Multi-day events, laid out per week row (S5).
   *
   * They used to be drawn once per day they touched — three chips for one trip,
   * each with its own title, none of them knowing about the others. Now the row
   * decides: one bar, one label, one click target, cut at the week edge.
   */
  const monthSpans = useMemo(() => {
    if (viewMode !== "month") return [];
    return chunkWeeks(cells).map((week) =>
      layoutSpanningEvents(
        week.map(localIsoKey),
        linkedEvents,
        { keysOf: eventDayKeys },
      ),
    );
  }, [viewMode, cells, linkedEvents]);
  /** Every event already drawn as a bar — a cell must not repeat it as a chip. */
  const spannedEvents = useMemo(() => {
    const all = new Set<PimEventRow>();
    for (const w of monthSpans) for (const e of w.spanned) all.add(e);
    return all;
  }, [monthSpans]);
  const calColor = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of calendars) map.set(`${c.accountId} ${c.id}`, c.color ?? "");
    return map;
  }, [calendars]);
  const calName = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of calendars) map.set(`${c.accountId} ${c.id}`, c.name);
    return map;
  }, [calendars]);
  const colorOf = useCallback(
    (e: PimEventRow) => e.color || calColor.get(`${e.accountId} ${e.calendarId}`) || "var(--accent-color)",
    [calColor]
  );

  // Status-bar info line (#4): show a live "N Termine · M Aufgaben" for the
  // visible range instead of the last-opened file's stale stats. Only the
  // focused pane publishes; leaving the tab resets it via App's activePath
  // effect. `events` already reflects the queried range window.
  useEffect(() => {
    if (!isActivePane) return;
    const parts = [`${events.length} ${t("pim.eventsLabel", { defaultValue: "Termine" })}`];
    if (showTasks) parts.push(`${tasks.length} ${t("tasks.title", { defaultValue: "Aufgaben" })}`);
    activeDocument.set({ path: CALENDAR_TAB_PATH, content: "", kind: "virtual", meta: { info: parts.join(" · ") } });
  }, [isActivePane, events.length, showTasks, tasks.length, t]);

  const monthTitle = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(viewDate),
    [i18n.language, viewDate]
  );
  const weekdayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { weekday: "short" });
    // 2024-01-01 was a Monday (getDay() === 1); rotate to the chosen start.
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + ((weekStartDay - 1 + 7 + i) % 7))));
  }, [i18n.language, weekStartDay]);
  const dayTitle = useMemo(() => {
    const [y, m, d] = selectedDay.split("-").map(Number);
    return new Intl.DateTimeFormat(i18n.language, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(
      new Date(y, (m ?? 1) - 1, d ?? 1)
    );
  }, [i18n.language, selectedDay]);

  // Period label per mode (a single day, a day range, the month, or Agenda).
  const periodTitle = useMemo(() => {
    if (viewMode === "agenda") return t("pim.viewAgenda", { defaultValue: "Agenda" });
    if (viewMode === "month") return monthTitle;
    if (viewMode === "day") return dayTitle;
    const first = gridDays[0];
    const last = gridDays[gridDays.length - 1];
    if (!first || !last) return monthTitle;
    const dayNum = new Intl.DateTimeFormat(i18n.language, { day: "numeric" });
    const dayMonth = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "long" });
    return `${dayNum.format(first)}.–${dayMonth.format(last)}`;
  }, [viewMode, monthTitle, dayTitle, gridDays, i18n.language, t]);

  // Prev/next steps by the visible period (1 / 3 / 7 days, or one month).
  const navPeriod = useCallback(
    (dir: -1 | 1) => {
      if (viewMode === "month") {
        setViewDate((d) => new Date(d.getFullYear(), d.getMonth() + dir, 1));
        return;
      }
      const step = viewMode === "3day" ? 3 : viewMode === "week" ? 7 : 1;
      const next = new Date(selectedDate.getTime() + dir * step * DAY_MS_LOCAL);
      setSelectedDay(localIsoKey(next));
      setViewDate(startOfMonth(next));
    },
    [viewMode, selectedDate]
  );

  const refresh = useCallback(() => {
    pimRuntime?.worker.triggerImmediate().catch(() => undefined);
  }, [pimRuntime]);

  // ---- event writes (stage 3: single events; series stay read-only) -------

  const [editState, setEditState] = useState<{ mode: "create" | "edit"; event?: PimEventRow } | null>(null);
  // Prefilled create form (from quick-create "more options"); null = fresh form.
  const [createInitial, setCreateInitial] = useState<EventFormValues | null>(null);
  /** A save on a series instance, waiting for "this one or all?" (S3). */
  const [savePrompt, setSavePrompt] = useState<
    { event: PimEventRow; values: EventFormValues; before: EventFormValues; changes: EventChange[] } | null
  >(null);
  // Quick-create popover after a click/drag on an empty slot.
  const [quickCreate, setQuickCreate] = useState<{ dayKey: string; startMin: number; endMin: number; anchor: { x: number; y: number } } | null>(null);
  const enabledAccounts = useMemo(() => new Set(accounts.filter((a) => a.enabled).map((a) => a.id)), [accounts]);
  const writableCalendars = useMemo(
    () =>
      calendars.filter((c) => c.selected && !c.readOnly && enabledAccounts.has(c.accountId)),
    [calendars, enabledAccounts]
  );
  // How many calendars one could WRITE a block into (across ALL enabled
  // accounts), regardless of visibility (`selected`). Blocking into a calendar
  // you don't currently display is valid, so the block action / dialog must not
  // hide it — the visibility toggle is not a write-permission gate.
  const writableAnyCount = useMemo(
    () => calendars.filter((c) => !c.readOnly && enabledAccounts.has(c.accountId)).length,
    [calendars, enabledAccounts]
  );
  const accountLabel = useMemo(() => new Map(accounts.map((a) => [a.id, a.label])), [accounts]);
  const calendarOptions = useMemo(
    () =>
      writableCalendars.map((c) => ({
        value: `${c.accountId} ${c.id}`,
        label: accounts.length > 1 ? `${c.name} · ${accountLabel.get(c.accountId) ?? ""}` : c.name,
      })),
    [writableCalendars, accounts.length, accountLabel]
  );
  // Default calendar for new events (settings preference); re-read when the
  // preference changes in settings while the calendar tab stays open.
  const [prefDefaultCal, setPrefDefaultCal] = useState("");
  useEffect(() => {
    if (!vaultPath) return;
    let alive = true;
    const load = async () => {
      const store = await getSettingsStore();
      const v = ((await store.get<string>(defaultCalendarKey(vaultPath))) ?? "").trim();
      if (alive) setPrefDefaultCal(v);
    };
    void load();
    const onChanged = () => void load();
    window.addEventListener("plainva-default-calendar-changed", onChanged);
    return () => { alive = false; window.removeEventListener("plainva-default-calendar-changed", onChanged); };
  }, [vaultPath]);
  // The preferred default calendar if it is still a writable option, else the
  // first writable calendar.
  const defaultCalKey = useMemo(
    () => (calendarOptions.some((c) => c.value === prefDefaultCal) ? prefDefaultCal : calendarOptions[0]?.value ?? ""),
    [calendarOptions, prefDefaultCal]
  );
  // The edit dialog always shows the event's own calendar as the current
  // selection (see buildEditCalendarOptions — even a read-only/subscribed one),
  // so the picker never falls back to the raw key; create uses the writable list.
  const editCalendarOptions = useMemo(
    () =>
      editState?.mode === "edit" && editState.event
        ? buildEditCalendarOptions(editState.event, calendarOptions, calName, accountLabel, accounts.length > 1)
        : calendarOptions,
    [editState, calendarOptions, calName, accountLabel, accounts.length]
  );

  const targetFor = useCallback(
    async (accountId: string) => {
      const account = accounts.find((a) => a.id === accountId);
      if (!account || !pimRuntime) return null;
      try {
        return await pimRuntime.buildTarget(account);
      } catch {
        return null;
      }
    },
    [accounts, pimRuntime]
  );

  /**
   * Writes an edited form against ONE event — the occurrence or the series
   * master, whichever the caller decided on. Split out of `submitEventForm` in
   * S3 so the scope answer can pick the subject after the save, not before the
   * form ever opened.
   */
  const writeEventForm = useCallback(
    async (e: PimEventRow, values: EventFormValues) => {
      const draft = eventFormToDraft(values);
      // The three rules around the provider calls (move = create+delete, a
      // moved remote means re-pull, a written event shows at once) are SHARED
      // since S24 — a second shell guessing at them produces duplicates and
      // lost edits on somebody's real calendar.
      const targets = { targetFor };
      {
        const currentKey = `${e.accountId} ${e.calendarId}`;
        const newKey = values.calendarKey.trim();
        const [moveAcc, ...moveRest] = newKey.split(" ");
        const moveCal = moveRest.join(" ");
        const moveTo = newKey && newKey !== currentKey && moveAcc && moveCal ? { accountId: moveAcc, calendarId: moveCal } : null;
        // A move carries the fields the form does not edit; the copy has to be
        // faithful, not a stripped-down version of the event.
        const writeDraft: PimEventDraft = moveTo
          ? {
              ...draft,
              description: draft.description ?? e.description ?? undefined,
              descriptionHtml: draft.descriptionHtml ?? (e.description ? markdownToHtml(e.description) : undefined),
              attendees: draft.attendees ?? (e.attendees && e.attendees.length ? [...e.attendees] : undefined),
            }
          : draft;
        const out = await updateCalendarEvent(targets, e, writeDraft, moveTo);
        if (out.kind === "conflict") {
          setEditState(null);
          toast.info(t("pim.eventConflict", { defaultValue: "Der Termin wurde extern geändert — Ansicht aktualisiert." }));
          refresh();
          return;
        }
        if (out.kind === "duplicate") toast.error(out.error instanceof Error ? out.error.message : String(out.error));
        // `conflict` returned above; what is left carries rows.
        const rows = out.kind === "written" || out.kind === "duplicate" ? out.rows : [];
        setEvents((prev) => {
          // In place: keep the row's identity, take the edited fields. Moved:
          // the old row is gone, the new one takes its place.
          if (moveTo) return [...prev.filter((ev) => !sameEventRef(ev, e)), ...rows];
          return prev.map((ev) => (sameEventRef(ev, e) ? { ...ev, ...rows[0] } : ev));
        });
      }
      setEditState(null);
      setCreateInitial(null);
      refresh();
    },
    [targetFor, refresh, t]
  );

  /**
   * The save gate. A create writes straight away. An edit on a SERIES instance
   * first asks what it should apply to — but only when something actually
   * changed: a form closed unchanged writes nothing and shows no dialog.
   */
  const submitEventForm = useCallback(
    async (values: EventFormValues) => {
      if (editState?.mode === "edit" && editState.event) {
        const e = editState.event;
        if (e.seriesMaster) {
          const before = eventFormFromEvent(e);
          const changes = describeEventChanges(before, values);
          if (changes.length === 0) {
            setEditState(null);
            return;
          }
          setEditState(null);
          setSavePrompt({ event: e, values, before, changes });
          return;
        }
        await writeEventForm(e, values);
        return;
      }
      const draft = eventFormToDraft(values);
      const [accountId, ...rest] = values.calendarKey.split(" ");
      const calId = rest.join(" ");
      if (!accountId || !calId) throw new Error(t("pim.noWritableCalendar", { defaultValue: "Kein beschreibbarer Kalender ausgewählt." }));
      const out = await createCalendarEvent({ targetFor }, accountId, calId, draft);
      setEvents((prev) => [...prev, ...out.rows]);
      setEditState(null);
      setCreateInitial(null);
      refresh();
    },
    [editState, writeEventForm, targetFor, refresh, t]
  );

  // ---- drag reschedule (move/resize existing single events) ----------------

  const canEditEvent = useCallback(
    (e: PimEventRow) => {
      if (e.seriesMaster) return false; // series instances stay read-only (v1)
      const key = `${e.accountId} ${e.calendarId}`;
      return writableCalendars.some((c) => `${c.accountId} ${c.id}` === key);
    },
    [writableCalendars]
  );

  const rescheduleEvent = useCallback(
    async (e: PimEventRow, newStartMs: number, newEndMs: number) => {
      const target = await targetFor(e.accountId);
      if (!target) {
        toast.error(t("pim.eventWriteFailed", { defaultValue: "Speichern beim Anbieter fehlgeschlagen." }));
        return;
      }
      // Direct draft from the event's current fields with new times; the
      // adapter GET-modify-PUTs, so attendees/alarms/color are preserved.
      const draft: PimEventDraft = {
        title: e.title,
        allDay: false,
        start: { ts: newStartMs },
        end: { ts: Math.max(newStartMs + 60000, newEndMs) },
        location: e.location ?? undefined,
        // Description is left untouched on a pure time move (undefined): the
        // adapter GET-modify-PUT / PATCH preserves the remote body, so rich HTML
        // is never overwritten with the cached Markdown.
        color: e.color,
      };
      try {
        await target.updateEvent({ calendarId: e.calendarId, uid: e.uid, etag: e.etag, href: e.href }, draft);
      } catch (err) {
        if (err instanceof PimConflictError) {
          toast.info(t("pim.eventConflict", { defaultValue: "Der Termin wurde extern geändert — Ansicht aktualisiert." }));
          refresh();
          return;
        }
        toast.error(err instanceof Error ? err.message : String(err));
        return;
      }
      // Optimistic: land the block at the new time immediately.
      setEvents((prev) => prev.map((ev) => (sameEventRef(ev, e) ? { ...ev, start: draft.start, end: draft.end, allDay: false } : ev)));
      refresh();
    },
    [targetFor, refresh, t]
  );

  const onEventMove = useCallback(
    (e: PimEventRow, newStartMs: number, newEndMs: number) => void rescheduleEvent(e, newStartMs, newEndMs),
    [rescheduleEvent]
  );
  const onEventResize = useCallback(
    (e: PimEventRow, newEndMs: number) => void rescheduleEvent(e, e.start.ts, newEndMs),
    [rescheduleEvent]
  );

  // ---- RSVP (accept/decline an invitation; provider-native scheduling) ------
  const respondToEventAs = useCallback(
    async (e: PimEventRow, response: "accepted" | "declined" | "tentative") => {
      const target = await targetFor(e.accountId);
      if (!target?.respondToEvent) {
        throw new Error(t("pim.rsvpUnsupported", { defaultValue: "Zu-/Absagen wird für dieses Konto nicht unterstützt." }));
      }
      await target.respondToEvent({ calendarId: e.calendarId, uid: e.uid, etag: e.etag, href: e.href }, response);
      // Optimistic: reflect the new self-response at once (worker re-query confirms).
      setEvents((prev) => prev.map((ev) => (sameEventRef(ev, e) ? { ...ev, selfResponse: response } : ev)));
      refresh();
    },
    [targetFor, refresh, t]
  );

  // ---- quick colour set (context menu): set/clear the per-event colour without
  // opening the full dialog. A minimal draft leaves description/attendees/
  // recurrence undefined so the adapter GET-modify-PUT preserves them; passing
  // color:"" clears back to the calendar colour (same contract as the dialog).
  const setEventColor = useCallback(
    async (e: PimEventRow, color: string) => {
      const target = await targetFor(e.accountId);
      if (!target) {
        toast.error(t("pim.eventWriteFailed", { defaultValue: "Speichern beim Anbieter fehlgeschlagen." }));
        return;
      }
      const draft: PimEventDraft = {
        title: e.title,
        allDay: e.allDay,
        start: e.start,
        end: e.end,
        location: e.location ?? undefined,
        color,
      };
      try {
        await target.updateEvent({ calendarId: e.calendarId, uid: e.uid, etag: e.etag, href: e.href }, draft);
      } catch (err) {
        if (err instanceof PimConflictError) {
          toast.info(t("pim.eventConflict", { defaultValue: "Der Termin wurde extern geändert — Ansicht aktualisiert." }));
          refresh();
          return;
        }
        toast.error(err instanceof Error ? err.message : String(err));
        return;
      }
      setEvents((prev) => prev.map((ev) => (sameEventRef(ev, e) ? { ...ev, color } : ev)));
      refresh();
    },
    [targetFor, refresh, t]
  );

  // ---- quick create (feedback round 3: click/drag on an empty slot) --------

  const timedForm = useCallback(
    (dayKey: string, startMin: number, endMin: number, v: QuickCreateValues): EventFormValues => ({
      ...emptyEventForm(dayKey, v.calendarKey || defaultCalKey || ""),
      title: v.title,
      startTime: minutesToHHMM(startMin),
      endTime: minutesToHHMM(endMin),
      location: v.location,
    }),
    [defaultCalKey]
  );

  const onCreateSlot = useCallback(
    (dayKey: string, startMin: number, endMin: number, anchor: { x: number; y: number }) => {
      if (calendarOptions.length === 0) return;
      setSelectedDay(dayKey);
      setQuickCreate({ dayKey, startMin, endMin, anchor });
    },
    [calendarOptions.length]
  );

  const quickSave = useCallback(
    async (v: QuickCreateValues) => {
      const qc = quickCreate;
      if (!qc) return;
      setQuickCreate(null);
      const title = v.title.trim() || t("pim.untitledEvent", { defaultValue: "(ohne Titel)" });
      try {
        await submitEventForm(timedForm(qc.dayKey, qc.startMin, qc.endMin, { ...v, title }));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
    },
    [quickCreate, submitEventForm, timedForm, t]
  );

  const openMoreFromQuick = useCallback(
    (v: QuickCreateValues) => {
      const qc = quickCreate;
      if (!qc) return;
      setCreateInitial(timedForm(qc.dayKey, qc.startMin, qc.endMin, v));
      setQuickCreate(null);
      setEditState({ mode: "create" });
    },
    [quickCreate, timedForm]
  );

  /** Provider delete WITHOUT its own confirmation (callers confirm). */
  const performDelete = useCallback(
    async (e: PimEventRow) => {
      const target = await targetFor(e.accountId);
      if (!target) {
        toast.error(t("pim.eventWriteFailed", { defaultValue: "Speichern beim Anbieter fehlgeschlagen." }));
        return;
      }
      try {
        await target.deleteEvent({ calendarId: e.calendarId, uid: e.uid, etag: e.etag, href: e.href });
        // Optimistic: drop it from view at once (worker re-query confirms).
        setEvents((prev) => prev.filter((ev) => !sameEventRef(ev, e)));
      } catch (err) {
        if (err instanceof PimConflictError) {
          toast.info(t("pim.eventConflict", { defaultValue: "Der Termin wurde extern geändert — Ansicht aktualisiert." }));
        } else {
          toast.error(t("pim.eventWriteFailed", { defaultValue: "Speichern beim Anbieter fehlgeschlagen." }));
        }
      }
      refresh();
    },
    [targetFor, refresh, t]
  );

  const deleteEvent = useCallback(
    async (e: PimEventRow) => {
      const ok = await appConfirm({
        title: t("pim.deleteEvent", { defaultValue: "Termin löschen" }),
        message: t("pim.deleteEventMsg", { defaultValue: "„{{title}}“ wird im Kalender des Anbieters gelöscht.", title: e.title }),
        kind: "danger",
      });
      if (!ok) return;
      await performDelete(e);
    },
    [performDelete, t]
  );

  // ---- series scope (stage 4): "only this event" vs. "all events" ---------

  const [seriesPrompt, setSeriesPrompt] = useState<{ action: "delete"; event: PimEventRow } | null>(null);
  // "Block in other calendars" (#1): the event being mirrored, or null.
  const [blockEvent, setBlockEvent] = useState<PimEventRow | null>(null);
  // Right-click context menu on an event (quick actions), or null.
  const [ctxMenu, setCtxMenu] = useState<{ event: PimEventRow; x: number; y: number } | null>(null);
  const [peekEvent, setPeekEvent] = useState<PimEventRow | null>(null);
  const openEventContextMenu = useCallback(
    (e: PimEventRow, at: { x: number; y: number }) => setCtxMenu({ event: e, x: at.x, y: at.y }),
    []
  );

  const resolveSeriesMaster = useCallback(
    async (e: PimEventRow): Promise<PimEventRow | null> => {
      if (!pimRuntime || !e.seriesMaster) return null;
      try {
        return await pimRuntime.cache.getEventByUid(e.accountId, e.calendarId, e.seriesMaster);
      } catch {
        return null;
      }
    },
    [pimRuntime]
  );

  const onSeriesScope = useCallback(
    async (scope: "this" | "all") => {
      const prompt = seriesPrompt;
      setSeriesPrompt(null);
      if (!prompt) return;
      const instance = prompt.event;
      // "all" targets the MASTER row (cache keeps it despite the day-grid
      // filtering it out); an unresolvable master degrades to an error toast.
      const subject = scope === "this" ? instance : await resolveSeriesMaster(instance);
      if (!subject) {
        toast.error(t("pim.eventWriteFailed", { defaultValue: "Speichern beim Anbieter fehlgeschlagen." }));
        return;
      }
      // The scope dialog already confirmed the deletion.
      await performDelete(subject);
    },
    [seriesPrompt, resolveSeriesMaster, performDelete, t]
  );

  /**
   * The answer to "this one or all?" AFTER a save (S3). "This one" writes the
   * edited occurrence; "all" applies only the CHANGED fields onto the master,
   * so the series keeps its own start date and everything the user left alone.
   */
  const onSaveScope = useCallback(
    async (scope: "this" | "all") => {
      const prompt = savePrompt;
      setSavePrompt(null);
      if (!prompt) return;
      if (scope === "this") {
        await writeEventForm(prompt.event, prompt.values);
        return;
      }
      const master = await resolveSeriesMaster(prompt.event);
      if (!master) {
        toast.error(t("pim.eventWriteFailed", { defaultValue: "Speichern beim Anbieter fehlgeschlagen." }));
        return;
      }
      await writeEventForm(master, applyEventChanges(eventFormFromEvent(master), prompt.values, prompt.changes));
    },
    [savePrompt, resolveSeriesMaster, writeEventForm, t]
  );

  /**
   * The EDIT path. Until S2 this was what a click did; now it is what the
   * preview's "Termin bearbeiten" does. On a series the scope question still
   * comes first — S3 moves it to the moment a change is saved.
   */
  const requestEdit = useCallback((e: PimEventRow) => {
    setPeekEvent(null);
    // The occurrence opens — always. Whether an edit applies to it alone or to
    // the whole series is a question about WRITING, and it is asked at save
    // time, where it can name what changed (S3).
    setEditState({ mode: "edit", event: e });
  }, []);

  /**
   * What a CLICK does (S2): open the preview. Reading an event is not editing
   * it, and a series is named rather than questioned.
   */
  const requestPreview = useCallback((e: PimEventRow) => setPeekEvent(e), []);

  const requestDelete = useCallback(
    (e: PimEventRow) => {
      if (e.seriesMaster) setSeriesPrompt({ action: "delete", event: e });
      else void deleteEvent(e);
    },
    [deleteEvent]
  );

  const openMeetingNote = useCallback(
    async (e: PimEventRow) => {
      if (!vaultAdapter || !vaultPath) return;
      try {
        const store = await getSettingsStore();
        const configured = ((await store.get<string>(meetingFolderKey(vaultPath))) ?? "").trim();
        const res = await resolveOrCreateMeetingNote({
          adapter: vaultAdapter,
          event: e,
          dayKey: eventStartDayKey(e),
          folder: configured || DEFAULT_MEETING_FOLDER,
          noteType: "Meeting",
        });
        if (res.created) {
          if (indexer) await applyIndexChanges(indexer, { added: [res.path] }).catch(() => undefined);
          triggerFileTreeUpdate([res.path]);
          toast.info(t("pim.meetingNoteCreated", { defaultValue: "Meeting-Notiz erstellt: {{name}}", name: res.path.split("/").pop() }));
        }
        onOpenPath(res.path, true);
      } catch {
        toast.error(t("pim.meetingNoteFailed", { defaultValue: "Meeting-Notiz konnte nicht erstellt werden." }));
      }
    },
    [vaultAdapter, vaultPath, indexer, triggerFileTreeUpdate, onOpenPath, t]
  );

  const viewMonth = viewDate.getMonth();

  // Agenda: upcoming days (events and/or due tasks) inside the rolling range.
  const agendaDays = useMemo(() => {
    if (viewMode !== "agenda") return [] as { key: string; events: PimEventRow[]; tasks: CalTask[] }[];
    const keys = new Set<string>([...byDay.keys(), ...(showTasks ? tasksByDay.keys() : [])]);
    return [...keys]
      .filter((k) => k >= todayKey)
      .sort()
      .map((k) => ({ key: k, events: byDay.get(k) ?? [], tasks: showTasks ? tasksByDay.get(k) ?? [] : [] }));
  }, [viewMode, byDay, tasksByDay, showTasks, todayKey]);

  const formatDayLong = useCallback(
    (key: string) => {
      const [y, m, d] = key.split("-").map(Number);
      return new Intl.DateTimeFormat(i18n.language, { weekday: "long", day: "numeric", month: "long" }).format(new Date(y, (m ?? 1) - 1, d ?? 1));
    },
    [i18n.language]
  );

  /** The full event card (times, location, meeting-note/edit/delete actions) —
   * shared between the month view's day pane and the agenda list. */
  // "Per Mail versenden" (mail-client E6): build an iCal REQUEST invite and open
  // the compose dialog with it attached, recipients pre-filled from the event's
  // attendees (rsvps emails, else the plain attendee list). The recipients' own
  // calendar apps handle the RSVP (iMIP); Plainva tracks replies only for events
  // it owns.
  const emailInvite = useCallback(
    async (e: PimEventRow) => {
      if (!vaultPath) return;
      try {
        const accounts = await listMailAccounts(vaultPath);
        if (accounts.length === 0) {
          toast.info(t("mail.empty", { defaultValue: "Kein E-Mail-Konto verbunden" }));
          return;
        }
        const ics = buildInviteIcs(e, { organizer: accounts[0].user, stampMs: Date.now(), descriptionHtml: e.description ? markdownToHtml(e.description) : undefined });
        const timeText = e.allDay ? t("pim.allDay", { defaultValue: "Ganztägig" }) : formatTimeRange(e, i18n.language);
        const body = [e.title, timeText, e.location].filter(Boolean).join("\n");
        // Recipients = the event's invitees (the plain attendee list); the
        // organizer's own rsvp entry is deliberately not a recipient.
        const to = (e.attendees ?? []).join(", ");
        window.dispatchEvent(
          new CustomEvent("plainva-compose-mail", {
            detail: {
              subject: t("pim.inviteSubject", { defaultValue: "Einladung: {{title}}", title: e.title }),
              markdown: body,
              to,
              attachments: [{ name: "invite.ics", mime: "text/calendar; method=REQUEST; charset=UTF-8", contentBase64: utf8ToBase64(ics) }],
            },
          })
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [vaultPath, t, i18n.language]
  );

  // "Block in other calendars" (#1): mirror the event into each chosen calendar
  // as a Busy placeholder or a full copy. A series is mirrored from its master
  // (start/end + recurrence) so the block recurs too.
  const blockInCalendars = useCallback(
    async (event: PimEventRow, selectedKeys: string[], mode: "busy" | "details") => {
      setBlockEvent(null);
      const master = event.seriesMaster ? await resolveSeriesMaster(event) : null;
      const source = master ?? event;
      const recurrence = master ? parseRRule(master.recurrence) : null;
      const busyLabel = t("pim.busyTitle", { defaultValue: "Beschäftigt" });
      const bd = buildBlockDraft(source, mode, busyLabel, recurrence);
      // Every failure keeps its reason (K9, finding 2026-09-03). Before, the
      // target builder swallowed any error into null and the write was caught
      // without binding the error - a missing scope, a calendar that is gone
      // and a dead network all read "could not block in X".
      const { ok, failed } = await runCalendarBlocks({
        keys: selectedKeys,
        labelFor: (key) => calName.get(key) || key,
        targetFor: async (accountId) => {
          const account = accounts.find((a) => a.id === accountId);
          if (!account || !pimRuntime) return { target: null, reason: t("pim.blockNoTarget", { defaultValue: "Konto nicht angemeldet" }) };
          try {
            return { target: await pimRuntime.buildTarget(account) };
          } catch (error) {
            return { target: null, reason: error instanceof Error ? error.message : String(error) };
          }
        },
        draft: bd,
        onCreated: (accountId, calId, res) => {
          // Optimistic for a one-off block (a recurring block expands server-side,
          // so we let the worker re-query bring its instances).
          if (!recurrence) {
            setEvents((prev) => [...prev, { ...draftToRow(accountId, calId, res.uid, bd), etag: res.etag, href: res.href }]);
          }
        },
      });
      if (ok > 0) {
        toast.info(t("pim.blocked", { n: ok, defaultValue: "In {{n}} Kalender(n) blockiert" }));
        refresh();
      }
      if (failed.length > 0) {
        for (const failure of failed) logDiagnostic("calendar", `block in ${failure.label}: ${failure.reason}`);
        const cals = failed.map((failure) => `${failure.label} (${failure.reason})`).join(", ");
        const message = t("pim.blockFailedFor", { cals, defaultValue: "Konnte in {{cals}} nicht blockieren." });
        // A 401/403 is a right the token does not carry: the fix is a fresh
        // sign-in on that account, and the toast takes the reader there.
        const refused = failed.find(isAuthorizationFailure);
        if (refused) {
          toast.error(message, {
            label: t("pim.blockReauth", { defaultValue: "Neu anmelden" }),
            run: () => window.dispatchEvent(new CustomEvent("plainva-open-sync-settings", { detail: { area: "cloudAccounts", accountId: refused.accountId } })),
          });
        } else {
          toast.error(message);
        }
      } else if (ok === 0) {
        toast.error(t("pim.eventWriteFailed", { defaultValue: "Speichern beim Anbieter fehlgeschlagen." }));
      }
    },
    [resolveSeriesMaster, accounts, pimRuntime, refresh, calName, t]
  );

  /** The OTHER writable calendars (never the event's own) for the block dialog.
   * Unlike the create/move picker (`calendarOptions`), this deliberately drops
   * the `selected` VISIBILITY gate: you can block into a calendar you don't
   * currently show. Only read-only / disabled-account calendars are excluded. */
  const blockTargetsFor = useCallback(
    (e: PimEventRow) => {
      const own = `${e.accountId} ${e.calendarId}`;
      return calendars
        .filter((c) => !c.readOnly && enabledAccounts.has(c.accountId) && `${c.accountId} ${c.id}` !== own)
        .map((c) => ({
          value: `${c.accountId} ${c.id}`,
          label: accounts.length > 1 ? `${c.name} · ${accountLabel.get(c.accountId) ?? ""}` : c.name,
        }));
    },
    [calendars, enabledAccounts, accounts.length, accountLabel]
  );

  const calNameOf = (e: PimEventRow) => calName.get(`${e.accountId} ${e.calendarId}`) ?? "";

  /** The one-word state ("Abgesagt", "Offen", "Vielleicht") where a row has room
   * for it — the agenda. Confirmed events say nothing (report 2026-07-29 F7/F8). */
  const stateLabel = (e: PimEventRow) => {
    const key = eventStateLabelKey(eventVisualState(e));
    return key ? t(key) : null;
  };

  // ---- agenda: a dense timeline (date rail + compact rows) -----------------

  const agendaStartTime = (e: PimEventRow) =>
    new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(e.start.ts));

  /** One compact agenda row: time · colour bar + title (+ location/attendee
   * meta) · calendar name. The whole row opens the edit dialog — the per-row
   * actions live in that dialog's ⋮ menu, keeping the timeline dense. */
  const agendaEventRow = (e: PimEventRow) => (
    <button
      key={`${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`}
      type="button"
      onClick={() => requestPreview(e)}
      onContextMenu={(ev) => { ev.preventDefault(); openEventContextMenu(e, { x: ev.clientX, y: ev.clientY }); }}
      data-testid="calendar-event"
      data-state={eventVisualState(e)}
      className={`pv-rowhover ${eventStateClass("pv-evt", eventVisualState(e))}`}
      style={{
        ["--evt-color" as string]: colorOf(e),
        display: "grid",
        gridTemplateColumns: "58px 1fr auto",
        gap: 12,
        alignItems: "baseline",
        width: "100%",
        textAlign: "left",
        border: "none",
        cursor: "pointer",
        padding: "7px 8px",
        borderRadius: "var(--radius-md)",
        color: "var(--text-main)",
        // The row is text, not a block: the state shows on the mark and title,
        // so the shared fill is neutralised here.
        background: "transparent",
        backgroundImage: "none",
        boxShadow: "none",
        opacity: isPast(e) ? 0.5 : 1,
      }}
    >
      <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "var(--text-xs)", color: "var(--text-muted)", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
        {agendaStartTime(e)}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
          <span
            aria-hidden
            className={`pv-evt-mark ${eventVisualState(e) === "confirmed" ? "" : `pv-evt-mark--${eventVisualState(e)}`}`}
            style={{ width: 4, height: 15, borderRadius: "var(--radius-pill)", flex: "0 0 auto" }}
          />
          {e.seriesMaster ? <Repeat size={ICON.meta} aria-label={t("pim.seriesTitle", { defaultValue: "Serientermin" })} style={{ flexShrink: 0 }} /> : null}
          {(e.blockOf || e.blockedIn?.length) ? <Link2 size={ICON.meta} aria-label={t("pim.linkedBlock", { defaultValue: "VerknÃ¼pfter Kalenderblock" })} style={{ flexShrink: 0 }} /> : null}
          <span className="pv-evt-title" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{eventDisplayTitle(e.title, t("pim.untitledEvent", { defaultValue: "(ohne Titel)" }))}</span>
          {stateLabel(e) ? <span className="pv-evt-state" data-testid="calendar-event-state">{stateLabel(e)}</span> : null}
        </span>
        {e.location || (e.attendees?.length ?? 0) > 0 ? (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap", paddingLeft: 12 }}>
            {e.location ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, overflowWrap: "anywhere" }}>
                <MapPin size={ICON.meta} style={{ flexShrink: 0 }} />
                {e.location}
              </span>
            ) : null}
            {(e.attendees?.length ?? 0) > 0 ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-faint)" }} aria-label={t("pim.attendees", { defaultValue: "Teilnehmer" })}>
                <Users size={ICON.meta} style={{ flexShrink: 0 }} />
                {e.attendees!.length}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", whiteSpace: "nowrap" }}>{calNameOf(e)}</span>
    </button>
  );

  /**
   * The tick-off control both calendar surfaces share. It is a real button that
   * stops the click from reaching the row — which would otherwise open the note
   * at the same time.
   *
   * The hit area differs by surface on purpose. In the agenda there is room for
   * a full touch target; a month cell is deliberately dense and derives how many
   * entries it shows from its measured line height, so forcing 44px there would
   * cost visible entries — the very overview that view exists for. It therefore
   * widens horizontally (where there IS room) and keeps the row height.
   *
   * Without a completion model the database cannot express "done", so the box
   * renders as a plain indicator rather than a control that does nothing.
   */
  const renderTaskCheckbox = (task: CalTask, size: number, dense = false) => {
    const icon = task.done
      ? <CheckSquare size={size} style={{ color: "var(--accent-color)" }} />
      : <Square size={size} style={{ color: task.due < todayKey ? "var(--warning-text)" : "var(--text-muted)" }} />;
    if (!taskCompletion) return <span style={{ display: "grid", placeItems: "center" }}>{icon}</span>;
    return (
      <button
        type="button"
        data-testid="calendar-task-checkbox"
        aria-label={task.done ? t("tasks.open", { defaultValue: "Offen" }) : t("tasks.done", { defaultValue: "Erledigt" })}
        aria-pressed={task.done}
        onClick={(ev) => {
          ev.stopPropagation();
          toggleTaskFromCalendar(task);
        }}
        style={{
          display: "grid",
          placeItems: "center",
          background: "transparent",
          border: "none",
          padding: 0,
          margin: 0,
          minWidth: dense ? "var(--control-sm)" : "var(--touch-sm)",
          minHeight: dense ? undefined : "var(--touch-sm)",
          cursor: "pointer",
          borderRadius: "var(--radius-sm)",
        }}
      >
        {icon}
      </button>
    );
  };

  /** One agenda task row: checkbox · title · due pill. */
  const agendaTaskRow = (task: CalTask, dayKey: string) => {
    const [dy, dm, dd] = dayKey.split("-").map(Number);
    const dueLabel =
      dayKey === todayKey
        ? t("pim.dueToday", { defaultValue: "fällig heute" })
        : t("pim.dueOn", {
            defaultValue: "fällig {{date}}",
            date: new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short" }).format(new Date(dy ?? 1970, (dm ?? 1) - 1, dd ?? 1)),
          });
    const tone = taskTone(task);
    // A container with role="button", NOT a <button>: the checkbox inside is
    // itself a button, and nesting buttons is invalid HTML — the same trap that
    // made the month cell's contents unclickable (issue #34, wave 2).
    return (
      <div
        key={task.path}
        role="button"
        tabIndex={0}
        onClick={() => onOpenPath(task.path, false)}
        onKeyDown={(ev) => {
          if (ev.target !== ev.currentTarget) return;
          if (ev.key === "Enter" || ev.key === " ") {
            ev.preventDefault();
            onOpenPath(task.path, false);
          }
        }}
        data-testid="calendar-task"
        className="pv-rowhover"
        style={{
          display: "grid",
          gridTemplateColumns: "58px 1fr auto",
          gap: 12,
          alignItems: "center",
          width: "100%",
          textAlign: "left",
          border: "none",
          cursor: "pointer",
          padding: "6px 8px",
          borderRadius: "var(--radius-md)",
          opacity: tone.opacity,
        }}
      >
        <span style={{ display: "grid", placeItems: "center" }}>
          {renderTaskCheckbox(task, ICON.ui)}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: "var(--text-sm)", color: tone.color, textDecoration: task.done ? "line-through" : "none" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{task.title}</span>
          {task.repeats ? <Repeat size={ICON.meta} aria-label={t("tasks.repeat", { defaultValue: "Wiederholung" })} style={{ flexShrink: 0, opacity: 0.7 }} /> : null}
        </span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--warning-text)", background: "var(--warning-bg)", padding: "1px 8px", borderRadius: "var(--radius-pill)", fontWeight: 600, whiteSpace: "nowrap" }}>
          {dueLabel}
        </span>
      </div>
    );
  };

  /** The shared time grid for the day / 3-day / week views and the month day
   * pane (feedback round 3). */
  const renderTimeGrid = (gridDaysArg: Date[], showColumnHeaders: boolean) => (
    <DayTimeGrid
      days={gridDaysArg}
      byDay={byDay}
      tasksByDay={showTasks ? tasksByDay : undefined}
      overlayByDay={overlayByDay}
      onOpenOverlay={(entry) => setPeekPath(entry.path)}
      onOverlayDragStart={setDraggingOverlay}
      onOverlayDragEnd={() => setDraggingOverlay(null)}
      onOverlayDropDay={(day) => {
        const entry = draggingOverlay;
        setDraggingOverlay(null);
        if (entry) void moveOverlayEntry(entry, day);
      }}
      overlayDragActive={!!draggingOverlay}
      colorOf={colorOf}
      calName={calNameOf}
      nowTs={nowTs}
      todayKey={todayKey}
      locale={i18n.language}
      canCreate={calendarOptions.length > 0}
      canEditEvent={canEditEvent}
      onEventClick={requestPreview}
      onEventContextMenu={openEventContextMenu}
      onOpenTask={(p) => onOpenPath(p, false)}
      renderTaskCheckbox={renderTaskCheckbox}
      taskTone={taskTone}
      onCreateSlot={onCreateSlot}
      onEventMove={onEventMove}
      onEventResize={onEventResize}
      showColumnHeaders={showColumnHeaders}
    />
  );

  if (accounts.length === 0) {
    return (
      <div data-testid="calendar-view" style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--bg-primary)" }}>
        <EmptyState
          title={t("cloudAccounts.noServiceCalTitle")}
          icon={<CalendarRange size={ICON.empty} />}
          action={
            <Button
              variant="primary"
              onClick={() => window.dispatchEvent(new CustomEvent("plainva-open-sync-settings", { detail: { area: "cloudAccounts" } }))}
              data-testid="calendar-open-settings"
            >
              {t("cloudAccounts.openArea")}
            </Button>
          }
        >
          {t("cloudAccounts.noServiceCalBody")}
        </EmptyState>
      </div>
    );
  }

  return (
    <div data-testid="calendar-view" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--bg-primary)" }}>
      {/* Header: view segment + period navigation + status + refresh */}
      <div className="pv-appbar">
        {viewMode !== "agenda" && (
          <IconButton label={t("pim.prevPeriod", { defaultValue: "Zurück" })} onClick={() => navPeriod(-1)} data-testid="calendar-prev">
            <ChevronLeft size={ICON.ui} />
          </IconButton>
        )}
        <h2 data-testid="calendar-month-title" style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: 600, minWidth: 170 }}>
          {periodTitle}
        </h2>
        {viewMode !== "agenda" && (
          <IconButton label={t("pim.nextPeriod", { defaultValue: "Weiter" })} onClick={() => navPeriod(1)} data-testid="calendar-next">
            <ChevronRight size={ICON.ui} />
          </IconButton>
        )}
        <Button
          variant="ghost"
          onClick={() => {
            setViewDate(startOfMonth(new Date()));
            setSelectedDay(localIsoKey(new Date()));
          }}
        >
          {t("calendar.today", { defaultValue: "Heute" })}
        </Button>
        <div style={{ marginLeft: "var(--space-2)" }}>
          <Segmented<CalViewMode>
            ariaLabel={t("pim.viewSwitch", { defaultValue: "Kalenderansicht" })}
            value={viewMode}
            onChange={setViewMode}
            options={[
              { value: "day", label: t("pim.viewDay", { defaultValue: "Tag" }), testId: "calendar-mode-day" },
              { value: "3day", label: t("pim.view3Day", { defaultValue: "3 Tage" }), testId: "calendar-mode-3day" },
              { value: "week", label: t("pim.viewWeek", { defaultValue: "Woche" }), testId: "calendar-mode-week" },
              { value: "month", label: t("pim.viewMonth", { defaultValue: "Monat" }), testId: "calendar-mode-month" },
              { value: "agenda", label: t("pim.viewAgenda", { defaultValue: "Agenda" }), testId: "calendar-mode-agenda" },
            ]}
          />
        </div>
        <span style={{ flex: 1 }} />
        {status.status === "syncing" ? (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{t("pim.syncing", { defaultValue: "Aktualisiere…" })}</span>
        ) : status.status === "error" ? (
          <span data-tip={status.message} style={{ fontSize: "var(--text-xs)", color: "var(--error-text)" }}>
            {t("pim.syncError", { defaultValue: "Sync-Fehler" })}
          </span>
        ) : null}
        {hasTaskDb && (
          <IconButton
            label={t("pim.showTasks", { defaultValue: "Aufgaben anzeigen" })}
            onClick={() => setShowTasks((v) => !v)}
            aria-pressed={showTasks}
            data-testid="calendar-toggle-tasks"
          >
            <ListChecks size={ICON.ui} style={{ color: showTasks ? "var(--accent-color)" : undefined }} />
          </IconButton>
        )}
        {viewMode !== "month" && viewMode !== "agenda" && calendarOptions.length > 0 && (
          <IconButton label={t("pim.newEvent", { defaultValue: "Neuer Termin" })} onClick={() => setEditState({ mode: "create" })} data-testid="calendar-new-event-top">
            <Plus size={ICON.ui} />
          </IconButton>
        )}
        <IconButton label={t("pim.refreshNow", { defaultValue: "Jetzt aktualisieren" })} onClick={refresh} data-testid="calendar-refresh">
          <RefreshCw size={ICON.ui} />
        </IconButton>
      </div>

      {showTasks && taskError && (
        <p
          data-testid="calendar-tasks-error"
          style={{ margin: 0, padding: "var(--space-2) var(--space-3)", fontSize: "var(--text-sm)", color: "var(--error-text)" }}
        >
          {t("common.loadFailed", { message: taskError })}
        </p>
      )}

      {/* The "show" bar (S18): database views that can join the picture. The
          chips stay DASHED whether on or off — the outline is what says "these
          are notes, not appointments", and it must not disappear the moment one
          is switched on. */}
      {overlayCands.length > 0 && (
        <div className="pv-overlaybar" data-testid="calendar-overlay-bar">
          <span className="pv-overlaybar-label">{t("pim.overlayShow", { defaultValue: "Einblenden:" })}</span>
          {overlayCands.map((c) => {
            const key = overlayKey(c);
            const on = overlayKeys.includes(key);
            return (
              <button
                key={key}
                type="button"
                className={`pv-overlaychip${on ? " is-on" : ""}`}
                aria-pressed={on}
                data-testid={`calendar-overlay-${key}`}
                onClick={() => toggleOverlay(key)}
              >
                <Diamond size={ICON.meta} aria-hidden />
                {c.label}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
        {viewMode === "month" && (
        <>
        {/* Month grid */}
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", padding: "var(--space-2)" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, flexShrink: 0 }}>
            {weekdayNames.map((w) => (
              <div key={w} style={{ textAlign: "center", fontSize: "var(--text-xs)", color: "var(--text-muted)", padding: "2px 0" }}>
                {w}
              </div>
            ))}
          </div>
          <div
            ref={monthGridRef}
            data-testid="calendar-grid"
            style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: "minmax(72px, 1fr)", gap: 2, flex: 1, minHeight: 0 }}
          >
            {cells.map((cell, cellIndex) => {
              const key = localIsoKey(cell);
              // A spanning event is drawn ONCE as a bar across the row, so the
              // cells it passes through must not repeat it (S5).
              const list = (byDay.get(key) ?? []).filter((e) => !spannedEvents.has(e));
              const dayTaskList = showTasks ? tasksByDay.get(key) ?? [] : [];
              const dayOverlay = overlayByDay.get(key) ?? [];
              // The bars sit above the chips and eat into the cell's lines.
              const lanes = monthSpans[Math.floor(cellIndex / 7)]?.laneCount ?? 0;
              const cellLines = Math.max(1, maxCellItems - lanes);
              // Events fill the available lines first; remaining lines show tasks.
              const shownEvents = list.slice(0, cellLines);
              const shownTasks = dayTaskList.slice(0, Math.max(0, cellLines - shownEvents.length));
              const shownOverlay = dayOverlay.slice(0, Math.max(0, cellLines - shownEvents.length - shownTasks.length));
              const overflow =
                list.length + dayTaskList.length + dayOverlay.length - shownEvents.length - shownTasks.length - shownOverlay.length;
              const inMonth = cell.getMonth() === viewMonth;
              const isToday = key === todayKey;
              const isSelected = key === selectedDay;
              return (
                // A container, not a <button> (issue #34): the event and task
                // rows inside are themselves clickable, and a button inside a
                // button is invalid HTML. Keyboard behaviour is kept by hand —
                // the cell stays one tab stop that selects the day, the rows
                // are their own stops.
                <div
                  key={key}
                  role="button"
                  tabIndex={0}
                  aria-label={cell.toLocaleDateString(i18n.language, { dateStyle: "full" })}
                  data-testid={`calendar-day-${key}`}
                  onClick={() => setSelectedDay(key)}
                  // Dragging an overlay entry onto another day writes its date
                  // column (plan P9a). Only overlay entries are draggable, so a
                  // cell that never sees one behaves exactly as before.
                  onDragOver={draggingOverlay ? (ev) => ev.preventDefault() : undefined}
                  onDrop={
                    draggingOverlay
                      ? (ev) => {
                          ev.preventDefault();
                          const entry = draggingOverlay;
                          setDraggingOverlay(null);
                          void moveOverlayEntry(entry, key);
                        }
                      : undefined
                  }
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedDay(key);
                    }
                  }}
                  style={{
                    // Explicit placement, because the bars below are placed
                    // explicitly too — and a grid flows its AUTO-placed items
                    // around occupied slots. Left to auto-placement the cells
                    // would shuffle past every bar, and the day numbers would
                    // drift out from under their own dates.
                    gridRow: Math.floor(cellIndex / 7) + 1,
                    gridColumn: (cellIndex % 7) + 1,
                    border: isSelected ? "1px solid var(--accent-color)" : "1px solid var(--border-color-light)",
                    borderRadius: "var(--radius-sm)",
                    background: isSelected ? "var(--bg-hover)" : "var(--bg-primary)",
                    padding: "3px 4px",
                    textAlign: "left",
                    display: "flex",
                    flexDirection: "column",
                    gap: 2,
                    minWidth: 0,
                    overflow: "hidden",
                    cursor: "pointer",
                    opacity: inMonth ? 1 : 0.45,
                  }}
                >
                  <span
                    data-testid={`calendar-day-number-${key}`}
                    style={{
                      fontSize: "var(--text-xs)",
                      fontWeight: isToday ? 700 : 400,
                      color: isToday ? "var(--accent-color)" : "var(--text-muted)",
                    }}
                  >
                    {cell.getDate()}
                  </span>
                  {lanes > 0 ? <span aria-hidden style={{ height: lanes * MONTH_BAR_H, flexShrink: 0 }} /> : null}
                  {/* Every row opens its own object (issue #34): an event its
                      dialog, a task its note. The free area of the cell and the
                      "+n" line keep opening the day. */}
                  {shownEvents.map((e) => (
                    <button
                      type="button"
                      key={`${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`}
                      data-testid="calendar-month-event"
                      data-state={eventVisualState(e)}
                      className={eventStateClass("pv-evt", eventVisualState(e))}
                      onClick={(ev) => { ev.stopPropagation(); requestPreview(e); }}
                      onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); openEventContextMenu(e, { x: ev.clientX, y: ev.clientY }); }}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                        border: "none",
                        // A month row is text: the dot and the title carry the
                        // state, so the shared fill stays off here.
                        background: "transparent",
                        backgroundImage: "none",
                        boxShadow: "none",
                        ["--evt-color" as string]: colorOf(e),
                        padding: 0,
                        textAlign: "left",
                        cursor: "pointer",
                        font: "inherit",
                        fontSize: "var(--text-xs)",
                        color: "var(--text-main)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        minWidth: 0,
                        opacity: isPast(e) ? 0.5 : 1,
                      }}
                    >
                      <span
                        aria-hidden
                        className={`pv-evt-mark ${eventVisualState(e) === "confirmed" ? "" : `pv-evt-mark--${eventVisualState(e)}`}`}
                        style={{ width: 6, height: 6, borderRadius: "var(--radius-pill)", flexShrink: 0 }}
                      />
                      {(e.blockOf || e.blockedIn?.length) ? <Link2 size={ICON.meta} aria-label={t("pim.linkedBlock", { defaultValue: "VerknÃ¼pfter Kalenderblock" })} style={{ flexShrink: 0 }} /> : null}
                      <span className="pv-evt-title" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{eventDisplayTitle(e.title, t("pim.untitledEvent", { defaultValue: "(ohne Titel)" }))}</span>
                    </button>
                  ))}
                  {shownTasks.map((task) => {
                    const tone = taskTone(task);
                    return (
                      <div
                        key={`task-${task.path}`}
                        role="button"
                        tabIndex={0}
                        data-testid="calendar-month-task"
                        onClick={(ev) => { ev.stopPropagation(); onOpenPath(task.path, false); }}
                        onKeyDown={(ev) => {
                          if (ev.target !== ev.currentTarget) return;
                          if (ev.key === "Enter" || ev.key === " ") {
                            ev.preventDefault();
                            ev.stopPropagation();
                            onOpenPath(task.path, false);
                          }
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 3,
                          border: "none",
                          background: "transparent",
                          padding: 0,
                          textAlign: "left",
                          cursor: "pointer",
                          font: "inherit",
                          fontSize: "var(--text-xs)",
                          color: tone.color,
                          opacity: tone.opacity,
                          textDecoration: task.done ? "line-through" : "none",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          minWidth: 0,
                        }}
                      >
                        {renderTaskCheckbox(task, ICON.meta, true)}
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{task.title}</span>
                        {task.repeats ? <Repeat size={ICON.meta} aria-label={t("tasks.repeat", { defaultValue: "Wiederholung" })} style={{ flexShrink: 0, opacity: 0.7 }} /> : null}
                      </div>
                    );
                  })}
                  {shownOverlay.map((entry) => (
                    // A note, drawn as one: dashed edge, diamond, and the view
                    // it came from in the tooltip. Never a filled event chip.
                    <div
                      key={`ov-${entry.basePath}-${entry.path}`}
                      role="button"
                      tabIndex={0}
                      className="pv-overlay-entry"
                      data-testid="calendar-overlay-entry"
                      data-tip={entry.source}
                      draggable
                      onDragStart={(ev) => {
                        ev.stopPropagation();
                        setDraggingOverlay(entry);
                      }}
                      onDragEnd={() => setDraggingOverlay(null)}
                      onClick={(ev) => { ev.stopPropagation(); setPeekPath(entry.path); }}
                      onKeyDown={(ev) => {
                        if (ev.target !== ev.currentTarget) return;
                        if (ev.key === "Enter" || ev.key === " ") {
                          ev.preventDefault();
                          ev.stopPropagation();
                          setPeekPath(entry.path);
                        }
                      }}
                    >
                      <Diamond size={ICON.meta} aria-hidden style={{ flexShrink: 0 }} />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{entry.title}</span>
                    </div>
                  ))}
                  {overflow > 0 ? (
                    <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>+{overflow}</span>
                  ) : null}
                </div>
              );
            })}
            {/* The bars live in the SAME grid as the cells, placed by row and
                column span. That is what makes them one element: a single node
                the reader clicks, not a chip per day pretending to be a chain.
                They sit above the cell (zIndex) but leave the rest of it
                clickable, so the free area still opens the day. */}
            {monthSpans.flatMap((week, weekIndex) =>
              week.bars.map((bar) => (
                <button
                  type="button"
                  key={`span-${weekIndex}-${bar.event.accountId}-${bar.event.calendarId}-${bar.event.uid}-${bar.event.start.ts}`}
                  data-testid="calendar-month-span"
                  data-clipped-start={bar.clippedStart ? "1" : undefined}
                  data-clipped-end={bar.clippedEnd ? "1" : undefined}
                  data-state={eventVisualState(bar.event)}
                  className={eventStateClass("pv-evt", eventVisualState(bar.event))}
                  data-tip={eventDisplayTitle(bar.event.title, t("pim.untitledEvent", { defaultValue: "(ohne Titel)" }))}
                  onClick={(ev) => { ev.stopPropagation(); requestPreview(bar.event); }}
                  onContextMenu={(ev) => { ev.preventDefault(); ev.stopPropagation(); openEventContextMenu(bar.event, { x: ev.clientX, y: ev.clientY }); }}
                  style={{
                    gridRow: weekIndex + 1,
                    gridColumn: `${bar.startCol + 1} / span ${bar.endCol - bar.startCol + 1}`,
                    alignSelf: "start",
                    // Clear the day number, then stack by lane.
                    marginTop: 20 + bar.lane * MONTH_BAR_H,
                    marginInline: 3,
                    border: "none",
                    height: MONTH_BAR_H - 3,
                    ["--evt-color" as string]: colorOf(bar.event),
                    // A clipped edge is cut straight — that is how the reader
                    // sees "this continues" without the title being repeated.
                    borderStartStartRadius: bar.clippedStart ? 0 : "var(--radius-xs)",
                    borderEndStartRadius: bar.clippedStart ? 0 : "var(--radius-xs)",
                    borderStartEndRadius: bar.clippedEnd ? 0 : "var(--radius-xs)",
                    borderEndEndRadius: bar.clippedEnd ? 0 : "var(--radius-xs)",
                    marginInlineStart: bar.clippedStart ? 0 : 3,
                    marginInlineEnd: bar.clippedEnd ? 0 : 3,
                    display: "flex",
                    alignItems: "center",
                    gap: 3,
                    padding: "0 5px",
                    textAlign: "left",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: "var(--text-xs)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    minWidth: 0,
                    opacity: isPast(bar.event) ? 0.5 : 1,
                  }}
                >
                  {/* Only the FIRST row carries the label. Repeating it in every
                      week is precisely the chain this replaces. */}
                  {!bar.clippedStart ? (
                    <span className="pv-evt-title" style={{ overflow: "hidden", textOverflow: "ellipsis" }}>
                      {eventDisplayTitle(bar.event.title, t("pim.untitledEvent", { defaultValue: "(ohne Titel)" }))}
                    </span>
                  ) : null}
                </button>
              )),
            )}
          </div>
        </div>

        {/* Day pane: single-day time grid for the selected day — wide enough to
            read event titles and times comfortably (maintainer: give it more room). */}
        <div
          data-testid="calendar-day-pane"
          style={{ width: 360, flexShrink: 0, borderLeft: "1px solid var(--border-color-light)", display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <div className="pv-appbar">
            <h3 style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dayTitle}</h3>
            {calendarOptions.length > 0 && (
              <IconButton
                label={t("pim.newEvent", { defaultValue: "Neuer Termin" })}
                onClick={() => setEditState({ mode: "create" })}
                data-testid="calendar-new-event"
              >
                <Plus size={ICON.ui} />
              </IconButton>
            )}
          </div>
          {renderTimeGrid([selectedDate], false)}
        </div>
        </>
        )}

        {(viewMode === "day" || viewMode === "3day" || viewMode === "week") &&
          renderTimeGrid(gridDays, viewMode !== "day")}

        {viewMode === "agenda" && (
          <div data-testid="calendar-agenda" style={{ flex: 1, minWidth: 0, overflow: "auto" }}>
            {agendaDays.length === 0 ? (
              <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)", padding: "var(--space-4)", textAlign: "center" }}>
                {t("pim.agendaEmpty", { defaultValue: "Keine anstehenden Termine." })}
              </div>
            ) : (
              agendaDays.map(({ key, events: evs, tasks: tks }, gi) => {
                const [yy, mm, dd] = key.split("-").map(Number);
                const dateObj = new Date(yy ?? 1970, (mm ?? 1) - 1, dd ?? 1);
                const isToday = key === todayKey;
                const isTomorrow = key === tomorrowKey;
                const kicker = isToday
                  ? t("pim.agendaToday", { defaultValue: "Heute" })
                  : isTomorrow
                    ? t("pim.agendaTomorrow", { defaultValue: "Morgen" })
                    : new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(dateObj);
                const subline =
                  isToday || isTomorrow
                    ? new Intl.DateTimeFormat(i18n.language, { weekday: "long" }).format(dateObj)
                    : new Intl.DateTimeFormat(i18n.language, { month: "long" }).format(dateObj);
                const timed = evs.filter((e) => !e.allDay);
                const allDay = evs.filter((e) => e.allDay);
                const countParts = [`${evs.length} ${t("pim.eventsLabel", { defaultValue: "Termine" })}`];
                if (tks.length > 0) countParts.push(`${tks.length} ${t("tasks.title", { defaultValue: "Aufgaben" })}`);
                return (
                  <div
                    key={key}
                    data-testid="agenda-day"
                    style={{ display: "grid", gridTemplateColumns: "92px 1fr", borderTop: gi > 0 ? "1px solid var(--border-color-light)" : "none" }}
                  >
                    {/* date rail */}
                    <div style={{ padding: "14px 6px 14px 16px" }}>
                      <div style={{ fontSize: "var(--text-xs)", letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-faint)", fontWeight: 700 }}>{kicker}</div>
                      <div style={{ fontSize: "var(--text-headline)", fontWeight: 700, lineHeight: 1.05, letterSpacing: "-.02em", color: isToday ? "var(--accent-color)" : "var(--text-main)" }}>{dd}</div>
                      <div style={{ fontSize: "var(--text-sm)", color: "var(--text-muted)" }}>{subline}</div>
                      <div style={{ marginTop: 8, fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>{countParts.join(" · ")}</div>
                    </div>
                    {/* events + tasks along the spine */}
                    <div style={{ padding: "12px 16px 14px 20px", borderLeft: "1px solid var(--border-color-light)", minWidth: 0 }}>
                      {allDay.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                          {allDay.map((e) => (
                            <button
                              key={`${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`}
                              type="button"
                              onClick={() => requestPreview(e)}
                              onContextMenu={(ev) => { ev.preventDefault(); openEventContextMenu(e, { x: ev.clientX, y: ev.clientY }); }}
                              data-testid="agenda-allday"
                              data-state={eventVisualState(e)}
                              className={`pv-evt pv-evt--soft ${eventVisualState(e) === "confirmed" ? "" : `pv-evt--${eventVisualState(e)}`}`}
                              style={{
                                fontSize: "var(--text-xs)",
                                padding: "2px 9px",
                                borderRadius: "var(--radius-pill)",
                                fontWeight: 600,
                                border: "none",
                                cursor: "pointer",
                                ["--evt-color" as string]: colorOf(e),
                                opacity: isPast(e) ? 0.55 : 1,
                                maxWidth: "100%",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <span className="pv-evt-title">{eventDisplayTitle(e.title, t("pim.untitledEvent", { defaultValue: "(ohne Titel)" }))}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      {timed.map(agendaEventRow)}
                      {tks.map((tk) => agendaTaskRow(tk, key))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {quickCreate && (
        <QuickCreatePopover
          anchor={quickCreate.anchor}
          dateLabel={formatDayLong(quickCreate.dayKey)}
          timeLabel={`${minutesToHHMM(quickCreate.startMin)}–${minutesToHHMM(quickCreate.endMin)}`}
          calendarOptions={calendarOptions}
          initialCalendarKey={defaultCalKey}
          onCancel={() => setQuickCreate(null)}
          onSave={(v) => void quickSave(v)}
          onMore={openMoreFromQuick}
        />
      )}
      {editState && (
        <EventEditModal
          mode={editState.mode}
          initial={
            editState.mode === "edit" && editState.event
              ? eventFormFromEvent(editState.event)
              : createInitial ?? emptyEventForm(selectedDay, defaultCalKey)
          }
          calendarOptions={editCalendarOptions}
          onCancel={() => { setEditState(null); setCreateInitial(null); }}
          onSubmit={submitEventForm}
          onMeetingNote={
            editState.mode === "edit" && editState.event
              ? () => { const ev = editState.event!; setEditState(null); void openMeetingNote(ev); }
              : undefined
          }
          onDelete={
            editState.mode === "edit" && editState.event
              ? () => { const ev = editState.event!; setEditState(null); requestDelete(ev); }
              : undefined
          }
          onBlock={
            editState.mode === "edit" && editState.event && writableAnyCount > 1
              ? () => { const ev = editState.event!; setEditState(null); setBlockEvent(ev); }
              : undefined
          }
          onEmailInvite={
            editState.mode === "edit" && editState.event
              ? () => { const ev = editState.event!; setEditState(null); void emailInvite(ev); }
              : undefined
          }
          rsvps={editState.mode === "edit" ? editState.event?.rsvps : undefined}
          selfResponse={editState.mode === "edit" ? editState.event?.selfResponse : undefined}
          onRespond={
            editState.mode === "edit" && editState.event
              ? (response) => respondToEventAs(editState.event!, response)
              : undefined
          }
        />
      )}
      {savePrompt && (
        <SeriesScopeModal
          action="save"
          eventTitle={savePrompt.event.title}
          changes={savePrompt.changes}
          onPick={(scope) => void onSaveScope(scope)}
          onCancel={() => setSavePrompt(null)}
        />
      )}
      {seriesPrompt && (
        <SeriesScopeModal
          action={seriesPrompt.action}
          eventTitle={seriesPrompt.event.title}
          onPick={(scope) => void onSeriesScope(scope)}
          onCancel={() => setSeriesPrompt(null)}
        />
      )}
      {blockEvent && (
        <BlockCalendarsModal
          eventTitle={blockEvent.title}
          calendars={blockTargetsFor(blockEvent)}
          isSeries={!!blockEvent.seriesMaster}
          onConfirm={(keys, mode) => void blockInCalendars(blockEvent, keys, mode)}
          onCancel={() => setBlockEvent(null)}
        />
      )}
      {peekEvent && (
        <EventPeek
          event={peekEvent}
          rows={events}
          calendarName={calNameOf(peekEvent)}
          color={peekEvent.color}
          onClose={() => setPeekEvent(null)}
          onEdit={() => requestEdit(peekEvent)}
          onMeetingNote={() => void openMeetingNote(peekEvent)}
          onEmailInvite={() => void emailInvite(peekEvent)}
          onDelete={() => { setPeekEvent(null); requestDelete(peekEvent); }}
          resolveSeriesMaster={resolveSeriesMaster}
          onSetColor={canEditEvent(peekEvent) ? (hex) => void setEventColor(peekEvent, hex) : undefined}
          onRespond={
            peekEvent.selfResponse
              ? (r) => void respondToEventAs(peekEvent, r).catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
              : undefined
          }
          onBlock={writableAnyCount > 1 ? () => { setPeekEvent(null); setBlockEvent(peekEvent); } : undefined}
        />
      )}
      {ctxMenu && (
        <EventContextMenu
          event={ctxMenu.event}
          at={{ x: ctxMenu.x, y: ctxMenu.y }}
          onClose={() => setCtxMenu(null)}
          onEdit={() => requestEdit(ctxMenu.event)}
          onMeetingNote={() => void openMeetingNote(ctxMenu.event)}
          onEmailInvite={() => void emailInvite(ctxMenu.event)}
          onDelete={() => requestDelete(ctxMenu.event)}
          onSetColor={canEditEvent(ctxMenu.event) ? (hex) => void setEventColor(ctxMenu.event, hex) : undefined}
          onRespond={
            ctxMenu.event.selfResponse
              ? (r) => void respondToEventAs(ctxMenu.event, r).catch((err) => toast.error(err instanceof Error ? err.message : String(err)))
              : undefined
          }
          onBlock={writableAnyCount > 1 ? () => setBlockEvent(ctxMenu.event) : undefined}
        />
      )}
      {peekPath && (
        <BasePeekModal
          path={peekPath}
          onClose={() => setPeekPath(null)}
          onMaximize={(p) => { onOpenPath(p, true); setPeekPath(null); }}
        />
      )}
    </div>
  );
}
