import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, Diamond, RefreshCw, CalendarPlus, CalendarCog } from "lucide-react";
import { chunkWeeks, eventDayKeys, layoutSpanningEvents, buildContiguousDays, Button, EmptyState, eventStateClass, eventStateLabelKey, eventVisualState, ICON, IconButton, blockHeightPx, layoutDayEvents, minutesInDay, nextLaneStartMin, minutesToHHMM, minutesToPx, pxToMinutes, Segmented, snapMinutes, startOfMonth, WEEK_START_CHANGED_EVENT, type WeekStartDay, weekStartDayOf, getWeekStartSetting, buildMonthCells, buildWeekCells, toast, Chip, loadBaseOverlay, overlayCandidates, overlayKey, type OverlayCandidate, type OverlayEntry , partitionStatus, statusLabel, ScrollEdge} from "@plainva/ui";
import type { PimEventRow } from "@plainva/core";
import { isoOf } from "../lib/dates";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { reauthorizeCalendarAccount } from "../services/pim/pimReauth";
import {
  subscribePimStatus,
  getPimStatus,
  listPimEvents,
  listPimCalendars,
  listPimAccounts,
  pimSyncNow,
  pimForegroundSync,
  getPimCache,
} from "../services/pim/pimService";
import { useEventEditor } from "../components/useEventEditor";
import { getActiveVaultEntry } from "../services/vaultRegistry";
import { accountRowState, deviceSignInStates, isOAuthProvider, type DeviceSignInState } from "../services/deviceSignIn";
import { DeviceSignInCard } from "../components/DeviceSignInRow";
import { AppBar } from "../components/AppBar";
import { getMobileVault } from "../services/vaultService";
import { getMobileSettings, updateMobileSettings } from "../services/mobileSettings";

/**
 * Mobile PIM calendar (calendar-mobile branch): the phone twin of the desktop
 * time-grid, with Day / 3-day / Agenda views over the same shared @plainva/ui
 * time-grid math. Tapping an event opens an action sheet (RSVP when invited).
 * No accounts -> an empty state pointing at Settings. Daily notes have their
 * own Today screen, so this is the direct Calendar-tab destination.
 */

type PimView = "day" | "3day" | "week" | "month" | "agenda";
const ALL_VIEWS: PimView[] = ["day", "3day", "week", "month", "agenda"];
/**
 * The same key the desktop uses (`CalendarView.tsx`): device-local, not synced
 * — which view you like on a phone is a fact about the phone. It was a bare
 * `useState("day")` here while the overlays two lines down were persisted
 * (feedback round 2026-09-01, A1).
 */
const VIEW_KEY = "plainva-calendar-view";
function storedView(): PimView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return (ALL_VIEWS as string[]).includes(v ?? "") ? (v as PimView) : "day";
  } catch {
    return "day";
  }
}

/** The appointment a pushed calendar should land on (a tapped reminder, M4). */
export interface CalendarFocus {
  uid: string;
  accountId: string;
  calendarId: string;
  startTs: number;
}

/** Route payload → focus; an empty or foreign payload is simply "no focus". */
export function parseCalendarFocus(path: string): CalendarFocus | undefined {
  if (!path) return undefined;
  try {
    const v = JSON.parse(path) as Partial<CalendarFocus>;
    if (typeof v.uid === "string" && typeof v.accountId === "string" && typeof v.calendarId === "string" && typeof v.startTs === "number") {
      return { uid: v.uid, accountId: v.accountId, calendarId: v.calendarId, startTs: v.startTs };
    }
  } catch {
    /* not a focus */
  }
  return undefined;
}
/** The hour gutter, one value for the header, the all-day strip and the grid. */
const GUTTER_PX = 44;
const PX_PER_HOUR = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

export function PimCalendarScreen({
  onSearch,
  bump,
  onBack,
  onMenu,
  onOpenSettings,
  onOpenNote,
  focus,
}: {
  /** Absent when this surface is pushed — the root offers the search. */
  onSearch?: () => void;
  bump: number;
  /** Land on this appointment (a tapped reminder); see CalendarFocus. */
  focus?: CalendarFocus;
  onBack?: () => void;
  /** App settings in the leading slot of a root surface (N1.5). */
  onMenu?: () => void;
  onOpenSettings?: () => void;
  /** Opens a vault note — used by "Besprechungsnotiz" (S27). */
  onOpenNote?: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const status = useSyncExternalStore(subscribePimStatus, getPimStatus);
  const [view, setView] = useState<PimView>(storedView);
  const [anchor, setAnchor] = useState(() => (focus ? new Date(focus.startTs) : new Date()));
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      /* preference simply doesn't persist */
    }
  }, [view]);
  const [events, setEvents] = useState<PimEventRow[]>([]);
  // Calendar colours, so an event without its own colour still reads as
  // belonging to its calendar (desktop parity).
  const [calColor, setCalColor] = useState<Map<string, string>>(new Map());
  const [hasAccounts, setHasAccounts] = useState<boolean | null>(null);
  /**
   * The account that came through the settings sync but never signed in HERE
   * (plan P7). Only set when NO account on this device is signed in — a partly
   * working calendar must never be replaced by an explanation.
   */
  /**
   * The account whose sign-in this screen has to explain, when NO account works
   * here. `state` distinguishes "never signed in on this device" from "the
   * sign-in expired" — the second used to be invisible: the row said "aktiv",
   * the calendar stayed empty, and the reason sat unread in the cache (§2.9).
   */
  const [needsSignIn, setNeedsSignIn] = useState<{ id: string; label: string; provider: string; state: DeviceSignInState; reason?: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef, async () => { pimSyncNow(); });

  // The week and the month follow the SHARED first-day-of-week setting (S26):
  // a vault whose week starts on Sunday must start on Sunday everywhere.
  const [weekStart, setWeekStart] = useState<WeekStartDay>(1);

  // Database views shown alongside the appointments (S18b, plan P9a). The
  // selection is a vault setting and arrives through the settings sync — who
  // picks it on the desktop finds it here.
  const [ovCands, setOvCands] = useState<OverlayCandidate[]>([]);
  const [ovKeys, setOvKeys] = useState<string[]>([]);
  const [ovEntries, setOvEntries] = useState<OverlayEntry[]>([]);
  useEffect(() => {
    const load = () => void getWeekStartSetting().then((v) => setWeekStart(weekStartDayOf(v)));
    load();
    window.addEventListener(WEEK_START_CHANGED_EVENT, load);
    return () => window.removeEventListener(WEEK_START_CHANGED_EVENT, load);
  }, []);

  /**
   * The banner's own action (N9.3). It used to call `onOpenSettings()` — the
   * most prominent button on the surface changed the screen and signed nothing
   * in, and on the accounts list the real action then looked like a paragraph.
   * Both places now run the SAME chain, so a renewal always binds the same
   * account id and the row keeps its calendars.
   *
   * CalDAV is the one case that genuinely needs the form: renewing it means
   * typing a server and a password, not granting a consent. Then — and only
   * then — the button says so and leads there.
   */
  const renewSignIn = useCallback(async () => {
    if (!needsSignIn) return;
    const out = await reauthorizeCalendarAccount(needsSignIn);
    if (out.kind === "needsForm") {
      toast.info(
        out.reason === "caldav"
          ? t("pim.reconnectCaldavHint")
          : t("pim.googleClientIdRequired"),
      );
      onOpenSettings?.();
      return;
    }
    if (out.kind === "failed") toast.error(out.error);
  }, [needsSignIn, onOpenSettings, t]);

  const days = useMemo(() => {
    if (view === "day") return [anchor];
    if (view === "3day") return buildContiguousDays(anchor, 3);
    if (view === "week") return buildWeekCells(anchor, weekStart);
    if (view === "month") return buildMonthCells(startOfMonth(anchor), weekStart);
    return buildContiguousDays(anchor, 60); // agenda window
  }, [view, anchor, weekStart]);

  const rangeStart = useMemo(() => new Date(days[0].getFullYear(), days[0].getMonth(), days[0].getDate()).getTime(), [days]);
  const rangeEnd = useMemo(() => {
    const last = days[days.length - 1];
    return new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime() + DAY_MS;
  }, [days]);

  const reload = useCallback(() => {
    void listPimEvents(rangeStart, rangeEnd).then(setEvents).catch(() => setEvents([]));
    void listPimCalendars()
      .then((cals) => setCalColor(new Map(cals.map((c) => [`${c.accountId} ${c.id}`, c.color ?? ""]))))
      .catch(() => setCalColor(new Map()));
    void listPimAccounts().then(async (a) => {
      setHasAccounts(a.length > 0);
      if (a.length === 0) {
        setNeedsSignIn(null);
        return;
      }
      const vault = await getActiveVaultEntry();
      // A "device" account signs in through the system permission, not a slot (its rows default to active below).
      const states = await deviceSignInStates("pim", vault.id, a.filter((r) => r.provider !== "device").map((r) => r.id));
      const cache = getPimCache();
      const rows = await Promise.all(
        a.map(async (r) => {
          const scope = cache ? await cache.getScopeState(r.id, "account").catch(() => null) : null;
          const reason = scope?.lastError ?? undefined;
          return { ...r, reason, state: accountRowState(states.get(r.id) ?? "active", reason) };
        })
      );
      const working = rows.find((r) => r.state === "active");
      // A single working account is enough to show a calendar — only when NONE
      // works does the screen owe an explanation, and then the one it names is
      // the account it can actually say something about.
      const broken = rows.find((r) => r.state === "expired") ?? rows[0];
      setNeedsSignIn(working ? null : { id: broken.id, label: broken.label, provider: broken.provider, state: broken.state, reason: broken.reason });
    });
  }, [rangeStart, rangeEnd]);

  useEffect(() => { reload(); }, [reload, bump]);
  // Opening a screen that shows PIM data pulls fresh (plan
  // Mobile-PIM-Auffrischung, P3). The worker comment promised exactly this
  // — "opening the calendar tab" — and it was never wired; the two-minute
  // interval is dead while the app is away, so without it the first thing a
  // reader sees can be minutes old. Throttled inside the service.
  useEffect(() => { pimForegroundSync(); }, []);
  useEffect(() => {
    const onChanged = () => reload();
    window.addEventListener("m-pim-changed", onChanged);
    return () => window.removeEventListener("m-pim-changed", onChanged);
  }, [reload]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const vault = await getMobileVault();
        const qs = vault.queryService;
        const adapter = vault.adapter;
        if (!qs || !adapter) return;
        const bases = await qs.listBases();
        const cands: OverlayCandidate[] = [];
        for (const b of bases) {
          try {
            cands.push(...overlayCandidates(b.path, b.title, await adapter.readTextFile(b.path)));
          } catch {
            /* one unreadable database costs its own views, not the row */
          }
        }
        const keys = getMobileSettings().calendarOverlays ?? [];
        if (!alive) return;
        setOvCands(cands);
        setOvKeys(keys);
        setOvEntries(keys.length ? await loadBaseOverlay(keys, bases, { vaultAdapter: adapter, queryService: qs }) : []);
      } catch {
        if (alive) setOvCands([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggleOverlay = useCallback(
    (key: string) => {
      const next = ovKeys.includes(key) ? ovKeys.filter((k) => k !== key) : [...ovKeys, key];
      setOvKeys(next);
      void updateMobileSettings({ calendarOverlays: next }).catch(() => {});
      void (async () => {
        try {
          const vault = await getMobileVault();
          const qs = vault.queryService;
          const adapter = vault.adapter;
          if (!qs || !adapter) return;
          setOvEntries(next.length ? await loadBaseOverlay(next, await qs.listBases(), { vaultAdapter: adapter, queryService: qs }) : []);
        } catch {
          setOvEntries([]);
        }
      })();
    },
    [ovKeys]
  );

  /** Entries by day, so the day lists can merge them with the appointments. */
  const ovByDay = useMemo(() => {
    const map = new Map<string, OverlayEntry[]>();
    for (const e of ovEntries) {
      const list = map.get(e.day) ?? [];
      list.push(e);
      map.set(e.day, list);
    }
    return map;
  }, [ovEntries]);

  const byDay = useMemo(() => {
    const map = new Map<string, PimEventRow[]>();
    for (const e of events) {
      // EVERY day the event touches, not just the one it starts on (S5). The
      // phone kept a shortcut here, so a three-day trip existed on day one and
      // nowhere else — the days literally did not know about each other.
      for (const civil of eventDayKeys(e)) {
        const list = map.get(civil);
        if (list) list.push(e);
        else map.set(civil, [e]);
      }
    }
    return map;
  }, [events]);

  /** Multi-day events per week row of the month grid — the shared helper. */
  const monthSpans = useMemo(() => {
    if (view !== "month") return [];
    return chunkWeeks(days).map((week) => layoutSpanningEvents(week.map(isoOf), events, { keysOf: eventDayKeys }));
  }, [view, days, events]);

  const navPeriod = (dir: -1 | 1) => {
    if (view === "month") {
      // Months are not a number of days — stepping by 30 skips February.
      setAnchor((d) => new Date(d.getFullYear(), d.getMonth() + dir, 1));
      return;
    }
    const step = view === "3day" ? 3 : view === "week" ? 7 : view === "agenda" ? 30 : 1;
    setAnchor((d) => new Date(d.getTime() + dir * step * DAY_MS));
  };

  const colorOf = (e: PimEventRow) => e.color || calColor.get(`${e.accountId} ${e.calendarId}`) || "var(--accent-color)";
  /** The one-word state ("Abgesagt", "Offen", "Vielleicht") for an agenda row;
   * confirmed events say nothing (report 2026-07-29 F7/F8). */
  const stateLabel = (e: PimEventRow) => {
    const key = eventStateLabelKey(eventVisualState(e));
    return key ? t(key) : null;
  };
  const todayIso = isoOf(new Date());

  // ── Writing events (S24) ──────────────────────────────────────────────────
  // The calendar could show and answer; it could not write. A tapped slot
  // creates, a tapped event edits, and both go through the shared write rules.
  // Opening, editing, deleting, the series question, the meeting note and the
  // RSVP replies all live in the shared editor now (N1.3), so "Today" can open
  // an appointment without a second copy of the same decisions.
  const editor = useEventEditor({ bump, onOpenNote, rows: events });
  // A tapped reminder lands on ITS appointment: the day view at its day, and
  // the appointment opened — not "today" (feedback round 2026-09-01, M4).
  // Looked up in the cache by its ids; a moved or deleted appointment says so
  // and leaves the day view where the reminder pointed.
  const focusedKey = focus ? `${focus.accountId}|${focus.calendarId}|${focus.uid}|${focus.startTs}` : null;
  useEffect(() => {
    if (!focus) return;
    let alive = true;
    setView("day");
    setAnchor(new Date(focus.startTs));
    void (async () => {
      const cache = getPimCache();
      const row = cache ? await cache.getEventByUid(focus.accountId, focus.calendarId, focus.uid).catch(() => null) : null;
      if (!alive) return;
      if (row) editor.openEvent(row);
      else toast.error(t("reminders.eventGone"));
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusedKey]);

  const periodTitle = () => {
    if (view === "day") return new Intl.DateTimeFormat(i18n.language, { weekday: "long", day: "numeric", month: "long" }).format(anchor);
    if (view === "agenda") return t("pim.viewAgenda", { defaultValue: "Agenda" });
    if (view === "month") return new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(anchor);
    const first = days[0];
    const last = days[days.length - 1];
    const d = new Intl.DateTimeFormat(i18n.language, { day: "numeric" });
    const dm = new Intl.DateTimeFormat(i18n.language, { day: "numeric", month: "short" });
    return `${d.format(first)}.–${dm.format(last)}`;
  };

  const hours = useMemo(() => Array.from({ length: 24 }, (_, h) => h), []);

  // Auto-scroll to ~07:00 (or now) when the day set changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || view === "agenda") return;
    const focusHour = days.some((d) => isoOf(d) === todayIso) ? Math.max(0, new Date().getHours() - 1) : 7;
    el.scrollTop = focusHour * PX_PER_HOUR;
  }, [view, rangeStart, days, todayIso]);

  return (
    <div className="m-page m-page--pimcal">
      {/* Pushed from "More": the back header. On the Calendar TAB the shell's
          large app bar is the only top bar (see .m-pimbar). */}
      <AppBar
        large={!onBack}
        onBack={onBack}
        onMenu={onMenu}
        onSearch={onSearch}
        /* The period belongs in the bar (N5.1): the toolbar below has to fit
           two arrows, "today" and two more buttons beside it, and a German
           weekday date was being cut to "Sonnt…" there. Here it has the width
           it needs, and it answers the bar's question — where am I. */
        subtitle={periodTitle()}
        title={t("mobile.tabCalendar", { defaultValue: "Kalender" })}
      />
      <div className="m-pimbar">
        <IconButton label={t("pim.prevPeriod", { defaultValue: "Zurück" })} onClick={() => navPeriod(-1)}>
          <ChevronLeft size={ICON.head} />
        </IconButton>

        <IconButton label={t("pim.nextPeriod", { defaultValue: "Weiter" })} onClick={() => navPeriod(1)}>
          <ChevronRight size={ICON.head} />
        </IconButton>
        {/* "Today" belongs WITH the arrows: all three move the period, and
            since the period label moved up into the app bar the spacer between
            them left a hole in the middle of the row where a label used to be.
            Navigation on the left, actions on the right — the ordinary shape of
            a toolbar, and no gap that looks like something is missing. */}
        <IconButton
          label={t("pim.today", { defaultValue: "Heute" })}
          className="m-pimbar-today"
          onClick={() => setAnchor(new Date())}
        >
          {t("pim.today", { defaultValue: "Heute" })}
        </IconButton>
        <span className="m-pimbar-spacer" />
        {/* Creating lives in the calendar's own bar, not in a second floating
            button (S24): the tab already carries the vault's capture FAB, and
            two stacked FABs mean the surface has no primary action at all. */}
        <IconButton
          label={t("pim.newEvent")}
          onClick={() => {
            const d = new Date(anchor);
            d.setMinutes(0, 0, 0);
            if (isoOf(d) === todayIso) d.setHours(new Date().getHours() + 1);
            else d.setHours(9);
            editor.openCreate(d.getTime());
          }}
        >
          <CalendarPlus size={ICON.head} />
        </IconButton>
        <IconButton
          label={t("mobile.syncNow")}
          onClick={() => pimSyncNow()}
        >
          <RefreshCw size={ICON.head} className={status.status === "syncing" ? "m-spin" : undefined} />
        </IconButton>
        {onOpenSettings && (
          <IconButton label={t("pim.accounts", { defaultValue: "Kalenderkonten" })} onClick={onOpenSettings}>
            <CalendarCog size={ICON.head} />
          </IconButton>
        )}
      </div>

      {/* View segment */}
      <Segmented
        ariaLabel={t("pim.viewSwitch", { defaultValue: "Ansicht" })}
        options={[
          { value: "day", label: t("pim.viewDay", { defaultValue: "Tag" }) },
          { value: "3day", label: t("pim.view3Day", { defaultValue: "3 Tage" }) },
          { value: "week", label: t("pim.viewWeek") },
          { value: "month", label: t("pim.viewMonth"), testId: "pim-view-month" },
          { value: "agenda", label: t("pim.viewAgenda", { defaultValue: "Agenda" }) },
        ]}
        value={view}
        onChange={(v) => setView(v as PimView)}
      />

      {/* The "show" row (S18b): a scrolling chip row instead of the desktop's
          bar. The chips carry a diamond in BOTH states — it is what says
          "notes", and switching one on must not take that away. */}
      {ovCands.length > 0 && (
        <ScrollEdge axis="x" className="m-chiprow" data-testid="pim-overlay-row">
          {ovCands.map((c) => {
            const key = overlayKey(c);
            return (
              <Chip
                key={key}
                icon={<Diamond size={ICON.meta} />}
                selected={ovKeys.includes(key)}
                onClick={() => toggleOverlay(key)}
                testId={`pim-overlay-${key}`}
              >
                {c.label}
              </Chip>
            );
          })}
        </ScrollEdge>
      )}

      {hasAccounts === false ? (
        <EmptyState
          icon={<CalendarPlus size={ICON.empty} />}
          action={
            onOpenSettings ? (
              <Button variant="primary" onClick={onOpenSettings}>
                {t("pim.connectAccount", { defaultValue: "Konto verbinden" })}
              </Button>
            ) : undefined
          }
        >
          {t("pim.noAccountsMobile", { defaultValue: "Noch kein Kalenderkonto verbunden." })}
        </EmptyState>
      ) : needsSignIn ? (
        <div className="m-scroll">
          <DeviceSignInCard
            accountLabel={needsSignIn.label}
            oauth={isOAuthProvider(needsSignIn.provider)}
            state={needsSignIn.state}
            reason={needsSignIn.reason}
            onSignIn={() => void renewSignIn()}
            providerLabel={needsSignIn.provider}
          />
        </div>
      ) : view === "month" ? (
        // The month is a grid of days with dots, not a squeezed time grid: at
        // 375 px a full month of positioned blocks is unreadable, and what one
        // wants from a month is "which days are busy" plus a way in.
        <div ref={ptrRef} className="m-scroll">
          {ptrIndicator}
          <div className="m-cal-grid m-cal-grid--month">
            {days.slice(0, 7).map((d) => (
              <div className="m-cal-wd" key={`wd-${d.getDay()}`}>
                {new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(d)}
              </div>
            ))}
            {days.map((d, cellIndex) => {
              const key = isoOf(d);
              const spans = monthSpans[Math.floor(cellIndex / 7)];
              // A spanning event is drawn once as a bar; its dot would repeat it.
              const list = (byDay.get(key) ?? []).filter((e) => !spans?.spanned.has(e));
              const outside = d.getMonth() !== anchor.getMonth();
              return (
                <button
                  className={`m-cal-day${outside ? " is-outside" : ""}${key === todayIso ? " is-today" : ""}`}
                  key={key}
                  style={{ gridRow: Math.floor(cellIndex / 7) + 2, gridColumn: (cellIndex % 7) + 1 }}
                  onClick={() => {
                    // A tapped day opens that day — the month answers "when",
                    // the day answers "what".
                    setAnchor(d);
                    setView("day");
                  }}
                >
                  <span>{d.getDate()}</span>
                  <span className="m-cal-dots">
                    {list.slice(0, 3).map((e) => (
                      <span
                        className="m-cal-dot"
                        key={`${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`}
                        style={{ background: colorOf(e) }}
                      />
                    ))}
                    {/* A database entry gets a HOLLOW dot — a month cell has
                        room for a mark, not for a label, and the difference
                        between note and appointment has to survive it. */}
                    {(ovByDay.get(key) ?? []).slice(0, 2).map((entry) => (
                      <span className="m-cal-dot m-cal-dot--note" key={`ov-${entry.basePath}-${entry.path}`} />
                    ))}
                  </span>
                </button>
              );
            })}
            {/* One bar per multi-day event, spanning its columns — the same
                shared layout the desktop month grid uses. A dot per day said
                nothing about the days belonging together. */}
            {monthSpans.flatMap((week, weekIndex) =>
              week.bars.map((bar) => (
                <button
                  className={`m-cal-span${bar.clippedStart ? " is-cut-start" : ""}${bar.clippedEnd ? " is-cut-end" : ""}`}
                  key={`span-${weekIndex}-${bar.event.accountId}-${bar.event.calendarId}-${bar.event.uid}-${bar.event.start.ts}`}
                  data-testid="pim-month-span"
                  onClick={() => void editor.openEvent(bar.event)}
                  style={{
                    gridRow: weekIndex + 2,
                    gridColumn: `${bar.startCol + 1} / span ${bar.endCol - bar.startCol + 1}`,
                    background: colorOf(bar.event),
                    marginTop: `calc(var(--m-cal-span-top) + ${bar.lane} * var(--m-cal-span-h))`,
                  }}
                  type="button"
                >
                  {!bar.clippedStart ? <span className="m-cal-span-title">{bar.event.title}</span> : null}
                </button>
              )),
            )}
          </div>
        </div>
      ) : view === "agenda" ? (
        <div ref={ptrRef} className="m-scroll">
          {ptrIndicator}
          {days.filter((d) => (byDay.get(isoOf(d)) ?? []).length > 0 || (ovByDay.get(isoOf(d)) ?? []).length > 0).map((d) => {
            const key = isoOf(d);
            // Status entries (S24) come first and read as STATES of the day,
            // not as things happening in it. A list has no "behind", so where
            // the desktop puts a band this puts a row with its own mark.
            const split = partitionStatus([...(byDay.get(key) ?? [])]);
            const list = split.appointments.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.ts - b.start.ts);
            return (
              <div key={key}>
                <div style={{ position: "sticky", top: 0, background: "var(--bg-secondary)", padding: "4px 12px", fontSize: "var(--text-xs)", fontWeight: 600, color: key === todayIso ? "var(--accent-color)" : "var(--text-muted)" }}>
                  {new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "long" }).format(d)}
                </div>
                {split.status.map((e) => (
                  <div
                    key={`st-${e.accountId}-${e.calendarId}-${e.uid}`}
                    className={`m-row m-status-row m-status-row--${e.statusKind}`}
                    data-testid="pim-status-event"
                    data-status={e.statusKind}
                  >
                    <span aria-hidden className="m-status-mark" />
                    <span className="m-status-label">{statusLabel(e, t)}</span>
                  </div>
                ))}
                {list.map((e) => (
                  <button key={`${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`} type="button" className="m-row" data-testid="pim-event" data-state={eventVisualState(e)} onClick={() => void editor.openEvent(e)} style={{ width: "100%", textAlign: "left", ["--evt-color" as string]: colorOf(e) }}>
                    <span className={`m-evt-mark ${eventVisualState(e) === "confirmed" ? "" : `m-evt-mark--${eventVisualState(e)}`}`} style={{ width: 6, height: 6, borderRadius: "var(--radius-pill)", flexShrink: 0 }} />
                    <span className={`m-evt-title ${eventVisualState(e) === "cancelled" ? "m-evt--cancelled" : ""}`} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</span>
                    {stateLabel(e) ? <span className="m-evt-state">{stateLabel(e)}</span> : null}
                    <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", flexShrink: 0 }}>
                      {e.allDay ? t("pim.allDay", { defaultValue: "Ganztägig" }) : new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(e.start.ts))}
                    </span>
                  </button>
                ))}
                {(ovByDay.get(key) ?? []).map((entry) => (
                  // A note, not an appointment: dashed edge and a diamond, and
                  // it opens the note rather than the event sheet.
                  <button
                    key={`ov-${entry.basePath}-${entry.path}`}
                    type="button"
                    className="m-row m-overlay-entry"
                    data-testid="pim-overlay-entry"
                    onClick={() => onOpenNote?.(entry.path)}
                    style={{ width: "100%", textAlign: "left" }}
                  >
                    <Diamond size={ICON.meta} style={{ flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.title}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", flexShrink: 0 }}>{entry.source}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div ref={scrollRef} className="m-scroll" style={{ position: "relative" }} data-testid="pim-timegrid">
          {/* The column says WHICH day, same as the desktop. Without it the
              grid answered "at what time" and left "on what date" to the
              period label above it — fine for one day, unreadable for three
              (device report 2026-08-15, point 2). The header and the all-day
              strip scroll away with the grid on a phone: 812 px of screen has
              no room to pin them. */}
          <div style={{ display: "flex", position: "sticky", top: 0, zIndex: "var(--z-m-bar)", background: "var(--bg-primary)", borderBottom: "1px solid var(--border-color-light)" }}>
            <div style={{ width: GUTTER_PX, flexShrink: 0 }} />
            {days.map((day) => {
              const key = isoOf(day);
              const isToday = key === todayIso;
              return (
                <div
                  data-testid="pim-daycol-head"
                  key={key}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    textAlign: "center",
                    padding: "var(--space-1)",
                    fontSize: "var(--text-xs)",
                    fontWeight: isToday ? 700 : 500,
                    color: isToday ? "var(--accent-color)" : "var(--text-muted)",
                    borderLeft: "1px solid var(--border-color-light)",
                  }}
                >
                  {new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric" }).format(day)}
                </div>
              );
            })}
          </div>

          {/* All-day events had nowhere to go in this view: the grid draws only
              timed blocks, so a whole-day appointment was simply invisible
              here. */}
          {days.some((d) => (byDay.get(isoOf(d)) ?? []).some((e) => e.allDay)) && (
            <div style={{ display: "flex", borderBottom: "1px solid var(--border-color-light)" }} data-testid="pim-allday-strip">
              <div style={{ width: GUTTER_PX, flexShrink: 0, fontSize: "var(--text-xs)", color: "var(--text-faint)", padding: "var(--space-1)", textAlign: "right" }}>
                {t("pim.allDay", { defaultValue: "Ganztägig" })}
              </div>
              {days.map((day) => (
                <div
                  key={isoOf(day)}
                  style={{ flex: 1, minWidth: 0, borderLeft: "1px solid var(--border-color-light)", padding: "var(--space-1)", display: "flex", flexDirection: "column", gap: "var(--space-1)" }}
                >
                  {(byDay.get(isoOf(day)) ?? []).filter((e) => e.allDay).map((e) => (
                    <button
                      className={eventStateClass("m-evt", eventVisualState(e))}
                      data-state={eventVisualState(e)}
                      data-testid="pim-event"
                      key={`${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`}
                      onClick={() => void editor.openEvent(e)}
                      style={{ ["--evt-color" as string]: colorOf(e), border: "none", borderRadius: "var(--radius-xs)", padding: "var(--space-1)", textAlign: "left", overflow: "hidden", fontSize: "var(--text-xs)", fontWeight: 600, lineHeight: 1.15, whiteSpace: "nowrap", textOverflow: "ellipsis" }}
                      type="button"
                    >
                      <span className="m-evt-title">{e.title}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: "flex", position: "relative", height: 24 * PX_PER_HOUR }}>
            <div style={{ width: GUTTER_PX, flexShrink: 0, position: "relative" }}>
              {hours.map((h) => (
                <div key={h} style={{ position: "absolute", top: h * PX_PER_HOUR, right: 5, transform: "translateY(-50%)", fontSize: "var(--text-xs)", color: "var(--text-faint)", fontVariantNumeric: "tabular-nums" }}>
                  {h > 0 ? minutesToHHMM(h * 60) : ""}
                </div>
              ))}
            </div>
            {days.map((day) => {
              const key = isoOf(day);
              const dayStartMs = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
              const dayEndMs = dayStartMs + DAY_MS;
              const all = byDay.get(key) ?? [];
              const timed = all.filter((e) => !e.allDay);
              const clamped = timed.map((e) => ({ ev: e, startMs: Math.max(e.start.ts, dayStartMs), endMs: Math.min(Math.max(e.end.ts, e.start.ts + 1), dayEndMs) }));
              const laid = layoutDayEvents(clamped, (c) => `${c.ev.accountId}-${c.ev.calendarId}-${c.ev.uid}-${c.ev.start.ts}`);
              const isToday = key === todayIso;
              const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
              return (
                <div
                  key={key}
                  onClick={(ev) => {
                    // Only the empty grid creates — an event handles its own tap.
                    if ((ev.target as HTMLElement).closest("[data-testid='pim-event']")) return;
                    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                    const min = snapMinutes(pxToMinutes(ev.clientY - rect.top, PX_PER_HOUR), 30);
                    editor.openCreate(dayStartMs + min * 60_000);
                  }}
                  style={{ flex: 1, minWidth: 0, position: "relative", borderLeft: "1px solid var(--border-color-light)" }}
                >
                  {hours.map((h) => (
                    <div key={h} style={{ position: "absolute", left: 0, right: 0, top: h * PX_PER_HOUR, borderTop: "1px solid var(--border-color-light)", opacity: 0.5 }} />
                  ))}
                  {laid.map((l, li) => {
                    const startMin = minutesInDay(l.event.startMs, dayStartMs);
                    const endMin = Math.max(startMin + 1, minutesInDay(l.event.endMs, dayStartMs));
                    const top = minutesToPx(startMin, PX_PER_HOUR);
                    // Same rule as the desktop: the minimum height grows only
                    // into free room; a touching successor keeps the true height.
                    const nextStartMin = nextLaneStartMin(
                      laid.map((o) => ({ lane: o.lane, startMin: minutesInDay(o.event.startMs, dayStartMs), endMin: Math.max(minutesInDay(o.event.startMs, dayStartMs) + 1, minutesInDay(o.event.endMs, dayStartMs)) })),
                      li,
                    );
                    const { height, compact } = blockHeightPx({ startMin, endMin, nextStartMin, pxPerHour: PX_PER_HOUR, minPx: 15 });
                    const laneWidthPct = 100 / l.lanes;
                    const widthPct = laneWidthPct * l.span;
                    const e = l.event.ev;
                    return (
                      <button
                        key={`${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`}
                        type="button"
                        data-testid="pim-event"
                        data-state={eventVisualState(e)}
                        data-compact={compact ? "true" : undefined}
                        className={eventStateClass("m-evt", eventVisualState(e))}
                        onClick={() => void editor.openEvent(e)}
                        style={{ position: "absolute", top, height, left: `calc(${l.lane * laneWidthPct}% + 1px)`, width: `calc(${widthPct}% - 2px)`, ["--evt-color" as string]: colorOf(e), border: "none", borderRadius: "var(--radius-xs)", padding: compact ? "0 4px" : "1px 4px", textAlign: "left", overflow: "hidden", fontSize: "var(--text-xs)", fontWeight: 600, lineHeight: compact ? 1 : 1.15 }}
                      >
                        <span className="m-evt-title">{e.title}</span>
                      </button>
                    );
                  })}
                  {isToday && (
                    <div aria-hidden style={{ position: "absolute", left: 0, right: 0, top: minutesToPx(nowMin, PX_PER_HOUR), borderTop: "2px solid var(--error-text)", zIndex: "var(--z-m-bar)" }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {editor.element}
    </div>
  );
}
