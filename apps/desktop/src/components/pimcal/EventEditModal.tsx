import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Button, TextInput, Checkbox } from "@plainva/ui";
import { Select } from "../Select";
import type { EventFormValues } from "../../services/pim/calendarModel";

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
}

export function EventEditModal({ mode, initial, calendarOptions, onCancel, onSubmit }: EventEditModalProps) {
  const { t } = useTranslation();
  const [values, setValues] = useState<EventFormValues>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      size="sm"
      footer={
        <>
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
        {error && (
          <p style={{ color: "var(--error-text)", fontSize: "var(--text-sm)", margin: 0 }} data-testid="event-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
