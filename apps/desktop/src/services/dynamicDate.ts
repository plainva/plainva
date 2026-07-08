/**
 * Dynamic date tokens (#4, like Notion's @today). The note stores a fixed plain
 * token `@YYYY-MM-DD`; the editor/read view render it RELATIVE to "now":
 * Heute/Gestern/Morgen/Übermorgen/Vorgestern while a word exists (±2 days), then
 * the localized full date. The stored value never changes (Obsidian shows the raw
 * `@2026-06-30` — harmless), only the display adapts as time passes.
 */

/** Matches an `@YYYY-MM-DD` date token. The global flag is reset by callers. */
export const DATE_TOKEN_RE = /@(\d{4})-(\d{2})-(\d{2})(?![\d-])/g;

function capitalize(s: string): string {
  return s.length ? s[0].toLocaleUpperCase() + s.slice(1) : s;
}

/**
 * Relative, localized display for an ISO date string, computed against `now`.
 * ±2 days -> a word (heute/morgen/…); otherwise the full localized date.
 */
export function formatRelativeDate(iso: string, now: Date, locale = "de"): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (isNaN(d.getTime())) return iso;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (Math.abs(diff) <= 2) {
    try {
      return capitalize(new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(diff, "day"));
    } catch {
      /* fall through to absolute date */
    }
  }
  try {
    return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  } catch {
    return iso;
  }
}
