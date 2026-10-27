/**
 * A calendar's own colour, chosen on the calendar page of its account (plan
 * "Verbinden", V3). The provider's colour stays the default; an own colour
 * only paints this vault's views and is never written back to the provider,
 * whose colour a sync would otherwise rewrite on every cycle.
 *
 * Keyed like the views already key a calendar: "<accountId> <calendarId>".
 */
export type CalendarColorOverrides = Record<string, string>;

/** Fired when a calendar's own colour changes, so open views repaint. */
export const CALENDAR_COLORS_EVENT = "plainva-calendar-colors-changed";

export function calendarColorKey(accountId: string, calendarId: string): string {
  return `${accountId} ${calendarId}`;
}

/** The colour a view paints a calendar in: its own colour, else the provider's. */
export function calendarColor(calendar: { accountId: string; id: string; color?: string | null }, overrides: CalendarColorOverrides | null | undefined): string {
  return overrides?.[calendarColorKey(calendar.accountId, calendar.id)] || calendar.color || "";
}

/** The overrides with one calendar's own colour set, or removed ("" = the provider's colour). */
export function withCalendarColor(overrides: CalendarColorOverrides | null | undefined, accountId: string, calendarId: string, color: string): CalendarColorOverrides {
  const next = { ...(overrides ?? {}) };
  const key = calendarColorKey(accountId, calendarId);
  if (color) next[key] = color;
  else delete next[key];
  return next;
}

/** Reads a stored map defensively: anything that is not a string-to-string map is no override. */
export function readCalendarColorOverrides(value: unknown): CalendarColorOverrides {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: CalendarColorOverrides = {};
  for (const [key, color] of Object.entries(value as Record<string, unknown>)) {
    if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) out[key] = color;
  }
  return out;
}
