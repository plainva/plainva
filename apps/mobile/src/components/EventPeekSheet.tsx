import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, FilePlus2, MapPin, Pencil, Repeat, Trash2, Users } from "lucide-react";
import {
  ICON,
  acceptedCount,
  describeRecurrence,
  formatEventWhen,
  isSeries,
  nextOccurrenceOf,
  peekAttendees,
  seriesRecurrenceOf,
} from "@plainva/ui";
import { parseRRule, type PimAttendeeStatus, type PimEventRow, type PimRecurrence } from "@plainva/core";
import { SheetGrip } from "./SheetGrip";

/**
 * The event PREVIEW on the phone (S4) — the same surface as the desktop's
 * floating window, in the shape a phone has for it: a bottom sheet with a grip.
 *
 * Before this, a tap on an event opened a bare list of verbs ("Bearbeiten",
 * "Löschen", "Meeting-Notiz") and the only thing it said ABOUT the event was
 * its title and time in the dialog's subtitle. Everything the desktop preview
 * shows — where it is, who is coming and what they answered, whether it repeats
 * — was invisible until you entered the edit form.
 *
 * What the preview says and how it says it comes from the shared helpers, so
 * "wöchentlich, MO" and "Do, 14. August · 10:00–11:30" cannot read one way on
 * the desktop and another here.
 */

const STATUS_KEY: Record<PimAttendeeStatus, { key: string; fallback: string }> = {
  accepted: { key: "pim.rsvpAccepted", fallback: "Zugesagt" },
  declined: { key: "pim.rsvpDeclined", fallback: "Abgesagt" },
  tentative: { key: "pim.rsvpTentative", fallback: "Vorläufig" },
  needsAction: { key: "pim.rsvpPending", fallback: "Ausstehend" },
};

export function EventPeekSheet({
  event,
  rows,
  calendarName,
  color,
  resolveSeriesMaster,
  onClose,
  onEdit,
  onDelete,
  onMeetingNote,
  onRespond,
}: {
  event: PimEventRow;
  /** The loaded rows — the next occurrence is read from them. */
  rows: readonly PimEventRow[];
  calendarName?: string;
  color?: string;
  /** Fetches the series master; the grid query excludes it, so the repetition
   *  rule is not among `rows` for an expanded occurrence (S2). */
  resolveSeriesMaster?: (e: PimEventRow) => Promise<PimEventRow | null>;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMeetingNote: () => void;
  /** Only when the user is an invitee. */
  onRespond?: (response: "accepted" | "declined" | "tentative") => void;
}) {
  const { t, i18n } = useTranslation();
  const attendees = useMemo(() => peekAttendees(event), [event]);
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
  const rule = localRule ?? fetchedRule;
  const next = useMemo(() => nextOccurrenceOf(rows, event), [rows, event]);

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()} data-testid="event-peek-sheet">
        <SheetGrip onClose={onClose} />

        <div className="m-evtpeek-head">
          <span className="m-evtpeek-bead" aria-hidden style={color ? { background: color } : undefined} />
          <span className="m-evtpeek-headtext">
            <span className="m-evtpeek-title" data-testid="event-peek-title">
              {event.title || t("pim.untitledEvent", { defaultValue: "(ohne Titel)" })}
            </span>
            <span className="m-evtpeek-when" data-testid="event-peek-when">
              {formatEventWhen(event, i18n.language)}
            </span>
            {calendarName ? <span className="m-evtpeek-cal">{calendarName}</span> : null}
          </span>
        </div>

        {isSeries(event) ? (
          <p className="m-evtpeek-chips" data-testid="event-peek-series">
            <span className="m-evtpeek-chip m-evtpeek-chip--on">
              <Repeat size={ICON.meta} />
              {t("pim.seriesTitle", { defaultValue: "Serientermin" })}
            </span>
            {rule ? <span className="m-evtpeek-meta">{describeRecurrence(rule, t, i18n.language)}</span> : null}
            {next ? (
              <span className="m-evtpeek-meta" data-testid="event-peek-next">
                {t("pim.seriesNext", {
                  defaultValue: "Nächster: {{date}}",
                  date: new Date(next.start.ts).toLocaleDateString(i18n.language, { day: "numeric", month: "long" }),
                })}
              </span>
            ) : null}
          </p>
        ) : null}

        {event.location ? (
          <p className="m-evtpeek-line">
            <MapPin size={ICON.meta} />
            <span>{event.location}</span>
          </p>
        ) : null}

        {attendees.length > 0 ? (
          <>
            <p className="m-evtpeek-line">
              <Users size={ICON.meta} />
              <span>
                {t("pim.attendeeSummary", {
                  defaultValue: "{{count}} Teilnehmende · {{accepted}} zugesagt",
                  count: attendees.length,
                  accepted: acceptedCount(attendees),
                })}
              </span>
            </p>
            <ul className="m-evtpeek-people" data-testid="event-peek-attendees">
              {attendees.map((a, i) => (
                <li key={`${a.email ?? a.name}-${i}`}>
                  <span>{a.name || a.email}</span>
                  {a.organizer ? <span className="m-evtpeek-meta">· {t("pim.organizer", { defaultValue: "Organisator" })}</span> : null}
                  <span className="m-evtpeek-meta">· {t(STATUS_KEY[a.status].key, { defaultValue: STATUS_KEY[a.status].fallback })}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {event.description ? <p className="m-evtpeek-desc">{event.description}</p> : null}

        {onRespond ? (
          <p className="m-evtpeek-chips" data-testid="event-peek-rsvp">
            <button className="m-evtpeek-chip m-evtpeek-chip--on" onClick={() => onRespond("accepted")}>
              <Check size={ICON.meta} />
              {t("pim.rsvpAccept", { defaultValue: "Zusagen" })}
            </button>
            <button className="m-evtpeek-chip" onClick={() => onRespond("tentative")}>
              {t("pim.rsvpTentative", { defaultValue: "Vorläufig" })}
            </button>
            <button className="m-evtpeek-chip" onClick={() => onRespond("declined")}>
              {t("pim.rsvpDecline", { defaultValue: "Absagen" })}
            </button>
          </p>
        ) : null}

        <button className="m-row" onClick={onEdit} data-testid="event-peek-edit">
          <Pencil size={ICON.head} />
          <span>{t("pim.editEvent", { defaultValue: "Termin bearbeiten" })}</span>
        </button>
        <button className="m-row" onClick={onMeetingNote} data-testid="event-peek-note">
          <FilePlus2 size={ICON.head} />
          <span>{t("pim.meetingNote", { defaultValue: "Meeting-Notiz" })}</span>
        </button>
        <button className="m-row m-danger" onClick={onDelete} data-testid="event-peek-delete">
          <Trash2 size={ICON.head} />
          <span>{t("pim.deleteEvent", { defaultValue: "Termin löschen" })}</span>
        </button>
      </div>
    </div>
  );
}
