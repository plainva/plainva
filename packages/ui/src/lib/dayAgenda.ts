/**
 * What belongs on one day, and in what order (S32).
 *
 * "Today" is not one list. It is three sources that answer the same question —
 * the daily note (what I wrote), the calendar (where I have to be) and the due
 * tasks (what I owe) — and until now the phone showed only the first, plus the
 * notes that happened to be edited that day. A day surface that omits the
 * appointments is not a day surface; it is a file listing with a date on it.
 *
 * The merge lives here rather than in the screen because the ORDER is a
 * judgement, not a rendering detail, and both shells have to make it the same
 * way:
 *
 *  - All-day events come first. They frame the day rather than sit inside it;
 *    an all-day event sorted by its 00:00 start would collide with an early
 *    meeting and read as if it were happening at midnight.
 *  - Timed events follow in clock order, because that is the order they will
 *    happen in.
 *  - Due tasks come last, and unsorted among themselves beyond their title. A
 *    task due today has no time — pretending it does (start of day, end of day)
 *    would place it somewhere in the timeline that the user never chose.
 *
 * Ties keep a stable order by title so the list does not reshuffle between two
 * reads of the same day.
 */

export interface AgendaEvent {
  uid: string;
  title: string;
  allDay: boolean;
  /** Epoch ms of the start; ignored for all-day entries. */
  startMs: number;
  /** Calendar-local label, e.g. "09:30". Empty for all-day. */
  timeLabel?: string;
  location?: string;
}

export interface AgendaTask {
  path: string;
  title: string;
  done: boolean;
  /** ISO day, `YYYY-MM-DD`. */
  due: string | null;
}

export type AgendaItem =
  | { kind: "event"; event: AgendaEvent }
  | { kind: "task"; task: AgendaTask };

/** Epoch-ms window of one local ISO day — the range a cache query needs. */
export function dayWindow(iso: string): { start: number; end: number } {
  const [y, m, d] = iso.split("-").map(Number);
  const start = new Date(y, (m ?? 1) - 1, d ?? 1).getTime();
  return { start, end: start + 24 * 60 * 60 * 1000 };
}

/**
 * Merges events and due tasks into the one ordered list a day surface shows.
 *
 * Events are filtered by the caller's window (the cache query already does
 * that); tasks are filtered here on their ISO due day, because a task list is
 * never day-scoped at the source.
 */
export function buildDayAgenda(
  iso: string,
  events: readonly AgendaEvent[],
  tasks: readonly AgendaTask[],
  opts: { includeDone?: boolean } = {},
): AgendaItem[] {
  const byTitle = (a: string, b: string) => a.localeCompare(b);

  const allDay = events
    .filter((e) => e.allDay)
    .sort((a, b) => byTitle(a.title, b.title));

  const timed = events
    .filter((e) => !e.allDay)
    .sort((a, b) => a.startMs - b.startMs || byTitle(a.title, b.title));

  const due = tasks
    .filter((tk) => tk.due === iso)
    // A task finished today still belongs to today's record, but it is not
    // something to do — the caller decides, and the default is the actionable
    // list, because that is what a day surface is for.
    .filter((tk) => (opts.includeDone ? true : !tk.done))
    .sort((a, b) => byTitle(a.title, b.title));

  return [
    ...allDay.map((event) => ({ kind: "event" as const, event })),
    ...timed.map((event) => ({ kind: "event" as const, event })),
    ...due.map((task) => ({ kind: "task" as const, task })),
  ];
}

/**
 * The strip runs in BOTH directions (redesign § 3.6). It used to end at
 * tomorrow, which quietly made the surface a review tool: you could see what
 * you had done and not what is coming. A day view whose future is one day long
 * cannot answer "what does next week look like".
 */
export function buildDayStrip(today: Date, back: number, forward: number): Date[] {
  const days: Date[] = [];
  for (let offset = -back; offset <= forward; offset++) {
    const d = new Date(today);
    d.setDate(d.getDate() + offset);
    days.push(d);
  }
  return days;
}
