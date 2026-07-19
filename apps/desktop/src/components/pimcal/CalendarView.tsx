import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarRange, CheckSquare, ChevronLeft, ChevronRight, ListChecks, MapPin, Plus, RefreshCw, Repeat, Square, Users } from "lucide-react";
import { buildInviteIcs } from "../../services/mail/inviteIcs";
import { utf8ToBase64 } from "../../services/mail/mailOut";
import { listMailAccounts } from "../../services/mail/mailAccounts";
import {
  Button,
  EmptyState,
  IconButton,
  Segmented,
  buildMonthCells,
  buildWeekCells,
  buildContiguousDays,
  minutesToHHMM,
  startOfMonth,
  toast,
  type WeekStartDay,
} from "@plainva/ui";
import { PimConflictError, parseRRule, type PimAccountRow, type PimEventRow, type PimCalendar, type PimEventDraft } from "@plainva/core";
import { useVault, meetingFolderKey, DEFAULT_MEETING_FOLDER, defaultCalendarKey } from "../../contexts/VaultContext";
import { getSettingsStore } from "../../services/settingsStore";
import { getTaskDatabasePath } from "../../services/taskDatabase";
import { loadDueTasks, type DueTask } from "../../services/pim/taskOverlay";
import { CALENDAR_GOTO_EVENT, consumePendingCalendarDay } from "../../services/pim/calendarNav";
import { getWeekStartSetting, weekStartDayOf, WEEK_START_CHANGED_EVENT } from "../../services/weekStart";
import { localIsoKey } from "../../services/dailyNotePath";
import { applyIndexChanges } from "../../services/fileActions";
import { appConfirm } from "../../services/appDialogs";
import { activeDocument } from "../../services/activeDocument";
import { CALENDAR_TAB_PATH } from "../graph/virtualPaths";
import {
  bucketEventsByDay,
  emptyEventForm,
  eventFormFromEvent,
  eventFormToDraft,
  eventStartDayKey,
  formatTimeRange,
  buildBlockDraft,
  type EventFormValues,
} from "../../services/pim/calendarModel";
import { resolveOrCreateMeetingNote } from "../../services/pim/meetingNote";
import { EventEditModal } from "./EventEditModal";
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

/** A single-occurrence cache row synthesized from a just-written draft, so a new
 * or edited event shows INSTANTLY instead of only after the worker's provider
 * pull. The next worker cycle re-queries the cache and replaces it with the
 * authoritative row(s) — recurrence is not expanded here on purpose. */
function draftToRow(accountId: string, calendarId: string, uid: string, draft: PimEventDraft): PimEventRow {
  return {
    uid,
    accountId,
    calendarId,
    title: draft.title,
    start: draft.start,
    end: draft.end,
    allDay: draft.allDay,
    location: draft.location,
    description: draft.description,
    color: draft.color,
    attendees: draft.attendees,
  };
}

/** Match a cache row to a provider ref (account + calendar + instance uid). */
function sameEventRef(e: PimEventRow, ref: { accountId: string; calendarId: string; uid: string }): boolean {
  return e.accountId === ref.accountId && e.calendarId === ref.calendarId && e.uid === ref.uid;
}

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
  const [showTasks, setShowTasks] = useState(() => {
    try {
      return localStorage.getItem(SHOW_TASKS_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [tasks, setTasks] = useState<CalTask[]>([]);

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
        const out = await loadDueTasks({ vaultPath, vaultAdapter, queryService });
        if (alive) setTasks(out);
      } catch {
        if (alive) setTasks([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [showTasks, vaultPath, queryService, vaultAdapter, fileTreeVersion, tick]);

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

  const byDay = useMemo(() => bucketEventsByDay(events), [events]);
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
  // Quick-create popover after a click/drag on an empty slot.
  const [quickCreate, setQuickCreate] = useState<{ dayKey: string; startMin: number; endMin: number; anchor: { x: number; y: number } } | null>(null);
  const enabledAccounts = useMemo(() => new Set(accounts.filter((a) => a.enabled).map((a) => a.id)), [accounts]);
  const writableCalendars = useMemo(
    () =>
      calendars.filter((c) => c.selected && !c.readOnly && enabledAccounts.has(c.accountId)),
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

  const submitEventForm = useCallback(
    async (values: EventFormValues) => {
      const draft = eventFormToDraft(values);
      if (editState?.mode === "edit" && editState.event) {
        const e = editState.event;
        const target = await targetFor(e.accountId);
        if (!target) throw new Error(t("pim.eventWriteFailed", { defaultValue: "Speichern beim Anbieter fehlgeschlagen." }));
        try {
          await target.updateEvent({ calendarId: e.calendarId, uid: e.uid, etag: e.etag, href: e.href }, draft);
        } catch (err) {
          if (err instanceof PimConflictError) {
            // Remote moved — close, tell, re-pull; the user edits the fresh state.
            setEditState(null);
            toast.info(t("pim.eventConflict", { defaultValue: "Der Termin wurde extern geändert — Ansicht aktualisiert." }));
            refresh();
            return;
          }
          throw err;
        }
        // Optimistic: reflect the edit at once (single occurrence; the worker
        // re-query replaces it with the authoritative row). A series-master
        // edit that has no matching instance row is a harmless no-op here.
        setEvents((prev) =>
          prev.map((ev) =>
            sameEventRef(ev, e)
              ? {
                  ...ev,
                  title: draft.title,
                  start: draft.start,
                  end: draft.end,
                  allDay: draft.allDay,
                  location: draft.location,
                  description: draft.description,
                  color: draft.color,
                }
              : ev
          )
        );
      } else {
        const [accountId, ...rest] = values.calendarKey.split(" ");
        const calId = rest.join(" ");
        if (!accountId || !calId) throw new Error(t("pim.noWritableCalendar", { defaultValue: "Kein beschreibbarer Kalender ausgewählt." }));
        const target = await targetFor(accountId);
        if (!target) throw new Error(t("pim.eventWriteFailed", { defaultValue: "Speichern beim Anbieter fehlgeschlagen." }));
        const res = await target.createEvent(calId, draft);
        // Optimistic: show the new event instantly.
        setEvents((prev) => [...prev, { ...draftToRow(accountId, calId, res.uid, draft), etag: res.etag, href: res.href }]);
      }
      setEditState(null);
      setCreateInitial(null);
      refresh();
    },
    [editState, targetFor, refresh, t]
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
        description: e.description ?? undefined,
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

  const [seriesPrompt, setSeriesPrompt] = useState<{ action: "edit" | "delete"; event: PimEventRow } | null>(null);
  // "Block in other calendars" (#1): the event being mirrored, or null.
  const [blockEvent, setBlockEvent] = useState<PimEventRow | null>(null);

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
      if (prompt.action === "edit") {
        setEditState({ mode: "edit", event: subject });
      } else {
        // The scope dialog already confirmed the deletion.
        await performDelete(subject);
      }
    },
    [seriesPrompt, resolveSeriesMaster, performDelete, t]
  );

  const requestEdit = useCallback((e: PimEventRow) => {
    if (e.seriesMaster) setSeriesPrompt({ action: "edit", event: e });
    else setEditState({ mode: "edit", event: e });
  }, []);

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
        const ics = buildInviteIcs(e, { organizer: accounts[0].user, stampMs: Date.now() });
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
      let ok = 0;
      for (const key of selectedKeys) {
        const [accountId, ...rest] = key.split(" ");
        const calId = rest.join(" ");
        if (!accountId || !calId) continue;
        const target = await targetFor(accountId);
        if (!target) continue;
        try {
          const bd = buildBlockDraft(source, mode, busyLabel, recurrence);
          const res = await target.createEvent(calId, bd);
          // Optimistic for a one-off block (a recurring block expands server-side,
          // so we let the worker re-query bring its instances).
          if (!recurrence) {
            setEvents((prev) => [...prev, { ...draftToRow(accountId, calId, res.uid, bd), etag: res.etag, href: res.href }]);
          }
          ok++;
        } catch {
          /* skip this calendar, keep the rest */
        }
      }
      if (ok > 0) {
        toast.info(t("pim.blocked", { n: ok, defaultValue: "In {{n}} Kalender(n) blockiert" }));
        refresh();
      } else {
        toast.error(t("pim.eventWriteFailed", { defaultValue: "Speichern beim Anbieter fehlgeschlagen." }));
      }
    },
    [resolveSeriesMaster, targetFor, refresh, t]
  );

  /** The OTHER writable calendars (never the event's own) for the block dialog. */
  const otherCalendarsFor = useCallback(
    (e: PimEventRow) => calendarOptions.filter((c) => c.value !== `${e.accountId} ${e.calendarId}`),
    [calendarOptions]
  );

  const calNameOf = (e: PimEventRow) => calName.get(`${e.accountId} ${e.calendarId}`) ?? "";

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
      onClick={() => requestEdit(e)}
      data-testid="calendar-event"
      className="pv-rowhover"
      style={{
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
        opacity: isPast(e) ? 0.5 : 1,
      }}
    >
      <span style={{ fontVariantNumeric: "tabular-nums", fontSize: "var(--text-xs)", color: "var(--text-muted)", fontFamily: "var(--font-mono, ui-monospace, monospace)" }}>
        {agendaStartTime(e)}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontSize: "var(--text-sm)", fontWeight: 500, display: "flex", alignItems: "center", gap: 8 }}>
          <span aria-hidden style={{ width: 4, height: 15, borderRadius: "var(--radius-pill)", background: colorOf(e), flex: "0 0 auto" }} />
          {e.seriesMaster ? <Repeat size={11} aria-label={t("pim.seriesTitle", { defaultValue: "Serientermin" })} style={{ flexShrink: 0 }} /> : null}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</span>
        </span>
        {e.location || (e.attendees?.length ?? 0) > 0 ? (
          <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 2, display: "flex", gap: 12, flexWrap: "wrap", paddingLeft: 12 }}>
            {e.location ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, overflowWrap: "anywhere" }}>
                <MapPin size={11} style={{ flexShrink: 0 }} />
                {e.location}
              </span>
            ) : null}
            {(e.attendees?.length ?? 0) > 0 ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-faint)" }} aria-label={t("pim.attendees", { defaultValue: "Teilnehmer" })}>
                <Users size={11} style={{ flexShrink: 0 }} />
                {e.attendees!.length}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
      <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)", whiteSpace: "nowrap" }}>{calNameOf(e)}</span>
    </button>
  );

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
    return (
      <button
        key={task.path}
        type="button"
        onClick={() => onOpenPath(task.path, false)}
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
        }}
      >
        <span style={{ display: "grid", placeItems: "center" }}>
          {task.done ? <CheckSquare size={15} style={{ color: "var(--accent-color)" }} /> : <Square size={15} style={{ color: "var(--text-faint)" }} />}
        </span>
        <span style={{ fontSize: "var(--text-sm)", color: "var(--text-main)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: task.done ? "line-through" : "none" }}>
          {task.title}
        </span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--warning-text)", background: "var(--warning-bg)", padding: "1px 8px", borderRadius: "var(--radius-pill)", fontWeight: 600, whiteSpace: "nowrap" }}>
          {dueLabel}
        </span>
      </button>
    );
  };

  /** The shared time grid for the day / 3-day / week views and the month day
   * pane (feedback round 3). */
  const renderTimeGrid = (gridDaysArg: Date[], showColumnHeaders: boolean) => (
    <DayTimeGrid
      days={gridDaysArg}
      byDay={byDay}
      tasksByDay={showTasks ? tasksByDay : undefined}
      colorOf={colorOf}
      calName={calNameOf}
      nowTs={nowTs}
      todayKey={todayKey}
      locale={i18n.language}
      canCreate={calendarOptions.length > 0}
      canEditEvent={canEditEvent}
      onEventClick={requestEdit}
      onOpenTask={(p) => onOpenPath(p, false)}
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
          icon={<CalendarRange size={28} />}
          title={t("pim.calendarEmpty", { defaultValue: "Kein Kalenderkonto verbunden" })}
          action={
            <Button
              variant="primary"
              onClick={() => window.dispatchEvent(new CustomEvent("plainva-open-sync-settings", { detail: { area: "pim" } }))}
              data-testid="calendar-open-settings"
            >
              {t("shortcuts.openSettings", { defaultValue: "Einstellungen öffnen" })}
            </Button>
          }
        >
          {t("pim.calendarEmptyHint", {
            defaultValue: "Verbinde in den Einstellungen unter „Kalender & Konten“ ein CalDAV-, Google- oder Microsoft-Konto.",
          })}
        </EmptyState>
      </div>
    );
  }

  return (
    <div data-testid="calendar-view" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", background: "var(--bg-primary)" }}>
      {/* Header: view segment + period navigation + status + refresh */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-2)",
          padding: "var(--space-2) var(--space-3)",
          borderBottom: "1px solid var(--border-color-light)",
          flexShrink: 0,
        }}
      >
        {viewMode !== "agenda" && (
          <IconButton label={t("pim.prevPeriod", { defaultValue: "Zurück" })} onClick={() => navPeriod(-1)} data-testid="calendar-prev">
            <ChevronLeft size={16} />
          </IconButton>
        )}
        <h2 data-testid="calendar-month-title" style={{ margin: 0, fontSize: "var(--text-md)", fontWeight: 600, minWidth: 170 }}>
          {periodTitle}
        </h2>
        {viewMode !== "agenda" && (
          <IconButton label={t("pim.nextPeriod", { defaultValue: "Weiter" })} onClick={() => navPeriod(1)} data-testid="calendar-next">
            <ChevronRight size={16} />
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
            <ListChecks size={15} style={{ color: showTasks ? "var(--accent-color)" : undefined }} />
          </IconButton>
        )}
        {viewMode !== "month" && viewMode !== "agenda" && calendarOptions.length > 0 && (
          <IconButton label={t("pim.newEvent", { defaultValue: "Neuer Termin" })} onClick={() => setEditState({ mode: "create" })} data-testid="calendar-new-event-top">
            <Plus size={15} />
          </IconButton>
        )}
        <IconButton label={t("pim.refreshNow", { defaultValue: "Jetzt aktualisieren" })} onClick={refresh} data-testid="calendar-refresh">
          <RefreshCw size={15} />
        </IconButton>
      </div>

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
            {cells.map((cell) => {
              const key = localIsoKey(cell);
              const list = byDay.get(key) ?? [];
              const dayTaskList = showTasks ? tasksByDay.get(key) ?? [] : [];
              // Events fill the available lines first; remaining lines show tasks.
              const shownEvents = list.slice(0, maxCellItems);
              const shownTasks = dayTaskList.slice(0, Math.max(0, maxCellItems - shownEvents.length));
              const overflow = list.length + dayTaskList.length - shownEvents.length - shownTasks.length;
              const inMonth = cell.getMonth() === viewMonth;
              const isToday = key === todayKey;
              const isSelected = key === selectedDay;
              return (
                <button
                  key={key}
                  data-testid={`calendar-day-${key}`}
                  onClick={() => setSelectedDay(key)}
                  style={{
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
                    style={{
                      fontSize: "var(--text-xs)",
                      fontWeight: isToday ? 700 : 400,
                      color: isToday ? "var(--accent-color)" : "var(--text-muted)",
                    }}
                  >
                    {cell.getDate()}
                  </span>
                  {shownEvents.map((e) => (
                    <span
                      key={`${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                        fontSize: 11,
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
                        style={{ width: 6, height: 6, borderRadius: "var(--radius-pill)", background: colorOf(e), flexShrink: 0 }}
                      />
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{e.title}</span>
                    </span>
                  ))}
                  {shownTasks.map((task) => (
                    <span
                      key={`task-${task.path}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 3,
                        fontSize: 11,
                        color: task.done ? "var(--text-muted)" : "var(--text-main)",
                        textDecoration: task.done ? "line-through" : "none",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        minWidth: 0,
                      }}
                    >
                      {task.done ? <CheckSquare size={9} style={{ flexShrink: 0, color: "var(--accent-color)" }} /> : <Square size={9} style={{ flexShrink: 0, color: "var(--text-muted)" }} />}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{task.title}</span>
                    </span>
                  ))}
                  {overflow > 0 ? (
                    <span style={{ fontSize: 10, color: "var(--text-muted)" }}>+{overflow}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Day pane: single-day time grid for the selected day — wide enough to
            read event titles and times comfortably (maintainer: give it more room). */}
        <div
          data-testid="calendar-day-pane"
          style={{ width: 360, flexShrink: 0, borderLeft: "1px solid var(--border-color-light)", display: "flex", flexDirection: "column", minHeight: 0 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-2)", padding: "var(--space-2) var(--space-3)", flexShrink: 0, borderBottom: "1px solid var(--border-color-light)" }}>
            <h3 style={{ margin: 0, fontSize: "var(--text-sm)", fontWeight: 600, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dayTitle}</h3>
            {calendarOptions.length > 0 && (
              <IconButton
                label={t("pim.newEvent", { defaultValue: "Neuer Termin" })}
                onClick={() => setEditState({ mode: "create" })}
                data-testid="calendar-new-event"
              >
                <Plus size={15} />
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
                      <div style={{ fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--text-faint)", fontWeight: 700 }}>{kicker}</div>
                      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.05, letterSpacing: "-.02em", color: isToday ? "var(--accent-color)" : "var(--text-main)" }}>{dd}</div>
                      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{subline}</div>
                      <div style={{ marginTop: 8, fontSize: 11, color: "var(--text-faint)" }}>{countParts.join(" · ")}</div>
                    </div>
                    {/* events + tasks along the spine */}
                    <div style={{ padding: "12px 16px 14px 20px", borderLeft: "1px solid var(--border-color-light)", minWidth: 0 }}>
                      {allDay.length > 0 && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                          {allDay.map((e) => (
                            <button
                              key={`${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`}
                              type="button"
                              onClick={() => requestEdit(e)}
                              data-testid="agenda-allday"
                              style={{
                                fontSize: 11.5,
                                padding: "2px 9px",
                                borderRadius: "var(--radius-pill)",
                                fontWeight: 600,
                                border: "none",
                                cursor: "pointer",
                                color: colorOf(e),
                                background: `color-mix(in srgb, ${colorOf(e)} 16%, transparent)`,
                                opacity: isPast(e) ? 0.55 : 1,
                                maxWidth: "100%",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {e.title}
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
          calendarOptions={calendarOptions}
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
            editState.mode === "edit" && editState.event && calendarOptions.length > 1
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
          calendars={otherCalendarsFor(blockEvent)}
          isSeries={!!blockEvent.seriesMaster}
          onConfirm={(keys, mode) => void blockInCalendars(blockEvent, keys, mode)}
          onCancel={() => setBlockEvent(null)}
        />
      )}
    </div>
  );
}
