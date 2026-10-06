import { frontmatterKeys, readFrontmatterPath, type SituationInput } from "@plainva/core";
import { parseBaseConfig } from "../base/baseFormat";
import { resolveTaskCompletionModel, taskDbRows } from "../lib/taskDatabase";
import { addDaysToKey, type PlannerRow } from "../lib/taskPlanner";
import { plannerRowsFromDb } from "../lib/taskPlannerRows";
import { calendarDay, journalTodayKey } from "../lib/today";

/**
 * The situation of the context package (plan §7), formed the same way in
 * both shells: each shell hands in what it knows — the open note and its
 * text, the selection, its tabs, the task rows, the appointments, today's
 * daily note — and this module turns it into the package's input. "Today" is
 * the app's today (`today.ts`): the calendar day for appointments and due
 * dates, the journal's day for the daily note. The AI computes no date.
 */

export interface SituationEventInput {
  title: string;
  start: Date;
  end?: Date | null;
  allDay?: boolean;
  calendar?: string | null;
  /**
   * What the calendar tools read of an appointment beyond its day, time and
   * title (plan KI-Harness P4-4). The situation never sends any of it: its
   * own lines are built from the fields above.
   */
  details?: EventDetails;
}

/** An attendee as a tool lists them: the name (or the address where there is none) and the answer. */
export interface EventAttendee {
  name: string;
  status?: "accepted" | "declined" | "tentative" | "needsAction";
  self?: boolean;
  organizer?: boolean;
}

export interface EventDetails {
  /** What tells this appointment from every other: account, calendar and the provider's id. Never shown; the handle is made of it. */
  key: string;
  location?: string;
  /** The organiser's free text — read only by a reader without tools. */
  description?: string;
  attendees?: EventAttendee[];
  /** The user's own answer, where they are invited. */
  response?: EventAttendee["status"];
  status?: "confirmed" | "tentative" | "cancelled";
  /** One of a series. */
  recurring?: boolean;
  /** It has a link to join online. The link itself stays in the calendar. */
  online?: boolean;
}

/** A calendar row as the PIM cache holds it — the fields the tools read. */
export interface CalendarRowInput {
  title: string;
  start: { ts: number; date?: string };
  end: { ts: number; date?: string };
  allDay: boolean;
  uid?: string;
  calendarId?: string;
  accountId?: string;
  location?: string;
  description?: string;
  attendees?: string[];
  rsvps?: { name: string; email?: string; status: NonNullable<EventAttendee["status"]>; self?: boolean; organizer?: boolean }[];
  selfResponse?: EventAttendee["status"];
  status?: "confirmed" | "tentative" | "cancelled";
  seriesMaster?: string;
  recurrence?: string;
  meetingUrl?: string;
}

function detailsOf(row: CalendarRowInput): EventDetails | undefined {
  if (!row.uid) return undefined;
  const attendees: EventAttendee[] = row.rsvps?.length
    ? row.rsvps.map((a) => ({ name: a.name.trim() || a.email?.trim() || "", status: a.status, ...(a.self ? { self: true } : {}), ...(a.organizer ? { organizer: true } : {}) })).filter((a) => a.name)
    : (row.attendees ?? []).map((name) => ({ name: name.trim() })).filter((a) => a.name);
  return {
    key: `${row.accountId ?? ""}|${row.calendarId ?? ""}|${row.uid}`,
    ...(row.location?.trim() ? { location: row.location.trim() } : {}),
    ...(row.description?.trim() ? { description: row.description } : {}),
    ...(attendees.length ? { attendees } : {}),
    ...(row.selfResponse ? { response: row.selfResponse } : {}),
    ...(row.status && row.status !== "confirmed" ? { status: row.status } : {}),
    ...(row.seriesMaster || row.recurrence ? { recurring: true } : {}),
    ...(row.meetingUrl ? { online: true } : {}),
  };
}

export interface SituationSources {
  now: Date;
  active: { path: string; kind: "note" | "base"; text?: string | null } | null;
  selection?: string | null;
  tabs?: readonly string[];
  taskRows?: readonly PlannerRow[];
  events?: readonly SituationEventInput[];
  dailyNotePath?: string | null;
  moodKey?: string | null;
}

/** Calendar rows (the PIM cache) as the situation's appointments: all-day ones keep their civil date. */
export function situationEvents(rows: readonly CalendarRowInput[]): SituationEventInput[] {
  return rows.map((row) => {
    const details = detailsOf(row);
    return {
      title: row.title,
      start: row.allDay && row.start.date ? new Date(`${row.start.date}T00:00:00`) : new Date(row.start.ts),
      end: row.allDay ? null : new Date(row.end.ts),
      allDay: row.allDay,
      ...(details ? { details } : {}),
    };
  });
}

const titleOf = (path: string) => path.slice(path.lastIndexOf("/") + 1).replace(/\.(md|base)$/i, "");
const pad = (n: number) => String(n).padStart(2, "0");
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Days of tasks ahead that count as due in the situation. */
export const SITUATION_TASK_DAYS = 7;
/** Appointments shown: from two hours ago to the end of tomorrow. */
const EVENT_PAST_MS = 2 * 3_600_000;

/** A note's frontmatter properties, the first `max` of them, empty values left out. */
export function notePropertiesOf(text: string, max = 16): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of frontmatterKeys(text).slice(0, max)) {
    const value = readFrontmatterPath(text, [key]);
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out;
}

export function situationFrom(src: SituationSources): SituationInput {
  const today = calendarDay(src.now);
  const horizon = addDaysToKey(today, SITUATION_TASK_DAYS);
  const tasks = (src.taskRows ?? [])
    .filter((row) => (row.state === "open" || row.state === "progress") && row.due !== null && row.due <= horizon)
    .sort((a, b) => (a.due ?? "").localeCompare(b.due ?? "") || (a.priority || 9) - (b.priority || 9))
    .slice(0, 12)
    .map((row) => ({ title: row.title, path: row.path, due: row.due }));
  const endOfTomorrow = new Date(src.now.getFullYear(), src.now.getMonth(), src.now.getDate() + 2).getTime();
  const events = (src.events ?? [])
    .filter((e) => (e.end ?? e.start).getTime() >= src.now.getTime() - EVENT_PAST_MS && e.start.getTime() < endOfTomorrow)
    .sort((a, b) => a.start.getTime() - b.start.getTime())
    .slice(0, 8)
    .map((e) => {
      const sameDay = calendarDay(e.start) === today;
      const start = e.allDay ? calendarDay(e.start) : sameDay ? clock(e.start) : `${calendarDay(e.start)} ${clock(e.start)}`;
      return { title: e.title, start, ...(e.end && !e.allDay ? { end: clock(e.end) } : {}), ...(e.allDay ? { allDay: true } : {}), ...(e.calendar ? { calendar: e.calendar } : {}) };
    });
  const active = src.active
    ? {
        path: src.active.path,
        title: titleOf(src.active.path),
        kind: src.active.kind,
        ...(src.selection && src.selection.trim() ? { selection: src.selection } : {}),
        ...(src.active.kind === "note" && src.active.text ? { properties: notePropertiesOf(src.active.text) } : {}),
      }
    : null;
  return {
    now: `${today} ${clock(src.now)}`,
    weekday: src.now.toLocaleDateString("en-US", { weekday: "long" }),
    calendarDay: today,
    journalDay: journalTodayKey(src.now),
    active,
    moodKey: src.moodKey ?? null,
    tabs: [...new Set(src.tabs ?? [])].filter((p) => p !== src.active?.path && /\.md$/i.test(p)).map((path) => ({ path, title: titleOf(path) })),
    tasks,
    events,
    dailyNote: src.dailyNotePath ? { path: src.dailyNotePath, title: titleOf(src.dailyNotePath) } : null,
  };
}

/**
 * The vault's task database as planner rows, read the way the widgets and the
 * task screens read it: its rows through the one shared completion model. A
 * missing or unreadable database is no tasks, never a failure.
 */
export async function databaseTaskRows(baseText: string | null, query: (config: unknown) => Promise<unknown[]>): Promise<PlannerRow[]> {
  if (!baseText) return [];
  try {
    const config = parseBaseConfig(baseText);
    const raw = (await query(config)) as Record<string, unknown>[];
    return plannerRowsFromDb(taskDbRows(raw, config, resolveTaskCompletionModel(config)), () => undefined);
  } catch {
    return [];
  }
}
