/**
 * The short form of a due date, shared by both shells (E3).
 *
 * Task lists showed the raw day key — `2026-08-08` — everywhere. That is the
 * storage form, not a sentence: it is the same width for every task, it reads
 * like data, and it makes the one date that matters (today) look like all the
 * others.
 *
 * Two shapes, exactly as decided: today gets WORDS, every other day gets a
 * bare short date. The asymmetry is the point — "today" is the only value a
 * reader acts on, so it is the only one that gets to say something.
 *
 * The words come from `pim.dueToday`, which the calendar agenda already ships
 * in all ten languages. Writing a second phrasing for the same fact is how
 * two wordings for one thing start.
 *
 * The date itself is formatted by `Intl`, not by hand: "31.07." is German, and
 * a hand-built pattern would print it that way for the nine other languages
 * too. The year appears only when it differs from the current one — otherwise
 * every date in a two-year-old vault reads as if it were this year.
 */
export type DueTone = "due" | "later";

export interface DueLabelOptions {
  locale: string;
  /** Injected so tests do not depend on the wall clock. */
  today?: Date;
  t: (key: string, opts?: Record<string, unknown>) => string;
}

export interface DueLabelResult {
  text: string;
  /** `due` = today or overdue. The inverse of the event rule, and deliberate:
   *  a past EVENT is over, a past TASK is the one that still wants doing. */
  tone: DueTone;
}

/** Local day key (`YYYY-MM-DD`) — the same shape the task index stores. */
function dayKeyOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * A day key is a local calendar day, so it is parsed as one. `new Date("2026-08-08")`
 * parses as UTC midnight and lands on the previous day west of Greenwich —
 * which would make a task read as overdue for a whole day in the Americas.
 */
function parseDayKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDueLabel(dayKey: string, opts: DueLabelOptions): DueLabelResult {
  const now = opts.today ?? new Date();
  const todayKey = dayKeyOf(now);
  const date = parseDayKey(dayKey);

  // An unparseable value is shown as it stands. A due date the app cannot read
  // is a fact about the note, and hiding it would hide the typo that caused it.
  if (!date) return { text: dayKey, tone: dayKey <= todayKey ? "due" : "later" };

  const key = dayKeyOf(date);
  const tone: DueTone = key <= todayKey ? "due" : "later";
  if (key === todayKey) return { text: opts.t("pim.dueToday", { defaultValue: "fällig heute" }), tone };

  const sameYear = date.getFullYear() === now.getFullYear();
  const text = new Intl.DateTimeFormat(opts.locale, {
    day: "2-digit",
    month: "2-digit",
    ...(sameYear ? {} : { year: "2-digit" }),
  }).format(date);
  return { text, tone };
}
