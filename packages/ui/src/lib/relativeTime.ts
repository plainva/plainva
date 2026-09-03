/**
 * "2 hours ago", "yesterday", "3 Sep" - the time a card shows next to a name (K3).
 *
 * Built on `Intl.RelativeTimeFormat`, so it speaks every app language without
 * a string of its own. Near times are relative because that is how people
 * think of a conversation ("she answered an hour ago"); after a week the
 * relative phrase stops helping and the date takes over. The full timestamp
 * stays reachable as the element's tooltip - this is a label, not the record.
 */
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function relativeFormatter(locale: string): Intl.RelativeTimeFormat {
  try {
    return new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  } catch {
    return new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  }
}

function dateFormatter(locale: string, withYear: boolean): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = withYear ? { day: "numeric", month: "short", year: "numeric" } : { day: "numeric", month: "short" };
  try {
    return new Intl.DateTimeFormat(locale, options);
  } catch {
    return new Intl.DateTimeFormat("en", options);
  }
}

export function relativeTimeLabel(iso: string, locale: string, now: number = Date.now()): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  const diff = time - now;
  const abs = Math.abs(diff);
  const rtf = relativeFormatter(locale);
  if (abs < MINUTE) return rtf.format(0, "second");
  if (abs < HOUR) return rtf.format(Math.round(diff / MINUTE), "minute");
  if (abs < DAY) return rtf.format(Math.round(diff / HOUR), "hour");
  if (abs < 7 * DAY) return rtf.format(Math.round(diff / DAY), "day");
  const then = new Date(time);
  return dateFormatter(locale, then.getFullYear() !== new Date(now).getFullYear()).format(then);
}

/** The full timestamp, for the tooltip behind the relative label. */
export function absoluteTimeLabel(iso: string, locale: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(time);
  } catch {
    return new Date(time).toLocaleString();
  }
}
