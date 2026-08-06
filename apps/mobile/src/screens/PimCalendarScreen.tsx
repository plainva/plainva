import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, RefreshCw, CalendarPlus, CalendarCog } from "lucide-react";
import { buildContiguousDays, Button, EmptyState, eventStateClass, eventStateLabelKey, eventVisualState, ICON, IconButton, layoutDayEvents, minutesInDay, minutesToHHMM, minutesToPx, pxToMinutes, Segmented, snapMinutes, startOfMonth, WEEK_START_CHANGED_EVENT, type WeekStartDay, weekStartDayOf, getWeekStartSetting, buildMonthCells, buildWeekCells } from "@plainva/ui";
import type { PimEventRow } from "@plainva/core";
import { isoOf } from "../lib/dates";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import {
  subscribePimStatus,
  getPimStatus,
  listPimEvents,
  listPimCalendars,
  listPimAccounts,
  pimSyncNow,
  getPimCache,
} from "../services/pim/pimService";
import { useEventEditor } from "../components/useEventEditor";
import { getActiveVaultEntry } from "../services/vaultRegistry";
import { accountRowState, deviceSignInStates, isOAuthProvider, type DeviceSignInState } from "../services/deviceSignIn";
import { DeviceSignInCard } from "../components/DeviceSignInRow";
import { AppBar } from "../components/AppBar";

/**
 * Mobile PIM calendar (calendar-mobile branch): the phone twin of the desktop
 * time-grid, with Day / 3-day / Agenda views over the same shared @plainva/ui
 * time-grid math. Tapping an event opens an action sheet (RSVP when invited).
 * No accounts -> an empty state pointing at Settings. Daily notes have their
 * own Today screen, so this is the direct Calendar-tab destination.
 */

type PimView = "day" | "3day" | "week" | "month" | "agenda";
const PX_PER_HOUR = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

export function PimCalendarScreen({
  onSearch,
  bump,
  onBack,
  onOpenSettings,
  onOpenNote,
}: {
  /** Absent when this surface is pushed — the root offers the search. */
  onSearch?: () => void;
  bump: number;
  onBack?: () => void;
  onOpenSettings?: () => void;
  /** Opens a vault note — used by "Besprechungsnotiz" (S27). */
  onOpenNote?: (path: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const status = useSyncExternalStore(subscribePimStatus, getPimStatus);
  const [view, setView] = useState<PimView>("day");
  const [anchor, setAnchor] = useState(() => new Date());
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
  const [needsSignIn, setNeedsSignIn] = useState<{ label: string; provider: string; state: DeviceSignInState; reason?: string } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef, async () => { pimSyncNow(); });

  // The week and the month follow the SHARED first-day-of-week setting (S26):
  // a vault whose week starts on Sunday must start on Sunday everywhere.
  const [weekStart, setWeekStart] = useState<WeekStartDay>(1);
  useEffect(() => {
    const load = () => void getWeekStartSetting().then((v) => setWeekStart(weekStartDayOf(v)));
    load();
    window.addEventListener(WEEK_START_CHANGED_EVENT, load);
    return () => window.removeEventListener(WEEK_START_CHANGED_EVENT, load);
  }, []);

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
      const states = await deviceSignInStates("pim", vault.id, a.map((r) => r.id));
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
      setNeedsSignIn(working ? null : { label: broken.label, provider: broken.provider, state: broken.state, reason: broken.reason });
    });
  }, [rangeStart, rangeEnd]);

  useEffect(() => { reload(); }, [reload, bump]);
  useEffect(() => {
    const onChanged = () => reload();
    window.addEventListener("m-pim-changed", onChanged);
    return () => window.removeEventListener("m-pim-changed", onChanged);
  }, [reload]);

  const byDay = useMemo(() => {
    const map = new Map<string, PimEventRow[]>();
    for (const e of events) {
      const civil = e.allDay && e.start.date ? e.start.date : isoOf(new Date(e.start.ts));
      const list = map.get(civil);
      if (list) list.push(e);
      else map.set(civil, [e]);
    }
    return map;
  }, [events]);

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
  const editor = useEventEditor({ bump, onOpenNote });

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
        onSearch={onSearch}
        title={t("mobile.tabCalendar", { defaultValue: "Kalender" })}
      />
      <div className="m-pimbar">
        <IconButton label={t("pim.prevPeriod", { defaultValue: "Zurück" })} onClick={() => navPeriod(-1)}>
          <ChevronLeft size={ICON.head} />
        </IconButton>
        <span className="m-pimbar-title">{periodTitle()}</span>
        <IconButton label={t("pim.nextPeriod", { defaultValue: "Weiter" })} onClick={() => navPeriod(1)}>
          <ChevronRight size={ICON.head} />
        </IconButton>
        <IconButton
          label={t("pim.today", { defaultValue: "Heute" })}
          className="m-pimbar-today"
          onClick={() => setAnchor(new Date())}
        >
          {t("pim.today", { defaultValue: "Heute" })}
        </IconButton>
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
          { value: "month", label: t("pim.viewMonth") },
          { value: "agenda", label: t("pim.viewAgenda", { defaultValue: "Agenda" }) },
        ]}
        value={view}
        onChange={(v) => setView(v as PimView)}
      />

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
            onSignIn={() => onOpenSettings?.()}
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
            {days.map((d) => {
              const key = isoOf(d);
              const list = byDay.get(key) ?? [];
              const outside = d.getMonth() !== anchor.getMonth();
              return (
                <button
                  className={`m-cal-day${outside ? " is-outside" : ""}${key === todayIso ? " is-today" : ""}`}
                  key={key}
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
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : view === "agenda" ? (
        <div ref={ptrRef} className="m-scroll">
          {ptrIndicator}
          {days.filter((d) => (byDay.get(isoOf(d)) ?? []).length > 0).map((d) => {
            const key = isoOf(d);
            const list = [...(byDay.get(key) ?? [])].sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start.ts - b.start.ts);
            return (
              <div key={key}>
                <div style={{ position: "sticky", top: 0, background: "var(--bg-secondary)", padding: "4px 12px", fontSize: "var(--text-xs)", fontWeight: 600, color: key === todayIso ? "var(--accent-color)" : "var(--text-muted)" }}>
                  {new Intl.DateTimeFormat(i18n.language, { weekday: "short", day: "numeric", month: "long" }).format(d)}
                </div>
                {list.map((e) => (
                  <button key={`${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`} type="button" className="m-row" data-state={eventVisualState(e)} onClick={() => void editor.openEvent(e)} style={{ width: "100%", textAlign: "left", ["--evt-color" as string]: colorOf(e) }}>
                    <span className={`m-evt-mark ${eventVisualState(e) === "confirmed" ? "" : `m-evt-mark--${eventVisualState(e)}`}`} style={{ width: 6, height: 6, borderRadius: "var(--radius-pill)", flexShrink: 0 }} />
                    <span className={`m-evt-title ${eventVisualState(e) === "cancelled" ? "m-evt--cancelled" : ""}`} style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</span>
                    {stateLabel(e) ? <span className="m-evt-state">{stateLabel(e)}</span> : null}
                    <span style={{ color: "var(--text-muted)", fontSize: "var(--text-xs)", flexShrink: 0 }}>
                      {e.allDay ? t("pim.allDay", { defaultValue: "Ganztägig" }) : new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(e.start.ts))}
                    </span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : (
        <div ref={scrollRef} className="m-scroll" style={{ position: "relative" }} data-testid="pim-timegrid">
          <div style={{ display: "flex", position: "relative", height: 24 * PX_PER_HOUR }}>
            <div style={{ width: 44, flexShrink: 0, position: "relative" }}>
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
                  {laid.map((l) => {
                    const startMin = minutesInDay(l.event.startMs, dayStartMs);
                    const endMin = Math.max(startMin + 1, minutesInDay(l.event.endMs, dayStartMs));
                    const top = minutesToPx(startMin, PX_PER_HOUR);
                    const height = Math.max(15, minutesToPx(endMin - startMin, PX_PER_HOUR));
                    const widthPct = 100 / l.lanes;
                    const e = l.event.ev;
                    return (
                      <button
                        key={`${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`}
                        type="button"
                        data-testid="pim-event"
                        data-state={eventVisualState(e)}
                        className={eventStateClass("m-evt", eventVisualState(e))}
                        onClick={() => void editor.openEvent(e)}
                        style={{ position: "absolute", top, height, left: `calc(${l.lane * widthPct}% + 1px)`, width: `calc(${widthPct}% - 2px)`, ["--evt-color" as string]: colorOf(e), border: "none", borderRadius: "var(--radius-xs)", padding: "1px 4px", textAlign: "left", overflow: "hidden", fontSize: "var(--text-xs)", fontWeight: 600, lineHeight: 1.15 }}
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
