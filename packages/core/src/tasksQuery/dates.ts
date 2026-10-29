/**
 * Calendar arithmetic for Tasks queries, on day keys (`YYYY-MM-DD`) and never
 * on timestamps: a day is a day, whatever the device's time zone or a change
 * to summer time does to the clock. "Today" is always handed in; nothing here
 * reads a clock.
 *
 * Weeks are ISO weeks, Monday to Sunday, as in the Tasks plugin (plan
 * Tasks-Abfragen, E8) — not the app's "week starts on" setting, so that a
 * query shows the same tasks in Obsidian and in Plainva.
 */


/** A calendar day, `YYYY-MM-DD`. Day keys compare as strings in calendar order. */
export type DayKey = string;

/** A date a query names: one day, or an inclusive range of days. */
export type TasksDateValue = { kind: "day"; day: DayKey } | { kind: "range"; from: DayKey; to: DayKey };

/**
 * What became of a date phrase: a value; `invalid` for a phrase in a form the
 * Tasks plugin knows but naming no day (`2026-02-30`, `2026-W54`, `2026-13`) —
 * an error in Tasks too; `unknown` for a phrase Plainva does not read (Tasks
 * reads more English through a language parser).
 */
export type TasksDateParse = { ok: true; value: TasksDateValue } | { ok: false; reason: "invalid" | "unknown" };

const DAY_MS = 86_400_000;

const isDigit = (code: number) => code >= 48 && code <= 57;

/**
 * Days since 1970-01-01 for a valid day key, else null. Pure arithmetic (the
 * civil-from-days algorithm), no `Date`: a query reads it for every task.
 */
export function dayNumberOf(key: string): number | null {
  if (key.length !== 10 || key.charCodeAt(4) !== 45 || key.charCodeAt(7) !== 45) return null;
  for (const i of [0, 1, 2, 3, 5, 6, 8, 9]) if (!isDigit(key.charCodeAt(i))) return null;
  const y = Number(key.slice(0, 4));
  const m = Number(key.slice(5, 7));
  const d = Number(key.slice(8, 10));
  if (m < 1 || m > 12 || d < 1) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const length = m === 2 ? (leap ? 29 : 28) : m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
  if (d > length) return null;
  const yy = m <= 2 ? y - 1 : y;
  const era = Math.floor(yy / 400);
  const yoe = yy - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
}

/** The day key of a day number. */
export function dayKeyOf(day: number): DayKey {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

export function isDayKey(value: string): boolean {
  return dayNumberOf(value) !== null;
}

export function addDays(key: DayKey, days: number): DayKey {
  return dayKeyOf(dayNumberOf(key)! + days);
}

/** Calendar months; a day past the end of the target month lands on its last day (Jan 31 + 1 month = Feb 28/29). */
export function addMonths(key: DayKey, months: number): DayKey {
  const [y, m, d] = key.split("-").map(Number);
  const first = Date.UTC(y, m - 1 + months, 1);
  const date = new Date(first);
  const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(d, last));
  return date.toISOString().slice(0, 10);
}

export function addYears(key: DayKey, years: number): DayKey {
  return addMonths(key, years * 12);
}

/** 1 = Monday … 7 = Sunday. */
export function isoWeekday(key: DayKey): number {
  // 1970-01-01 was a Thursday (4).
  const n = dayNumberOf(key)!;
  return ((((n + 3) % 7) + 7) % 7) + 1;
}

/** The Monday of the week a day is in. */
export function isoWeekStartOf(key: DayKey): DayKey {
  return addDays(key, 1 - isoWeekday(key));
}

/** The ISO week a day belongs to — its year may differ from the day's (Dec 29 can be week 1). */
export function isoWeekOf(key: DayKey): { year: number; week: number } {
  const thursday = addDays(key, 4 - isoWeekday(key));
  const year = Number(thursday.slice(0, 4));
  const jan1 = dayNumberOf(`${String(year).padStart(4, "0")}-01-01`)!;
  return { year, week: Math.floor((dayNumberOf(thursday)! - jan1) / 7) + 1 };
}

/** 52 or 53: a year has week 53 when its Dec 28 falls in it. */
export function isoWeeksInYear(year: number): number {
  return isoWeekOf(`${String(year).padStart(4, "0")}-12-28`).week;
}

/** The Monday of ISO week `week` of `year`, or null when the year has no such week. */
export function isoWeekMonday(year: number, week: number): DayKey | null {
  if (week < 1 || week > isoWeeksInYear(year)) return null;
  // Jan 4 is always in week 1.
  const jan4 = `${String(year).padStart(4, "0")}-01-04`;
  return addDays(isoWeekStartOf(jan4), (week - 1) * 7);
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const monthRange = (year: number, month: number): TasksDateValue => {
  const from = `${pad(year, 4)}-${pad(month)}-01`;
  return { kind: "range", from, to: addDays(addMonths(from, 1), -1) };
};
const quarterRange = (year: number, quarter: number): TasksDateValue => {
  const from = `${pad(year, 4)}-${pad((quarter - 1) * 3 + 1)}-01`;
  return { kind: "range", from, to: addDays(addMonths(from, 3), -1) };
};
const yearRange = (year: number): TasksDateValue => ({ kind: "range", from: `${pad(year, 4)}-01-01`, to: `${pad(year, 4)}-12-31` });
const weekRange = (monday: DayKey): TasksDateValue => ({ kind: "range", from: monday, to: addDays(monday, 6) });

const WEEKDAYS: Record<string, number> = {
  monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5, saturday: 6, sat: 6, sunday: 7, sun: 7,
};
const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const UNIT = /^(day|week|month|year)s?$/;

function amountOf(word: string): number | null {
  if (/^\d{1,4}$/.test(word)) return Number(word);
  return NUMBER_WORDS[word] ?? null;
}

function shift(today: DayKey, unit: string, amount: number): DayKey {
  if (unit === "day") return addDays(today, amount);
  if (unit === "week") return addDays(today, amount * 7);
  if (unit === "month") return addMonths(today, amount);
  return addYears(today, amount);
}

/** `last|this|next week|month|quarter|year`, relative to today. */
function relativeRange(which: string, unit: string, today: DayKey): TasksDateValue {
  const step = which === "last" ? -1 : which === "next" ? 1 : 0;
  if (unit === "week") return weekRange(addDays(isoWeekStartOf(today), step * 7));
  const [y, m] = today.split("-").map(Number);
  if (unit === "month") {
    const first = addMonths(`${pad(y, 4)}-${pad(m)}-01`, step);
    return monthRange(Number(first.slice(0, 4)), Number(first.slice(5, 7)));
  }
  if (unit === "quarter") {
    const first = addMonths(`${pad(y, 4)}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`, step * 3);
    return quarterRange(Number(first.slice(0, 4)), Math.floor((Number(first.slice(5, 7)) - 1) / 3) + 1);
  }
  return yearRange(y + step);
}

/**
 * Reads the date phrase of a date filter, relative to `today`:
 *
 * - a day `2026-10-25`, or two of them as a range (one invalid: the other alone,
 *   as in Tasks);
 * - `today`, `tomorrow`, `yesterday`, `now`; a weekday (`friday`, `fri`): the
 *   next such day, today included;
 * - `N days|weeks|months|years ago`, `in N …` (N a number or `a`/`one`…`twelve`);
 * - `last|this|next week|month|quarter|year` (weeks ISO);
 * - `2026-W44`, `2026-10`, `2026-Q4`, `2026`.
 *
 * Anything else is `unknown`. Case and runs of blanks do not matter.
 */
export function parseTasksDate(phrase: string, today: DayKey): TasksDateParse {
  const text = phrase.trim().toLowerCase().replace(/\s+/g, " ");
  if (text === "") return { ok: false, reason: "unknown" };
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4}-\d{2}-\d{2}) (\d{4}-\d{2}-\d{2})$/.exec(text))) {
    const a = isDayKey(m[1]) ? m[1] : null;
    const b = isDayKey(m[2]) ? m[2] : null;
    if (a && b) return { ok: true, value: a <= b ? { kind: "range", from: a, to: b } : { kind: "range", from: b, to: a } };
    const one = a ?? b;
    return one ? { ok: true, value: { kind: "day", day: one } } : { ok: false, reason: "invalid" };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return isDayKey(text) ? { ok: true, value: { kind: "day", day: text } } : { ok: false, reason: "invalid" };
  if ((m = /^(\d{4})-w(\d{1,2})$/.exec(text))) {
    const monday = isoWeekMonday(Number(m[1]), Number(m[2]));
    return monday ? { ok: true, value: weekRange(monday) } : { ok: false, reason: "invalid" };
  }
  if ((m = /^(\d{4})-q(\d)$/.exec(text))) {
    const q = Number(m[2]);
    return q >= 1 && q <= 4 ? { ok: true, value: quarterRange(Number(m[1]), q) } : { ok: false, reason: "invalid" };
  }
  if ((m = /^(\d{4})-(\d{2})$/.exec(text))) {
    const month = Number(m[2]);
    return month >= 1 && month <= 12 ? { ok: true, value: monthRange(Number(m[1]), month) } : { ok: false, reason: "invalid" };
  }
  if (/^\d{4}$/.test(text)) return { ok: true, value: yearRange(Number(text)) };
  if (text === "today" || text === "now") return { ok: true, value: { kind: "day", day: today } };
  if (text === "tomorrow") return { ok: true, value: { kind: "day", day: addDays(today, 1) } };
  if (text === "yesterday") return { ok: true, value: { kind: "day", day: addDays(today, -1) } };
  if (text in WEEKDAYS) {
    const ahead = (WEEKDAYS[text] - isoWeekday(today) + 7) % 7;
    return { ok: true, value: { kind: "day", day: addDays(today, ahead) } };
  }
  if ((m = /^(last|this|next) (week|month|quarter|year)$/.exec(text))) return { ok: true, value: relativeRange(m[1], m[2], today) };
  const words = text.split(" ");
  if (words.length === 3 && words[2] === "ago") {
    const amount = amountOf(words[0]);
    const unit = UNIT.exec(words[1])?.[1];
    if (amount !== null && unit) return { ok: true, value: { kind: "day", day: shift(today, unit, -amount) } };
  }
  if (words.length === 3 && words[0] === "in") {
    const amount = amountOf(words[1]);
    const unit = UNIT.exec(words[2])?.[1];
    if (amount !== null && unit) return { ok: true, value: { kind: "day", day: shift(today, unit, amount) } };
  }
  return { ok: false, reason: "unknown" };
}

/** The first and last day a date value covers. */
export function dateValueBounds(value: TasksDateValue): { from: DayKey; to: DayKey } {
  return value.kind === "day" ? { from: value.day, to: value.day } : { from: value.from, to: value.to };
}
