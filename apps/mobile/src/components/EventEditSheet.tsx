import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link2, Trash2 } from "lucide-react";
import {
  appendLine,
  Button,
  Chip,
  emptyEventForm,
  localDayDistance,
  type EventFormValues,
  eventFormFromEvent,
  eventFormToDraft,
  ICON,
  localIsoKey,
  noteLinkMarkdown,
  noteLinkUrlFor,
  type RepeatEnd,
  Switch,
  TextArea,
  TextInput,
  EVENT_COLOR_PALETTE,
} from "@plainva/ui";
import { sameStoredValue, type PimEventDraft, type PimEventRow, type PimRecurrenceFreq } from "@plainva/core";
import { SheetGrip } from "./SheetGrip";
import { useSheetGuard } from "../hooks/useSheetGuard";
import { mSelect } from "../services/mobileDialogs";
import { MobileSwatchGrid } from "./MobileSwatchGrid";
import { NotePickSheet } from "./NotePickSheet";
import { getMobileVault, type MobileVault } from "../services/vaultService";
import { activeVaultLinkName } from "../services/noteLinkRoute";

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
  /**
   * Pre-filled start/end (a tapped slot) and the calendar to create in. With
   * `form`, a new appointment opens with every field as given (AI harness
   * P5-6: a draft of the assistant's) — title, day, times, place, notes,
   * invitees —, and what it names counts as typed.
   */
  initial: { startTs: number; endTs: number; calendarKey: string; form?: EventFormValues };
  calendars: Array<{ value: string; label: string }>;
  onSave: (values: EventEditValues) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  // The form VALUES are shared (S25): the touched guards live in them, and they
  // are what keeps an edit of the time from resetting who answered an
  // invitation or overwriting a recurrence we could only read half of.
  const [opened] = useState<EventFormValues>(() => {
    if (event) return eventFormFromEvent(event);
    if (initial.form) return { ...initial.form, calendarKey: initial.form.calendarKey || initial.calendarKey };
    const base = emptyEventForm(localIsoKey(new Date(initial.startTs)), initial.calendarKey);
    return { ...base, startTime: hhmm(initial.startTs), endTime: hhmm(initial.endTs), endDayOffset: localDayDistance(initial.startTs, initial.endTs) };
  });
  const [form, setForm] = useState<EventFormValues>(opened);
  // Whatever differs from what the sheet opened with is unsaved (finding 2026-10-22).
  const close = useSheetGuard("event-edit", !sameStoredValue(form, opened), onClose);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EventFormValues>) => setForm((prev) => ({ ...prev, ...patch }));
  // "Link a note" (F2): the picker lists the open vault's notes; a pick adds a
  // link to the description that opens the note in Plainva.
  const [pickVault, setPickVault] = useState<MobileVault | null>(null);
  const linkNote = async (path: string, title: string) => {
    const line = noteLinkMarkdown(title, noteLinkUrlFor(await activeVaultLinkName(), path));
    setForm((prev) => ({ ...prev, description: appendLine(prev.description, line), descriptionTouched: true }));
  };
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
      // A value with a state: the ring sits on the event's calendar (E20).
      const picked = await mSelect({ title: t("pim.eventCalendar"), options: calendars, value: form.calendarKey });
      if (picked !== null) set({ calendarKey: picked });
    })();
  };

  return (
    <div className="m-sheet-backdrop" onClick={close}>
      <div className="pv-sheet m-sheet" onClick={(e) => e.stopPropagation()}>
        <SheetGrip onClose={close} />
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
            {/* The date has its own row above: this one carries the two times
                only (TestFlight 2026-11-02 - "Date & time" wrapped over three lines). */}
            <span className="m-peeklabel">{t("editor.time")}</span>
            <TextInput
              aria-label={t("pim.eventFrom")}
              onChange={(e) => set({ startTime: e.target.value })}
              type="time"
              value={form.startTime}
            />
            <TextInput
              aria-label={t("pim.eventTo")}
              // An end time typed here is on the start's day (`endDayOffset`).
              onChange={(e) => set({ endTime: e.target.value, endDayOffset: undefined })}
              type="time"
              value={form.endTime}
            />
          </div>
        )}

        <button className="m-row m-row--split" onClick={pickCalendar}>
          <span className="m-peeklabel">{t("pim.eventCalendar")}</span>
          <span className="m-peekvalue">{calendarLabel}</span>
        </button>

        {/* The event colour (C48, catalog gap `event-color` until 2026-09-04):
            the form already carried the field and the draft wrote it — only
            the row was missing. Same grid and same first tile as the desktop
            dialog: the struck slot means "the calendar's colour", and there
            is no free tile because event colours map onto provider ids. */}
        <div className="m-row m-row--split">
          <span className="m-peeklabel">{t("pim.eventColor", { defaultValue: "Farbe" })}</span>
          <span className="m-peekvalue">{t("pim.eventColorDesc", { defaultValue: "Überschreibt für diesen Termin die Kalenderfarbe" })}</span>
        </div>
        <MobileSwatchGrid
          ariaLabel={t("pim.eventColor", { defaultValue: "Farbe" })}
          presets={EVENT_COLOR_PALETTE}
          value={form.color}
          onPick={(hex) => set({ color: hex })}
          none={{ label: t("pim.eventColorDefault", { defaultValue: "Kalenderfarbe" }), active: !form.color, onPick: () => set({ color: "" }), glyph: "slash" }}
        />

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
        <Button variant="ghost" size="sm" data-testid="event-note-link" onClick={() => void getMobileVault().then(setPickVault).catch(() => undefined)}>
          <Link2 size={ICON.ui} />
          {t("noteLink.insert")}
        </Button>
        {pickVault && (
          <NotePickSheet
            vault={pickVault}
            title={t("noteLink.insert")}
            hint={t("noteLink.pickHint")}
            onClose={() => setPickVault(null)}
            onPick={(picked, title) => void linkNote(picked, title || picked)}
          />
        )}

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
          purpose="address"
          inputMode="email"
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
