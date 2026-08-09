/**
 * What changed in the event form — and what that means for a series (S3).
 *
 * "Only this event or all of them?" used to be asked when the form OPENED. That
 * is the wrong moment twice over: it asks about writing before anything has been
 * written, and it cannot say what the answer applies to. Asked at SAVE time it
 * can name the change ("09:00 → 09:15"), and a form closed without an edit needs
 * no dialog and no write at all.
 *
 * Both shells edit the same `EventFormValues`, so the comparison belongs here:
 * a phone that counted "changed" differently from the desktop would ask
 * different questions about the same edit — or, worse, write when the other
 * would not.
 *
 * Applying the change is the second half. Picking "all events" must NOT push the
 * instance's whole form onto the master: the master carries the series' own
 * start date, and overwriting it would drag the entire series to the day of the
 * occurrence that happened to be open. Only the CHANGED fields travel.
 */

import type { EventFormValues } from "./calendarForm";

/** A field of the form, as far as a human cares about it. */
export type EventFieldKey =
  | "title"
  | "allDay"
  | "date"
  | "time"
  | "location"
  | "description"
  | "color"
  | "calendar"
  | "attendees"
  | "repeat";

export interface EventChange {
  field: EventFieldKey;
  /** Human-readable before/after; empty string where the value was unset. */
  from: string;
  to: string;
}

/** Which form fields carry each human field — the map the diff walks. */
const FIELDS: Array<{ key: EventFieldKey; of: (v: EventFormValues) => string }> = [
  { key: "title", of: (v) => v.title.trim() },
  { key: "allDay", of: (v) => (v.allDay ? "1" : "") },
  { key: "date", of: (v) => (v.allDay ? `${v.dayKey}–${v.endDayKey}` : v.dayKey) },
  { key: "time", of: (v) => (v.allDay ? "" : `${v.startTime}–${v.endTime}`) },
  { key: "location", of: (v) => v.location.trim() },
  { key: "color", of: (v) => v.color.trim().toLowerCase() },
  { key: "calendar", of: (v) => v.calendarKey.trim() },
];

/** Fields the form only reports when the user actually touched the control. */
function touchedFields(before: EventFormValues, after: EventFormValues): EventChange[] {
  const out: EventChange[] = [];
  // The touched guards exist because an untouched control must never overwrite
  // what the provider holds (rich HTML, the attendee list with its RSVPs, a
  // recurrence we could only read half of). An untouched control is therefore
  // not a change either, whatever the cached values look like.
  if (after.descriptionTouched && before.description.trim() !== after.description.trim())
    out.push({ field: "description", from: before.description.trim(), to: after.description.trim() });
  if (after.attendeesTouched && before.attendees.trim() !== after.attendees.trim())
    out.push({ field: "attendees", from: before.attendees.trim(), to: after.attendees.trim() });
  if (after.repeatTouched) {
    const rule = (v: EventFormValues) =>
      v.repeatFreq ? `${v.repeatFreq}/${v.repeatInterval}/${[...v.repeatByWeekday].sort().join(",")}/${v.repeatEnd}/${v.repeatUntil}/${v.repeatCount}` : "";
    if (rule(before) !== rule(after)) out.push({ field: "repeat", from: rule(before), to: rule(after) });
  }
  return out;
}

/**
 * Every difference between two form states, in a stable order. Pure — the shells
 * turn the field keys into words, because that is the part that is translated.
 */
export function describeEventChanges(before: EventFormValues, after: EventFormValues): EventChange[] {
  const out: EventChange[] = [];
  for (const f of FIELDS) {
    const a = f.of(before);
    const b = f.of(after);
    if (a !== b) out.push({ field: f.key, from: a, to: b });
  }
  return [...out, ...touchedFields(before, after)];
}

/** Whether saving would write anything at all. */
export function hasEventChanges(before: EventFormValues, after: EventFormValues): boolean {
  return describeEventChanges(before, after).length > 0;
}

/**
 * The changed fields of `after`, applied onto `base` — everything else stays as
 * `base` has it. This is what "apply to all events" means: the master keeps its
 * own start date, its own description, its own attendees, and takes over only
 * what the user actually edited on the occurrence they had open.
 */
export function applyEventChanges(base: EventFormValues, after: EventFormValues, changes: readonly EventChange[]): EventFormValues {
  const out: EventFormValues = { ...base };
  for (const c of changes) {
    switch (c.field) {
      case "title":
        out.title = after.title;
        break;
      case "allDay":
        out.allDay = after.allDay;
        break;
      case "date":
        // A date change on an occurrence moves the series ANCHOR when it is
        // applied to all — that is what the user asked for, but it is also why
        // the question names the change before it happens.
        out.dayKey = after.dayKey;
        out.endDayKey = after.endDayKey;
        break;
      case "time":
        out.startTime = after.startTime;
        out.endTime = after.endTime;
        break;
      case "location":
        out.location = after.location;
        break;
      case "description":
        out.description = after.description;
        out.descriptionTouched = true;
        break;
      case "color":
        out.color = after.color;
        break;
      case "calendar":
        out.calendarKey = after.calendarKey;
        break;
      case "attendees":
        out.attendees = after.attendees;
        out.attendeesTouched = true;
        out.notifyAttendees = after.notifyAttendees;
        break;
      case "repeat":
        out.repeatFreq = after.repeatFreq;
        out.repeatInterval = after.repeatInterval;
        out.repeatByWeekday = [...after.repeatByWeekday];
        out.repeatEnd = after.repeatEnd;
        out.repeatUntil = after.repeatUntil;
        out.repeatCount = after.repeatCount;
        out.repeatTouched = true;
        break;
    }
  }
  return out;
}

/**
 * Turns a change into the line the scope dialog shows ("Uhrzeit: 09:00 →
 * 09:15"). This lives beside the comparison rather than in either shell: two
 * copies would drift into naming the same edit differently on phone and desktop
 * — the exact failure this step exists to prevent.
 */
const FIELD_KEY: Record<EventFieldKey, { key: string; fallback: string }> = {
  title: { key: "pim.eventTitle", fallback: "Titel" },
  allDay: { key: "pim.allDay", fallback: "Ganztägig" },
  date: { key: "pim.eventDate", fallback: "Datum" },
  time: { key: "pim.groupTime", fallback: "Zeit" },
  location: { key: "pim.eventLocation", fallback: "Ort" },
  description: { key: "pim.eventDescription", fallback: "Beschreibung" },
  color: { key: "pim.eventColor", fallback: "Farbe" },
  calendar: { key: "pim.eventCalendar", fallback: "Kalender" },
  attendees: { key: "pim.attendees", fallback: "Teilnehmer" },
  repeat: { key: "pim.repeat", fallback: "Wiederholung" },
};

export type EventChangeT = (key: string, opts?: Record<string, unknown>) => string;

/**
 * "Uhrzeit: 09:00 → 09:15" — or the field name alone where a before/after pair
 * says nothing useful: an encoded rule, a value that was empty, or a text too
 * long to read in a dialog line.
 */
export function eventChangeLabel(change: EventChange, t: EventChangeT): string {
  const f = FIELD_KEY[change.field];
  const name = t(f.key, { defaultValue: f.fallback });
  const short = (s: string) => s.length > 0 && s.length <= 40;
  if (change.field === "repeat" || !short(change.from) || !short(change.to)) return name;
  return `${name}: ${change.from} → ${change.to}`;
}
