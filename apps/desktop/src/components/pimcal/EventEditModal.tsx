import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FilePlus2, Trash2, X } from "lucide-react";
import { Modal, Button, TextInput, Checkbox, EVENT_COLOR_PALETTE } from "@plainva/ui";
import type { PimAttendee, PimAttendeeStatus } from "@plainva/core";
import { Select } from "../Select";
import { parseEmails, type EventFormValues } from "../../services/pim/calendarModel";

const STATUS_COLOR: Record<PimAttendeeStatus, string> = {
  accepted: "var(--success-text)",
  declined: "var(--error-text)",
  tentative: "var(--warning-text)",
  needsAction: "var(--text-faint)",
};

/**
 * Create/edit dialog for SINGLE calendar events (PIM stage 3). Recurring
 * events are read-only until stage 4 — the calendar view hides the entry
 * points for series instances. The dialog only collects values; the WRITE
 * (provider call + refresh) is the caller's job, so a failure surfaces here
 * as an inline error and the dialog stays open.
 */

interface EventEditModalProps {
  mode: "create" | "edit";
  initial: EventFormValues;
  /** Writable calendars for the create picker (empty in edit mode). */
  calendarOptions: Array<{ value: string; label: string }>;
  onCancel: () => void;
  onSubmit: (values: EventFormValues) => Promise<void>;
  /** Edit mode only: turn the event into a meeting note / delete it. */
  onMeetingNote?: () => void;
  onDelete?: () => void;
  /** Edit mode: attendees with their RSVP status (the back-channel). */
  rsvps?: PimAttendee[];
  /** Edit mode: the user's own RSVP status when invited (shows accept/decline). */
  selfResponse?: PimAttendeeStatus;
  /** Sends the user's RSVP to the provider. */
  onRespond?: (response: "accepted" | "declined" | "tentative") => Promise<void>;
}

export function EventEditModal({ mode, initial, calendarOptions, onCancel, onSubmit, onMeetingNote, onDelete, rsvps, selfResponse, onRespond }: EventEditModalProps) {
  const { t, i18n } = useTranslation();
  const [values, setValues] = useState<EventFormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [ownStatus, setOwnStatus] = useState<PimAttendeeStatus | undefined>(selfResponse);
  // The attendee field is stored as a newline-joined string (draft parsing is
  // unchanged), but presented as Google-Calendar-style chips: type an address,
  // Enter/comma/blur turns it into a chip. `attendeeDraft` is the text-in-flight.
  const [attendeeDraft, setAttendeeDraft] = useState("");

  const statusLabel = (s: PimAttendeeStatus): string =>
    s === "accepted"
      ? t("pim.rsvpAccepted", { defaultValue: "Zugesagt" })
      : s === "declined"
        ? t("pim.rsvpDeclined", { defaultValue: "Abgesagt" })
        : s === "tentative"
          ? t("pim.rsvpTentativeState", { defaultValue: "Vorläufig" })
          : t("pim.rsvpPending", { defaultValue: "Ausstehend" });

  const respond = async (response: "accepted" | "declined" | "tentative") => {
    if (!onRespond || responding) return;
    setResponding(true);
    setError(null);
    try {
      await onRespond(response);
      setOwnStatus(response);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setResponding(false);
    }
  };

  const set = <K extends keyof EventFormValues>(key: K, v: EventFormValues[K]) => setValues((prev) => ({ ...prev, [key]: v }));
  // Editing invitees / recurrence marks them "touched" so an unrelated edit
  // never REPLACES the remote value (attendee RSVP status, an unreadable Graph
  // rule) — the draft leaves untouched fields undefined.
  const setAttendees = (v: string) => setValues((prev) => ({ ...prev, attendees: v, attendeesTouched: true }));
  const attendeeList = parseEmails(values.attendees);
  const commitAttendees = (raw: string) => {
    if (!raw.trim()) return;
    setAttendees(parseEmails(`${values.attendees}\n${raw}`).join("\n"));
    setAttendeeDraft("");
  };
  const removeAttendee = (email: string) => setAttendees(attendeeList.filter((a) => a !== email).join("\n"));
  const setRepeat = <K extends keyof EventFormValues>(key: K, v: EventFormValues[K]) => setValues((prev) => ({ ...prev, [key]: v, repeatTouched: true }));
  const toggleWeekday = (code: string) =>
    setValues((prev) => ({
      ...prev,
      repeatByWeekday: prev.repeatByWeekday.includes(code) ? prev.repeatByWeekday.filter((d) => d !== code) : [...prev.repeatByWeekday, code],
      repeatTouched: true,
    }));

  const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
  // 2024-01-01 was a Monday → index 0 = Monday, matching WEEKDAY_CODES.
  const weekdayShort = (i: number) => new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(new Date(2024, 0, 1 + i));
  const freqUnit =
    values.repeatFreq === "daily"
      ? t("pim.freqDay", { defaultValue: "Tag(e)" })
      : values.repeatFreq === "weekly"
        ? t("pim.freqWeek", { defaultValue: "Woche(n)" })
        : values.repeatFreq === "monthly"
          ? t("pim.freqMonth", { defaultValue: "Monat(e)" })
          : t("pim.freqYear", { defaultValue: "Jahr(e)" });

  const submit = async () => {
    if (busy) return;
    if (!values.title.trim()) {
      setError(t("pim.eventTitleRequired", { defaultValue: "Bitte einen Titel angeben." }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Fold a typed-but-not-yet-committed attendee into the value so pressing
      // Save (without Enter first) still includes it.
      const pending = attendeeDraft.trim();
      const attendees = pending ? parseEmails(`${values.attendees}\n${pending}`).join("\n") : values.attendees;
      const attendeesTouched = values.attendeesTouched || pending.length > 0;
      await onSubmit({ ...values, title: values.title.trim(), attendees, attendeesTouched });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={mode === "create" ? t("pim.newEvent", { defaultValue: "Neuer Termin" }) : t("pim.editEvent", { defaultValue: "Termin bearbeiten" })}
      onClose={onCancel}
      size="md"
      footer={
        <>
          {mode === "edit" && onMeetingNote && (
            <Button variant="ghost" size="sm" data-testid="event-meeting-note" onClick={onMeetingNote} icon={<FilePlus2 size={14} />}>
              {t("pim.meetingNote", { defaultValue: "Meeting-Notiz" })}
            </Button>
          )}
          {mode === "edit" && onDelete && (
            <Button variant="ghost" size="sm" data-testid="event-delete" onClick={onDelete} icon={<Trash2 size={14} />}>
              {t("pim.deleteEvent", { defaultValue: "Termin löschen" })}
            </Button>
          )}
          <span style={{ flex: 1 }} />
          <Button variant="ghost" onClick={onCancel}>
            {t("common.cancel", { defaultValue: "Abbrechen" })}
          </Button>
          <Button variant="primary" data-testid="event-save" disabled={busy} onClick={() => void submit()}>
            {t("common.save", { defaultValue: "Speichern" })}
          </Button>
        </>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }} data-testid="event-edit-form">
        <label style={{ fontSize: "var(--text-sm)" }}>
          {t("pim.eventTitle", { defaultValue: "Titel" })}
          <TextInput
            value={values.title}
            onChange={(e) => set("title", e.target.value)}
            data-testid="event-title"
            autoFocus
            style={{ display: "block", width: "100%", marginTop: 2 }}
          />
        </label>
        {mode === "create" && calendarOptions.length > 0 && (
          <div>
            <label style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 2 }}>
              {t("pim.eventCalendar", { defaultValue: "Kalender" })}
            </label>
            <Select
              ariaLabel={t("pim.eventCalendar", { defaultValue: "Kalender" })}
              value={values.calendarKey}
              onChange={(v) => set("calendarKey", v)}
              options={calendarOptions}
            />
          </div>
        )}
        <Checkbox checked={values.allDay} onChange={(e) => set("allDay", e.target.checked)} data-testid="event-allday">
          {t("pim.allDay", { defaultValue: "Ganztägig" })}
        </Checkbox>
        <div style={{ display: "flex", gap: "var(--space-2)", flexWrap: "wrap" }}>
          <label style={{ fontSize: "var(--text-sm)" }}>
            {values.allDay ? t("pim.eventFrom", { defaultValue: "Von" }) : t("pim.eventDate", { defaultValue: "Datum" })}
            <input
              type="date"
              className="pv-field"
              value={values.dayKey}
              onChange={(e) => set("dayKey", e.target.value)}
              data-testid="event-day"
              style={{ display: "block", marginTop: 2 }}
            />
          </label>
          {values.allDay ? (
            <label style={{ fontSize: "var(--text-sm)" }}>
              {t("pim.eventTo", { defaultValue: "Bis" })}
              <input
                type="date"
                className="pv-field"
                value={values.endDayKey}
                onChange={(e) => set("endDayKey", e.target.value)}
                data-testid="event-end-day"
                style={{ display: "block", marginTop: 2 }}
              />
            </label>
          ) : (
            <>
              <label style={{ fontSize: "var(--text-sm)" }}>
                {t("pim.eventFrom", { defaultValue: "Von" })}
                <input
                  type="time"
                  className="pv-field"
                  value={values.startTime}
                  onChange={(e) => set("startTime", e.target.value)}
                  data-testid="event-start-time"
                  style={{ display: "block", marginTop: 2 }}
                />
              </label>
              <label style={{ fontSize: "var(--text-sm)" }}>
                {t("pim.eventTo", { defaultValue: "Bis" })}
                <input
                  type="time"
                  className="pv-field"
                  value={values.endTime}
                  onChange={(e) => set("endTime", e.target.value)}
                  data-testid="event-end-time"
                  style={{ display: "block", marginTop: 2 }}
                />
              </label>
            </>
          )}
        </div>
        {/* Recurrence (Outlook-style) — right after date/time, in create AND
            edit. A rule is only written when a control is actually touched. */}
        <div data-testid="event-repeat-section">
          <label style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 2 }}>
            {t("pim.repeat", { defaultValue: "Wiederholung" })}
          </label>
          <Select
            ariaLabel={t("pim.repeat", { defaultValue: "Wiederholung" })}
            value={values.repeatFreq}
            onChange={(v) => setRepeat("repeatFreq", v as EventFormValues["repeatFreq"])}
            options={[
              { value: "", label: t("pim.repeatNone", { defaultValue: "Nie" }) },
              { value: "daily", label: t("pim.repeatDaily", { defaultValue: "Täglich" }) },
              { value: "weekly", label: t("pim.repeatWeekly", { defaultValue: "Wöchentlich" }) },
              { value: "monthly", label: t("pim.repeatMonthly", { defaultValue: "Monatlich" }) },
              { value: "yearly", label: t("pim.repeatYearly", { defaultValue: "Jährlich" }) },
            ]}
          />
          {values.repeatFreq && (
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", marginTop: "var(--space-2)", paddingLeft: "var(--space-2)", borderLeft: "2px solid var(--border-color-light)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", flexWrap: "wrap" }}>
                <span>{t("pim.repeatEvery", { defaultValue: "Alle" })}</span>
                <input type="number" min={1} className="pv-field" value={values.repeatInterval} onChange={(e) => setRepeat("repeatInterval", Math.max(1, Number(e.target.value) || 1))} data-testid="event-repeat-interval" style={{ width: 64 }} />
                <span>{freqUnit}</span>
              </div>
              {values.repeatFreq === "weekly" && (
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }} data-testid="event-repeat-weekdays">
                  {WEEKDAY_CODES.map((code, idx) => {
                    const on = values.repeatByWeekday.includes(code);
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => toggleWeekday(code)}
                        aria-pressed={on}
                        style={{ minWidth: 34, padding: "3px 6px", border: "1px solid var(--border-color)", borderRadius: "var(--radius-sm)", cursor: "pointer", fontSize: "var(--text-xs)", background: on ? "var(--accent-color)" : "transparent", color: on ? "var(--accent-on)" : "var(--text-muted)" }}
                      >
                        {weekdayShort(idx)}
                      </button>
                    );
                  })}
                </div>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)", flexWrap: "wrap" }}>
                <span>{t("pim.repeatEnds", { defaultValue: "Endet" })}</span>
                <Select
                  ariaLabel={t("pim.repeatEnds", { defaultValue: "Endet" })}
                  value={values.repeatEnd}
                  onChange={(v) => setRepeat("repeatEnd", v as EventFormValues["repeatEnd"])}
                  options={[
                    { value: "never", label: t("pim.repeatEndNever", { defaultValue: "Nie" }) },
                    { value: "until", label: t("pim.repeatEndOn", { defaultValue: "Am" }) },
                    { value: "count", label: t("pim.repeatEndAfter", { defaultValue: "Nach" }) },
                  ]}
                />
                {values.repeatEnd === "until" && (
                  <input type="date" className="pv-field" value={values.repeatUntil} onChange={(e) => setRepeat("repeatUntil", e.target.value)} data-testid="event-repeat-until" />
                )}
                {values.repeatEnd === "count" && (
                  <>
                    <input type="number" min={1} className="pv-field" value={values.repeatCount} onChange={(e) => setRepeat("repeatCount", Math.max(1, Number(e.target.value) || 1))} data-testid="event-repeat-count" style={{ width: 64 }} />
                    <span>{t("pim.repeatOccurrences", { defaultValue: "Terminen" })}</span>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
        <label style={{ fontSize: "var(--text-sm)" }}>
          {t("pim.eventLocation", { defaultValue: "Ort" })}
          <TextInput
            value={values.location}
            onChange={(e) => set("location", e.target.value)}
            data-testid="event-location"
            style={{ display: "block", width: "100%", marginTop: 2 }}
          />
        </label>
        <label style={{ fontSize: "var(--text-sm)" }}>
          {t("pim.eventDescription", { defaultValue: "Beschreibung" })}
          <textarea
            className="pv-field pv-field--area"
            value={values.description}
            onChange={(e) => set("description", e.target.value)}
            data-testid="event-description"
            rows={3}
            style={{ display: "block", width: "100%", marginTop: 2 }}
          />
        </label>
        {/* Invitees: Google-Calendar-style chips — type an email, Enter/comma/
            blur adds it as a chip. The RSVP status list below shows responses. */}
        <div>
          <label style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 2 }} htmlFor="event-attendees-input">
            {t("pim.attendees", { defaultValue: "Teilnehmer" })}
          </label>
          <div
            className="pv-field"
            data-testid="event-attendees-field"
            style={{ display: "flex", flexWrap: "wrap", gap: 4, alignItems: "center", minHeight: "var(--control-h-md, 34px)", height: "auto", paddingTop: 4, paddingBottom: 4, cursor: "text" }}
            onClick={(e) => { if (e.target === e.currentTarget) (e.currentTarget.querySelector("input") as HTMLInputElement | null)?.focus(); }}
          >
            {attendeeList.map((email) => (
              <span
                key={email}
                data-testid="event-attendee-chip"
                style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--bg-secondary)", border: "1px solid var(--border-color-light)", borderRadius: "var(--radius-pill)", padding: "1px 4px 1px 8px", fontSize: "var(--text-xs)", maxWidth: "100%" }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{email}</span>
                <button
                  type="button"
                  onClick={() => removeAttendee(email)}
                  aria-label={t("pim.attendeeRemove", { defaultValue: "Teilnehmer entfernen: {{email}}", email })}
                  data-testid="event-attendee-remove"
                  style={{ display: "inline-flex", border: "none", background: "transparent", cursor: "pointer", color: "var(--text-muted)", padding: 0, lineHeight: 0 }}
                >
                  <X size={12} />
                </button>
              </span>
            ))}
            <input
              id="event-attendees-input"
              value={attendeeDraft}
              onChange={(e) => setAttendeeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "," || e.key === ";") {
                  e.preventDefault();
                  commitAttendees(attendeeDraft);
                } else if (e.key === "Backspace" && attendeeDraft === "" && attendeeList.length > 0) {
                  removeAttendee(attendeeList[attendeeList.length - 1]);
                }
              }}
              onBlur={() => commitAttendees(attendeeDraft)}
              data-testid="event-attendees-input"
              placeholder={attendeeList.length === 0 ? t("pim.attendeesChipHint", { defaultValue: "E-Mail-Adresse eingeben und Enter drücken" }) : ""}
              style={{ flex: 1, minWidth: 120, border: "none", outline: "none", background: "transparent", color: "inherit", font: "inherit", padding: "2px 0" }}
            />
          </div>
        </div>
        <div>
          <label style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 4 }}>
            {t("pim.eventColor", { defaultValue: "Farbe" })}
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }} data-testid="event-color-picker">
            <button
              type="button"
              onClick={() => set("color", "")}
              data-testid="event-color-default"
              aria-pressed={!values.color}
              title={t("pim.eventColorDefault", { defaultValue: "Kalenderfarbe" })}
              style={{ width: 22, height: 22, borderRadius: "var(--radius-pill)", background: "var(--bg-secondary)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--text-muted)", border: values.color ? "1px solid var(--border-color)" : "2px solid var(--accent-color)" }}
            >
              ✕
            </button>
            {EVENT_COLOR_PALETTE.map((hex) => {
              const active = values.color.toLowerCase() === hex;
              return (
                <button
                  key={hex}
                  type="button"
                  onClick={() => set("color", hex)}
                  aria-pressed={active}
                  data-testid={`event-color-${hex}`}
                  title={hex}
                  style={{ width: 22, height: 22, borderRadius: "var(--radius-pill)", background: hex, cursor: "pointer", border: active ? "2px solid var(--text-main)" : "1px solid var(--border-color-light)", boxShadow: active ? "0 0 0 2px var(--bg-primary) inset" : "none" }}
                />
              );
            })}
          </div>
        </div>
        {mode === "edit" && rsvps && rsvps.length > 0 && (
          <div>
            <label style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 4 }}>
              {t("pim.attendeeResponses", { defaultValue: "Antworten" })}
            </label>
            <div data-testid="event-attendees" style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 120, overflow: "auto" }}>
              {rsvps.map((a) => (
                <div key={`${a.name}-${a.email ?? ""}`} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-sm)" }}>
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: "var(--radius-pill)", background: STATUS_COLOR[a.status], flexShrink: 0 }} />
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {a.name}
                    {a.organizer ? ` · ${t("pim.organizer", { defaultValue: "Organisator" })}` : ""}
                  </span>
                  <span style={{ marginLeft: "auto", color: "var(--text-muted)", flexShrink: 0 }}>{statusLabel(a.status)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {mode === "edit" && selfResponse && onRespond && (
          <div>
            <label style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 4 }}>
              {t("pim.yourResponse", { defaultValue: "Deine Antwort" })}
            </label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} data-testid="event-rsvp">
              <Button size="sm" variant={ownStatus === "accepted" ? "primary" : "ghost"} disabled={responding} data-testid="rsvp-accept" onClick={() => void respond("accepted")}>
                {t("pim.rsvpAccept", { defaultValue: "Zusagen" })}
              </Button>
              <Button size="sm" variant={ownStatus === "tentative" ? "primary" : "ghost"} disabled={responding} data-testid="rsvp-tentative" onClick={() => void respond("tentative")}>
                {t("pim.rsvpTentative", { defaultValue: "Vorläufig" })}
              </Button>
              <Button size="sm" variant={ownStatus === "declined" ? "primary" : "ghost"} disabled={responding} data-testid="rsvp-decline" onClick={() => void respond("declined")}>
                {t("pim.rsvpDecline", { defaultValue: "Absagen" })}
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p style={{ color: "var(--error-text)", fontSize: "var(--text-sm)", margin: 0 }} data-testid="event-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
