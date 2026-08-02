import i18n from "@plainva/ui/i18n";

/**
 * "2 hours ago" for a timestamp, in the app language. Takes `now` as an
 * argument rather than reading the clock, so callers stay pure: the value is
 * computed in an effect and rendered from state (the React compiler rejects a
 * render that reads the clock, and the screenshot baseline needs a fixed one).
 */
export function relTimeAt(now: number, ts?: number): string | null {
  if (!ts) return null;
  const rtf = new Intl.RelativeTimeFormat(i18n.language, { numeric: "auto" });
  const mins = Math.round((ts - now) / 60000);
  if (mins > -60) return rtf.format(mins, "minute");
  const hours = Math.round(mins / 60);
  if (hours > -24) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
}
