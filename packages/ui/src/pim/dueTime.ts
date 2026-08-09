/**
 * The time part of a task's due value (S6).
 *
 * A task's due date is deliberately day-granular in the provider model, and the
 * loader has always cut the value to ten characters on the way in. But the
 * DATABASE column may be `datetime`, and then the time is already written in
 * the note — it was simply dropped between the file and the view. So a task due
 * at 12:00 landed in the all-day strip beside things that last all day, which
 * says the opposite of what the note says.
 *
 * The value is a CIVIL time: what stands in the note is what the reader means,
 * exactly like an all-day event's `date`. It is therefore kept as minutes into
 * the day and never turned into an instant — a timestamp would invite exactly
 * the timezone arithmetic that shifts a 00:30 task onto the day before.
 */

export interface DueValue {
  /** YYYY-MM-DD. */
  day: string;
  /** Minutes into that day, when the value carried a time; otherwise absent. */
  minutes?: number;
}

const DAY = /^(\d{4}-\d{2}-\d{2})/;
// "T" or a space between date and time, seconds and a zone suffix optional.
const TIME = /^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/;

/**
 * Parses a frontmatter due value. Returns `null` for anything that is not a
 * date — an unparseable value is not a task that is due at midnight.
 */
export function parseDueValue(raw: unknown): DueValue | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  const day = DAY.exec(text);
  if (!day) return null;

  const time = TIME.exec(text);
  if (!time) return { day: day[1] };

  const hours = Number(time[1]);
  const minutes = Number(time[2]);
  // A malformed clock is not a position in the day; keep the date and say
  // nothing about the time rather than drawing the task at a wrong hour.
  if (hours > 23 || minutes > 59) return { day: day[1] };
  // Midnight is a real time, but it is also what a bare date looks like once a
  // tool has stamped it ("2026-08-09T00:00"). Treating it as a position would
  // hang every such task at the very top of the grid, so it stays day-granular.
  if (hours === 0 && minutes === 0) return { day: day[1] };

  return { day: day[1], minutes: hours * 60 + minutes };
}
