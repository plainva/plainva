import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, RefreshCw, CalendarPlus, CalendarCog } from "lucide-react";
import {
  layoutDayEvents,
  minutesInDay,
  minutesToPx,
  minutesToHHMM,
  buildContiguousDays,
  toast,
  EmptyState,
} from "@plainva/ui";
import type { PimEventRow } from "@plainva/core";
import { isoOf } from "../lib/dates";
import { usePullToRefresh } from "../lib/usePullToRefresh";
import { mSelect } from "../services/mobileDialogs";
import {
  subscribePimStatus,
  getPimStatus,
  listPimEvents,
  listPimAccounts,
  pimSyncNow,
  respondToPimEvent,
} from "../services/pim/pimService";

/**
 * Mobile PIM calendar (calendar-mobile branch): the phone twin of the desktop
 * time-grid, with Day / 3-day / Agenda views over the same shared @plainva/ui
 * time-grid math. Tapping an event opens an action sheet (RSVP when invited).
 * No accounts -> an empty state pointing at Settings; the daily-note month
 * calendar stays a separate screen.
 */

type PimView = "day" | "3day" | "agenda";
const PX_PER_HOUR = 40;
const DAY_MS = 24 * 60 * 60 * 1000;

export function PimCalendarScreen({
  bump,
  onBack,
  onOpenSettings,
}: {
  bump: number;
  onBack?: () => void;
  onOpenSettings?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const status = useSyncExternalStore(subscribePimStatus, getPimStatus);
  const [view, setView] = useState<PimView>("day");
  const [anchor, setAnchor] = useState(() => new Date());
  const [events, setEvents] = useState<PimEventRow[]>([]);
  const [hasAccounts, setHasAccounts] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const ptrRef = useRef<HTMLDivElement>(null);
  const ptrIndicator = usePullToRefresh(ptrRef, async () => { pimSyncNow(); });

  const days = useMemo(() => {
    if (view === "day") return [anchor];
    if (view === "3day") return buildContiguousDays(anchor, 3);
    return buildContiguousDays(anchor, 60); // agenda window
  }, [view, anchor]);

  const rangeStart = useMemo(() => new Date(days[0].getFullYear(), days[0].getMonth(), days[0].getDate()).getTime(), [days]);
  const rangeEnd = useMemo(() => {
    const last = days[days.length - 1];
    return new Date(last.getFullYear(), last.getMonth(), last.getDate()).getTime() + DAY_MS;
  }, [days]);

  const reload = useCallback(() => {
    void listPimEvents(rangeStart, rangeEnd).then(setEvents).catch(() => setEvents([]));
    void listPimAccounts().then((a) => setHasAccounts(a.length > 0));
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
    const step = view === "3day" ? 3 : view === "agenda" ? 30 : 1;
    setAnchor((d) => new Date(d.getTime() + dir * step * DAY_MS));
  };

  const colorOf = (e: PimEventRow) => e.color || "var(--accent-color)";
  const todayIso = isoOf(new Date());

  const openEvent = async (e: PimEventRow) => {
    const time = e.allDay
      ? t("pim.allDay", { defaultValue: "Ganztägig" })
      : `${new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(e.start.ts))}–${new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(e.end.ts))}`;
    const options: Array<{ value: string; label: string }> = [];
    if (e.selfResponse) {
      options.push({ value: "accepted", label: t("pim.rsvpAccept", { defaultValue: "Zusagen" }) });
      options.push({ value: "tentative", label: t("pim.rsvpTentative", { defaultValue: "Vorläufig" }) });
      options.push({ value: "declined", label: t("pim.rsvpDecline", { defaultValue: "Absagen" }) });
    }
    const pick = await mSelect({
      title: e.title,
      message: `${time}${e.location ? ` · ${e.location}` : ""}`,
      options,
    });
    if (pick === "accepted" || pick === "declined" || pick === "tentative") {
      try {
        await respondToPimEvent(e, pick);
        toast.success(t("pim.rsvpSent", { defaultValue: "Antwort gesendet" }));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const periodTitle = () => {
    if (view === "day") return new Intl.DateTimeFormat(i18n.language, { weekday: "long", day: "numeric", month: "long" }).format(anchor);
    if (view === "agenda") return t("pim.viewAgenda", { defaultValue: "Agenda" });
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
    <div className="m-screen m-page--basegraph" style={{ display: "flex", flexDirection: "column" }}>
      <header className="m-header">
        {onBack && (
          <button type="button" className="m-iconbtn" onClick={onBack} aria-label={t("common.back", { defaultValue: "Zurück" })}>
            <ChevronLeft size={20} />
          </button>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
          <button type="button" className="m-iconbtn" onClick={() => navPeriod(-1)} aria-label={t("pim.prevPeriod", { defaultValue: "Zurück" })}>
            <ChevronLeft size={18} />
          </button>
          <span style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 0, textAlign: "center" }}>{periodTitle()}</span>
          <button type="button" className="m-iconbtn" onClick={() => navPeriod(1)} aria-label={t("pim.nextPeriod", { defaultValue: "Weiter" })}>
            <ChevronRight size={18} />
          </button>
        </div>
        <button type="button" className="m-iconbtn" onClick={() => setAnchor(new Date())} aria-label={t("pim.today", { defaultValue: "Heute" })} style={{ fontSize: "var(--text-xs)", fontWeight: 600, width: "auto", padding: "0 8px" }}>
          {t("pim.today", { defaultValue: "Heute" })}
        </button>
        <button type="button" className="m-iconbtn" onClick={() => pimSyncNow()} aria-label={t("sync.syncNow", { defaultValue: "Jetzt synchronisieren" })}>
          <RefreshCw size={18} className={status.status === "syncing" ? "m-spin" : undefined} />
        </button>
        {onOpenSettings && (
          <button type="button" className="m-iconbtn" onClick={onOpenSettings} aria-label={t("pim.accounts", { defaultValue: "Kalenderkonten" })}>
            <CalendarCog size={18} />
          </button>
        )}
      </header>

      {/* View segment */}
      <div className="m-viewpills" role="tablist" style={{ padding: "6px 10px" }}>
        {(["day", "3day", "agenda"] as PimView[]).map((v) => (
          <button
            key={v}
            type="button"
            role="tab"
            aria-selected={view === v}
            className={`m-viewpill${view === v ? " is-active" : ""}`}
            onClick={() => setView(v)}
          >
            {v === "day" ? t("pim.viewDay", { defaultValue: "Tag" }) : v === "3day" ? t("pim.view3Day", { defaultValue: "3 Tage" }) : t("pim.viewAgenda", { defaultValue: "Agenda" })}
          </button>
        ))}
      </div>

      {hasAccounts === false ? (
        <EmptyState
          icon={<CalendarPlus size={28} />}
          action={
            onOpenSettings ? (
              <button type="button" className="m-btn m-btn--filled" onClick={onOpenSettings}>
                {t("pim.connectAccount", { defaultValue: "Konto verbinden" })}
              </button>
            ) : undefined
          }
        >
          {t("pim.noAccountsMobile", { defaultValue: "Noch kein Kalenderkonto verbunden." })}
        </EmptyState>
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
                  <button key={`${e.accountId}-${e.calendarId}-${e.uid}-${e.start.ts}`} type="button" className="m-row" onClick={() => void openEvent(e)} style={{ width: "100%", textAlign: "left" }}>
                    <span style={{ width: 6, height: 6, borderRadius: "var(--radius-pill)", background: colorOf(e), flexShrink: 0 }} />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.title}</span>
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
                <div key={key} style={{ flex: 1, minWidth: 0, position: "relative", borderLeft: "1px solid var(--border-color-light)" }}>
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
                        onClick={() => void openEvent(e)}
                        style={{ position: "absolute", top, height, left: `calc(${l.lane * widthPct}% + 1px)`, width: `calc(${widthPct}% - 2px)`, background: colorOf(e), color: "var(--accent-on)", border: "none", borderRadius: "var(--radius-xs)", padding: "1px 4px", textAlign: "left", overflow: "hidden", fontSize: "var(--text-xs)", fontWeight: 600, lineHeight: 1.15 }}
                      >
                        {e.title}
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
    </div>
  );
}
