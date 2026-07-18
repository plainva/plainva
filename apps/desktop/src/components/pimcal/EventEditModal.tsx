import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FilePlus2, Trash2 } from "lucide-react";
import { Modal, Button, TextInput, Checkbox, EVENT_COLOR_PALETTE } from "@plainva/ui";
import type { PimAttendee, PimAttendeeStatus } from "@plainva/core";
import { Select } from "../Select";
import type { EventFormValues } from "../../services/pim/calendarModel";

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
  const { t } = useTranslation();
  const [values, setValues] = useState<EventFormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [responding, setResponding] = useState(false);
  const [ownStatus, setOwnStatus] = useState<PimAttendeeStatus | undefined>(selfResponse);

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

  const submit = async () => {
    if (busy) return;
    if (!values.title.trim()) {
      setError(t("pim.eventTitleRequired", { defaultValue: "Bitte einen Titel angeben." }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ ...values, title: values.title.trim() });
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
              {t("pim.attendees", { defaultValue: "Teilnehmer" })}
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
        {mode === "create" && (
          <div>
            <label style={{ display: "block", fontSize: "var(--text-sm)", marginBottom: 2 }}>
              {t("pim.repeat", { defaultValue: "Wiederholung" })}
            </label>
            <Select
              ariaLabel={t("pim.repeat", { defaultValue: "Wiederholung" })}
              value={values.repeat}
              onChange={(v) => set("repeat", v as EventFormValues["repeat"])}
              options={[
                { value: "", label: t("pim.repeatNone", { defaultValue: "Nie" }) },
                { value: "daily", label: t("pim.repeatDaily", { defaultValue: "Täglich" }) },
                { value: "weekly", label: t("pim.repeatWeekly", { defaultValue: "Wöchentlich" }) },
                { value: "monthly", label: t("pim.repeatMonthly", { defaultValue: "Monatlich" }) },
                { value: "yearly", label: t("pim.repeatYearly", { defaultValue: "Jährlich" }) },
              ]}
            />
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
