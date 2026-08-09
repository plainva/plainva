import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import {
  Button,
  Chip,
  emptyEventForm,
  type EventFormValues,
  eventFormFromEvent,
  eventFormToDraft,
  ICON,
  localIsoKey,
  type RepeatEnd,
  Switch,
  TextArea,
  TextInput,
} from "@plainva/ui";
import type { PimEventDraft, PimEventRow, PimRecurrenceFreq } from "@plainva/core";
import { SheetGrip } from "./SheetGrip";
import { mSelect } from "../services/mobileDialogs";

/**
 * Creating and editing a calendar event on the phone (S24).
 *
 * The calendar could show events and answer invitations, and that was all —
 * "read-only" in the plan's words. A calendar you cannot write into is a
 * viewer, so this is the missing half: title, when, where, which calendar, and
 * a description.
 *
 * Recurrence and attendees are deliberately NOT here; they come with S25 and
 * carry their own decisions (which occurrences does an edit touch, who gets an
 * invitation). Editing an event that HAS a rule leaves the rule untouched.
 */

/** RRULE weekday codes; 2024-01-01 was a Monday, so index 0 is Monday. */
const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
const FREQS: Array<"" | PimRecurrenceFreq> = ["", "daily", "weekly", "monthly", "yearly"];

function hhmm(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export interface EventEditValues {
  draft: PimEventDraft;
  /** The form state the draft came from — S3 compares it against the event to
   *  decide whether anything changed, and what to tell the user it was. */
  form: EventFormValues;
  /** "<accountId> <calendarId>" — a change means MOVE for an existing event. */
  calendarKey: string;
}

export function EventEditSheet({
  event,
  initial,
  calendars,
  onSave,
  onDelete,
  onClose,
}: {
  /** The event being edited, or null when creating. */
  event: PimEventRow | null;
  /** Pre-filled start/end (a tapped slot) and the calendar to create in. */
  initial: { startTs: number; endTs: number; calendarKey: string };
  calendars: Array<{ value: string; label: string }>;
  onSave: (values: EventEditValues) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  // The form VALUES are shared (S25): the touched guards live in them, and they
  // are what keeps an edit of the time from resetting who answered an
  // invitation or overwriting a recurrence we could only read half of.
  const [form, setForm] = useState<EventFormValues>(() => {
    if (event) return eventFormFromEvent(event);
    const base = emptyEventForm(localIsoKey(new Date(initial.startTs)), initial.calendarKey);
    return { ...base, startTime: hhmm(initial.startTs), endTime: hhmm(initial.endTs) };
  });
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EventFormValues>) => setForm((prev) => ({ ...prev, ...patch }));
  const setRepeat = (patch: Partial<EventFormValues>) => set({ ...patch, repeatTouched: true });

  const calendarLabel = useMemo(
    () => calendars.find((c) => c.value === form.calendarKey)?.label ?? form.calendarKey,
    [calendars, form.calendarKey],
  );

  const save = () => {
    if (!form.title.trim()) return;
    setBusy(true);
    void Promise.resolve(onSave({ calendarKey: form.calendarKey, draft: eventFormToDraft(form), form })).finally(() =>
      setBusy(false),
    );
  };

  const pickCalendar = () => {
    void (async () => {
      const picked = await mSelect({ title: t("pim.eventCalendar"), options: calendars });
      if (picked !== null) set({ calendarKey: picked });
    })();
  };

  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={onClose} />
        <p className="m-sheet-title">{event ? t("pim.editEvent") : t("pim.newEvent")}</p>

        <TextInput
          aria-label={t("pim.eventTitle")}
          autoFocus={!event}
          onChange={(e) => set({ title: e.target.value })}
          placeholder={t("pim.eventTitle")}
          value={form.title}
        />

        <div className="m-row m-row--split">
          <span className="m-peeklabel">{t("pim.allDay")}</span>
          <Switch checked={form.allDay} label={t("pim.allDay")} onChange={(v) => set({ allDay: v })} />
        </div>

        <div className="m-row m-row--split">
          <span className="m-peeklabel">{t("pim.eventDate")}</span>
          <TextInput
            aria-label={t("pim.eventDate")}
            onChange={(e) => set({ dayKey: e.target.value })}
            type="date"
            value={form.dayKey}
          />
        </div>
        {form.allDay ? (
          <div className="m-row m-row--split">
            <span className="m-peeklabel">{t("pim.eventTo")}</span>
            <TextInput
              aria-label={t("pim.eventTo")}
              onChange={(e) => set({ endDayKey: e.target.value })}
              type="date"
              value={form.endDayKey}
            />
          </div>
        ) : (
          <div className="m-row m-row--split">
            <span className="m-peeklabel">{t("pim.eventWhen")}</span>
            <TextInput
              aria-label={t("pim.eventFrom")}
              onChange={(e) => set({ startTime: e.target.value })}
              type="time"
              value={form.startTime}
            />
            <TextInput
              aria-label={t("pim.eventTo")}
              onChange={(e) => set({ endTime: e.target.value })}
              type="time"
              value={form.endTime}
            />
          </div>
        )}

        <button className="m-row m-row--split" onClick={pickCalendar}>
          <span className="m-peeklabel">{t("pim.eventCalendar")}</span>
          <span className="m-peekvalue">{calendarLabel}</span>
        </button>

        <TextInput
          aria-label={t("pim.eventLocation")}
          onChange={(e) => set({ location: e.target.value })}
          placeholder={t("pim.eventLocation")}
          value={form.location}
        />
        <TextArea
          aria-label={t("pim.eventDescription")}
          onChange={(e) => set({ description: e.target.value, descriptionTouched: true })}
          placeholder={t("pim.eventDescription")}
          rows={3}
          value={form.description}
        />

        {/* Repeat (S25). Touching ANY control here marks the rule as edited —
            an untouched event keeps whatever the provider has, including the
            parts Plainva can only read approximately. */}
        <p className="m-sectionlabel m-sectionlabel--inset">{t("pim.repeat")}</p>
        <div className="m-turninto">
          {FREQS.map((f) => (
            <Chip
              key={f || "none"}
              onClick={() => setRepeat({ repeatFreq: f })}
              selected={form.repeatFreq === f}
            >
              {f === ""
                ? t("pim.repeatNone")
                : t(`pim.repeat${f.charAt(0).toUpperCase()}${f.slice(1)}`)}
            </Chip>
          ))}
        </div>
        {form.repeatFreq !== "" && (
          <>
            <div className="m-row m-row--split">
              <span className="m-peeklabel">{t("pim.repeatEvery")}</span>
              <TextInput
                aria-label={t("pim.repeatEvery")}
                inputMode="numeric"
                onChange={(e) => setRepeat({ repeatInterval: Math.max(1, Number(e.target.value) || 1) })}
                type="number"
                value={String(form.repeatInterval)}
              />
            </div>
            {form.repeatFreq === "weekly" && (
              <div className="m-turninto">
                {WEEKDAY_CODES.map((code, idx) => (
                  <Chip
                    key={code}
                    onClick={() =>
                      setRepeat({
                        repeatByWeekday: form.repeatByWeekday.includes(code)
                          ? form.repeatByWeekday.filter((d) => d !== code)
                          : [...form.repeatByWeekday, code],
                      })
                    }
                    selected={form.repeatByWeekday.includes(code)}
                  >
                    {new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(new Date(2024, 0, 1 + idx))}
                  </Chip>
                ))}
              </div>
            )}
            <p className="m-sectionlabel m-sectionlabel--inset">{t("pim.repeatEnds")}</p>
            <div className="m-turninto">
              {(["never", "until", "count"] as RepeatEnd[]).map((end) => (
                <Chip key={end} onClick={() => setRepeat({ repeatEnd: end })} selected={form.repeatEnd === end}>
                  {t(end === "never" ? "pim.repeatEndNever" : end === "until" ? "pim.repeatEndOn" : "pim.repeatEndAfter")}
                </Chip>
              ))}
            </div>
            {form.repeatEnd === "until" && (
              <TextInput
                aria-label={t("pim.repeatEndOn")}
                onChange={(e) => setRepeat({ repeatUntil: e.target.value })}
                type="date"
                value={form.repeatUntil}
              />
            )}
            {form.repeatEnd === "count" && (
              <div className="m-row m-row--split">
                <span className="m-peeklabel">{t("pim.repeatOccurrences")}</span>
                <TextInput
                  aria-label={t("pim.repeatOccurrences")}
                  inputMode="numeric"
                  onChange={(e) => setRepeat({ repeatCount: Math.max(1, Number(e.target.value) || 1) })}
                  type="number"
                  value={String(form.repeatCount)}
                />
              </div>
            )}
          </>
        )}

        {/* Attendees (S25): one address per line, as on the desktop. The
            invitation is the provider's to send — Plainva asks it to. */}
        <p className="m-sectionlabel m-sectionlabel--inset">{t("pim.groupAttendees")}</p>
        <TextArea
          aria-label={t("pim.groupAttendees")}
          onChange={(e) => set({ attendees: e.target.value, attendeesTouched: true })}
          placeholder={t("pim.attendeesHint")}
          rows={2}
          value={form.attendees}
        />
        {form.attendeesTouched && form.attendees.trim() !== "" && (
          <div className="m-row m-row--split">
            <span className="m-peeklabel">{t("pim.notifyAttendees")}</span>
            <Switch
              checked={form.notifyAttendees}
              label={t("pim.notifyAttendees")}
              onChange={(v) => set({ notifyAttendees: v })}
            />
          </div>
        )}

        <div className="m-config-actions">
          <Button disabled={busy || !form.title.trim()} onClick={save} variant="primary">
            {t("common.save")}
          </Button>
          {event && onDelete && (
            <Button onClick={() => void onDelete()} variant="danger">
              <Trash2 size={ICON.meta} /> {t("common.delete")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
