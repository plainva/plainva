/**
 * Clock times as the app shows them (finding X4, review 2026-11-10).
 *
 * The calendar wrote its hour axis by hand as "14:00" and its events through
 * `Intl` in the APP language — an English UI therefore showed "02:00 PM" next to
 * an axis that said "14:00", in both shells. A clock time is not a matter of the
 * UI language: whoever set their device to 24 hours reads 24 hours in every
 * language, and the other way round. So the hour cycle comes from the device and
 * the words (AM/PM, their spelling) from the app language.
 *
 * This is the ONE place that formats a time of day. The planned shared date
 * formatter (package O2 of the interface plan) grows from here: dates, relative
 * days and a user setting for the hour cycle extend `TimeFormatOptions` rather
 * than starting a second module.
 */

/** 24 hours (`h23`) or 12 hours with a day period (`h12`). */
export type HourCycle = "h12" | "h23";

export interface TimeFormatOptions {
  /** The app's UI language (i18next code, e.g. "de", "en", "pt-BR"). */
  language: string;
  /** Overrides the device's hour cycle — tests, and later a user setting. */
  hourCycle?: HourCycle;
  /** With seconds — where two times of one minute must stay apart (conflict copies). */
  seconds?: boolean;
  /** Another time zone than the runtime's (IANA name) — a test that reads what a browser wrote. */
  timeZone?: string;
}

/**
 * The hour cycle of the device's own regional format.
 *
 * `Intl` without a locale resolves to the runtime's default locale — in the
 * desktop's WebView and the phone's WebView that is the operating system's
 * region, not the app language. Its `hourCycle` is what the system clock shows.
 * An environment that reports nothing (or `h11`/`h24`, which no supported region
 * uses for display) maps onto the nearest of the two.
 */
export function deviceHourCycle(): HourCycle {
  try {
    // `hourCycle` is in every engine Plainva runs in, not in the TypeScript lib it targets.
    const cycle = (new Intl.DateTimeFormat(undefined, { hour: "numeric" }).resolvedOptions() as { hourCycle?: string }).hourCycle;
    return cycle === "h12" || cycle === "h11" ? "h12" : "h23";
  } catch {
    return "h23";
  }
}

function cycleOf(options: TimeFormatOptions): HourCycle {
  return options.hourCycle ?? deviceHourCycle();
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(language: string, cycle: HourCycle, withMinutes: boolean, extra: { seconds?: boolean; timeZone?: string } = {}): Intl.DateTimeFormat {
  const key = `${language}|${cycle}|${withMinutes ? "m" : "h"}|${extra.seconds ? "s" : ""}|${extra.timeZone ?? ""}`;
  let made = formatters.get(key);
  if (!made) {
    made = new Intl.DateTimeFormat(language, {
      hour: cycle === "h23" ? "2-digit" : "numeric",
      ...(withMinutes ? { minute: "2-digit" } : {}),
      ...(withMinutes && extra.seconds ? { second: "2-digit" } : {}),
      ...(extra.timeZone ? { timeZone: extra.timeZone } : {}),
      hourCycle: cycle,
    });
    formatters.set(key, made);
  }
  return made;
}

/** A local date at a minute of an arbitrary day: only its clock is read. */
function atMinute(minuteOfDay: number): Date {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minuteOfDay)));
  return new Date(2000, 0, 1, Math.floor(m / 60), m % 60);
}

/**
 * A time of day: "14:05" on a 24-hour device, "2:05 PM" (in the app language's
 * words) on a 12-hour one. Takes a Date, a timestamp, or a minute of the day.
 */
export function formatClockTime(at: Date | number, options: TimeFormatOptions & { minuteOfDay?: boolean }): string {
  const date = typeof at === "number" ? (options.minuteOfDay ? atMinute(at) : new Date(at)) : at;
  // A minute of the day is a clock reading, not an instant: no zone applies.
  const zone = options.minuteOfDay ? undefined : options.timeZone;
  return formatter(options.language, cycleOf(options), true, { seconds: options.seconds, timeZone: zone }).format(date);
}

/** A time of day given as minutes after midnight (the calendar grids' unit). */
export function formatMinuteOfDay(minute: number, options: TimeFormatOptions): string {
  return formatClockTime(minute, { ...options, minuteOfDay: true });
}

/** A start–end range of the same day: "09:00–10:30" or "9:00 AM–10:30 AM". */
export function formatMinuteRange(startMinute: number, endMinute: number, options: TimeFormatOptions): string {
  return `${formatMinuteOfDay(startMinute, options)}–${formatMinuteOfDay(endMinute, options)}`;
}

/**
 * A day and its time of day: the day as `date` asks (the app language's
 * medium date by default — dates are not this module's business yet, package
 * O2 brings them), the clock through `formatClockTime`, so the time reads the
 * same as every other clock time on the screen (finding X4: the mail list
 * said "01:39 PM", the reader's head "1:39 PM").
 */
export function formatDateAndTime(at: Date | number, options: TimeFormatOptions & { date?: Intl.DateTimeFormatOptions }): string {
  const day = typeof at === "number" ? new Date(at) : at;
  const dayOptions = { ...(options.date ?? { dateStyle: "medium" as const }), ...(options.timeZone ? { timeZone: options.timeZone } : {}) };
  return `${new Intl.DateTimeFormat(options.language, dayOptions).format(day)}, ${formatClockTime(day, options)}`;
}

/**
 * The label of an hour line on a time axis: "14:00" on a 24-hour device, the
 * hour alone with its day period ("2 PM") on a 12-hour one — the minutes of an
 * hour line are always zero, and the narrow gutter has no room for them.
 */
export function formatHourMark(hour: number, options: TimeFormatOptions): string {
  const cycle = cycleOf(options);
  if (cycle === "h23") return formatter(options.language, cycle, true).format(atMinute(hour * 60));
  return formatter(options.language, cycle, false).format(atMinute(hour * 60));
}
