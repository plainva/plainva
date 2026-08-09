import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, FilePlus2, MapPin, MoreVertical, Pencil, Repeat, Users, X } from "lucide-react";
import {
  Button,
  FloatingWindow,
  ICON,
  IconButton,
  acceptedCount,
  isSeries,
  markdownToHtml,
  nextOccurrenceOf,
  peekAttendees,
  seriesRecurrenceOf,
} from "@plainva/ui";
import { parseRRule, type PimAttendeeStatus, type PimEventRow, type PimRecurrence } from "@plainva/core";
import { EventContextMenu, type EventContextMenuProps } from "./EventContextMenu";

/**
 * The event PREVIEW (S2): what a click on an event opens.
 *
 * Until now a click opened the edit form, and on a series it opened the "this
 * one or all?" question BEFORE anything had been changed — an answer to a
 * question nobody asked. Looking at an event is not editing it: reading,
 * declining, writing a meeting note and blocking the slot all happen here, and
 * the edit form is one deliberate click away.
 *
 * The frame is the shared FloatingWindow — the same window as the note peek and
 * the compose window: draggable, resizable, non-modal, and it does NOT dim the
 * app, so the calendar stays readable beside it.
 *
 * On a series this shows a line that NAMES the repetition instead of asking
 * about it. The question moves to the moment a change is saved (S3).
 */

export interface EventPeekProps {
  event: PimEventRow;
  /** The loaded rows — the next occurrence and the rule are read from them. */
  rows: readonly PimEventRow[];
  calendarName: string;
  /** Calendar/event colour for the title bead; undefined falls back to the accent. */
  color?: string;
  onClose: () => void;
  onEdit: () => void;
  onMeetingNote: () => void;
  onEmailInvite: () => void;
  onDelete: () => void;
  /**
   * Looks the series master up in the cache. The grid query excludes masters
   * (`recurrence IS NULL`), so the repetition rule is NOT among `rows` for an
   * expanded instance — it has to be fetched, exactly as the edit path does.
   */
  resolveSeriesMaster?: (e: PimEventRow) => Promise<PimEventRow | null>;
  onSetColor?: EventContextMenuProps["onSetColor"];
  onRespond?: EventContextMenuProps["onRespond"];
  onBlock?: EventContextMenuProps["onBlock"];
}

const STATUS_KEY: Record<PimAttendeeStatus, { key: string; fallback: string }> = {
  accepted: { key: "pim.rsvpAccepted", fallback: "Zugesagt" },
  declined: { key: "pim.rsvpDeclined", fallback: "Abgesagt" },
  tentative: { key: "pim.rsvpTentative", fallback: "Vorläufig" },
  needsAction: { key: "pim.rsvpPending", fallback: "Ausstehend" },
};

export function EventPeek({
  event,
  rows,
  calendarName,
  color,
  onClose,
  onEdit,
  onMeetingNote,
  onEmailInvite,
  onDelete,
  resolveSeriesMaster,
  onSetColor,
  onRespond,
  onBlock,
}: EventPeekProps) {
  const { t, i18n } = useTranslation();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);

  const attendees = useMemo(() => peekAttendees(event), [event]);
  // The rule as far as the loaded rows know it — non-null only when this row IS
  // the master. For an instance the master is fetched below.
  const localRule = useMemo(() => seriesRecurrenceOf(rows, event), [rows, event]);
  const [fetchedRule, setFetchedRule] = useState<PimRecurrence | null>(null);
  useEffect(() => {
    setFetchedRule(null);
    if (localRule || !event.seriesMaster || !resolveSeriesMaster) return;
    let cancelled = false;
    void resolveSeriesMaster(event)
      .then((m) => {
        if (!cancelled && m?.recurrence) setFetchedRule(parseRRule(m.recurrence));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [event, localRule, resolveSeriesMaster]);
  const recurrence = localRule ?? fetchedRule;
  const next = useMemo(() => nextOccurrenceOf(rows, event), [rows, event]);

  const dateLabel = useMemo(() => formatWhen(event, i18n.language), [event, i18n.language]);
  const body = useMemo(() => (event.description ? markdownToHtml(event.description) : ""), [event.description]);

  const repeatLabel = recurrence ? describeRecurrence(recurrence, t) : null;
  const nextLabel = next
    ? new Date(next.start.ts).toLocaleDateString(i18n.language, { day: "numeric", month: "long" })
    : null;

  return (
    <FloatingWindow
      persistKey="event-peek"
      defaultWidth={520}
      defaultHeight={460}
      minWidth={380}
      minHeight={280}
      ariaLabel={t("pim.eventPreview", { defaultValue: "Termin-Vorschau" })}
      testId="event-peek"
      onEscape={onClose}
      head={
        <>
          <span style={{ flex: 1, fontSize: "var(--text-ui)", color: "var(--text-muted)" }}>
            {t("pim.eventPreview", { defaultValue: "Termin-Vorschau" })}
          </span>
          <IconButton label={t("common.close", { defaultValue: "Schließen" })} onClick={onClose} data-testid="event-peek-close">
            <X size={ICON.ui} />
          </IconButton>
        </>
      }
    >
      <div style={{ padding: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-3)", overflow: "auto", height: "100%" }}>
        <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "flex-start" }}>
          <span
            aria-hidden
            style={{
              width: 4,
              alignSelf: "stretch",
              minHeight: 40,
              borderRadius: "var(--radius-pill)",
              background: color || "var(--accent-color)",
              flexShrink: 0,
            }}
          />
          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: "var(--text-lg)", overflowWrap: "anywhere" }} data-testid="event-peek-title">
              {event.title || t("pim.untitledEvent", { defaultValue: "(ohne Titel)" })}
            </h2>
            <p style={{ margin: "2px 0 0", fontSize: "var(--text-ui)", color: "var(--text-muted)" }} data-testid="event-peek-when">
              {dateLabel}
            </p>
            {calendarName ? (
              <p style={{ margin: "2px 0 0", fontSize: "var(--text-xs)", color: "var(--text-faint)" }}>{calendarName}</p>
            ) : null}
          </div>
        </div>

        {isSeries(event) ? (
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap", alignItems: "center" }} data-testid="event-peek-series">
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontSize: "var(--text-xs)",
                padding: "2px 8px",
                borderRadius: "var(--radius-pill)",
                background: "var(--accent-container)",
                color: "var(--on-accent-container)",
              }}
            >
              <Repeat size={ICON.meta} />
              {t("pim.seriesTitle", { defaultValue: "Serientermin" })}
            </span>
            {repeatLabel ? <span style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)" }}>{repeatLabel}</span> : null}
            {nextLabel ? (
              <span style={{ fontSize: "var(--text-xs)", color: "var(--text-faint)" }} data-testid="event-peek-next">
                {t("pim.seriesNext", { defaultValue: "Nächster: {{date}}", date: nextLabel })}
              </span>
            ) : null}
          </div>
        ) : null}

        {event.location ? (
          <p style={{ margin: 0, display: "flex", gap: 6, alignItems: "flex-start", fontSize: "var(--text-ui)" }}>
            <MapPin size={ICON.meta} style={{ flexShrink: 0, marginTop: 3 }} />
            <span style={{ overflowWrap: "anywhere" }}>{event.location}</span>
          </p>
        ) : null}

        {attendees.length > 0 ? (
          <div>
            <p style={{ margin: "0 0 4px", display: "flex", gap: 6, alignItems: "center", fontSize: "var(--text-ui)", color: "var(--text-muted)" }}>
              <Users size={ICON.meta} />
              {t("pim.attendeeSummary", {
                defaultValue: "{{count}} Teilnehmende · {{accepted}} zugesagt",
                count: attendees.length,
                accepted: acceptedCount(attendees),
              })}
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 2 }} data-testid="event-peek-attendees">
              {attendees.map((a, i) => (
                <li key={`${a.email ?? a.name}-${i}`} style={{ fontSize: "var(--text-xs)", display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ color: "var(--text-main)" }}>{a.name || a.email}</span>
                  {a.organizer ? <span style={{ color: "var(--text-faint)" }}>· {t("pim.organizer", { defaultValue: "Organisator" })}</span> : null}
                  <span style={{ color: "var(--text-faint)" }}>
                    · {t(STATUS_KEY[a.status].key, { defaultValue: STATUS_KEY[a.status].fallback })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {body ? (
          <div
            className="markdown-reader"
            style={{ fontSize: "var(--text-ui)", overflowWrap: "anywhere" }}
            data-testid="event-peek-body"
            dangerouslySetInnerHTML={{ __html: body }}
          />
        ) : null}

        {onRespond ? (
          <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }} data-testid="event-peek-rsvp">
            <Button size="sm" variant="tonal" icon={<Check size={ICON.ui} />} onClick={() => onRespond("accepted")}>
              {t("pim.rsvpAccept", { defaultValue: "Zusagen" })}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onRespond("tentative")}>
              {t("pim.rsvpTentative", { defaultValue: "Vorläufig" })}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onRespond("declined")}>
              {t("pim.rsvpDecline", { defaultValue: "Absagen" })}
            </Button>
          </div>
        ) : null}

        <div style={{ marginTop: "auto", display: "flex", gap: "var(--space-2)", alignItems: "center", paddingTop: "var(--space-2)" }}>
          <Button size="sm" variant="primary" icon={<Pencil size={ICON.ui} />} onClick={onEdit} data-testid="event-peek-edit">
            {t("pim.editEvent", { defaultValue: "Termin bearbeiten" })}
          </Button>
          <Button size="sm" variant="ghost" icon={<FilePlus2 size={ICON.ui} />} onClick={onMeetingNote} data-testid="event-peek-note">
            {t("pim.meetingNote", { defaultValue: "Meeting-Notiz" })}
          </Button>
          <span style={{ flex: 1 }} />
          <IconButton
            label={t("common.moreActions", { defaultValue: "Weitere Aktionen" })}
            data-testid="event-peek-more"
            onClick={(ev) => {
              const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
              setMenuAt({ x: r.left, y: r.bottom });
            }}
          >
            <MoreVertical size={ICON.ui} />
          </IconButton>
        </div>
      </div>

      {menuAt ? (
        <EventContextMenu
          event={event}
          at={menuAt}
          onClose={() => setMenuAt(null)}
          onEdit={onEdit}
          onMeetingNote={onMeetingNote}
          onEmailInvite={onEmailInvite}
          onDelete={onDelete}
          onSetColor={onSetColor}
          onRespond={onRespond}
          onBlock={onBlock}
        />
      ) : null}
    </FloatingWindow>
  );
}

/** "Do, 14. August · 10:00–11:30" — or the day alone for an all-day event. */
function formatWhen(e: PimEventRow, locale: string): string {
  // An all-day event carries the civil date; using its `ts` would shift the day
  // across timezones — the very thing `date` exists to prevent.
  const start = new Date(e.allDay && e.start.date ? `${e.start.date}T12:00:00` : e.start.ts);
  const day = start.toLocaleDateString(locale, { weekday: "short", day: "numeric", month: "long" });
  if (e.allDay) return day;
  const hm = (d: Date) => d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${hm(new Date(e.start.ts))}–${hm(new Date(e.end.ts))}`;
}

/** "Wöchentlich, montags" — the rule in one line, built from existing keys. */
function describeRecurrence(r: PimRecurrence, t: (k: string, o?: Record<string, unknown>) => string): string {
  const freq = {
    daily: t("pim.repeatDaily", { defaultValue: "Täglich" }),
    weekly: t("pim.repeatWeekly", { defaultValue: "Wöchentlich" }),
    monthly: t("pim.repeatMonthly", { defaultValue: "Monatlich" }),
    yearly: t("pim.repeatYearly", { defaultValue: "Jährlich" }),
  }[r.freq];
  const every =
    (r.interval ?? 1) > 1
      ? `${t("pim.repeatEvery", { defaultValue: "Alle" })} ${r.interval} ${
          { daily: t("pim.freqDay", { defaultValue: "Tag(e)" }), weekly: t("pim.freqWeek", { defaultValue: "Woche(n)" }), monthly: t("pim.freqMonth", { defaultValue: "Monat(e)" }), yearly: t("pim.freqYear", { defaultValue: "Jahr(e)" }) }[r.freq]
        }`
      : freq;
  const days = r.freq === "weekly" && r.byWeekday?.length ? r.byWeekday.join(", ") : "";
  return days ? `${every} · ${days}` : every;
}
