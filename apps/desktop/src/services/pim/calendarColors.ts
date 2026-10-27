import { CALENDAR_COLORS_EVENT, readCalendarColorOverrides, withCalendarColor, type CalendarColorOverrides } from "@plainva/ui";
import { getSettingsStore } from "../settingsStore";

/** Per-vault store key of the calendars' own colours (plan "Verbinden", V3). */
export const calendarColorsKey = (vaultPath: string) =>
  `calendarColors_${btoa(unescape(encodeURIComponent(vaultPath)))}`;

export async function loadCalendarColors(vaultPath: string): Promise<CalendarColorOverrides> {
  return readCalendarColorOverrides(await (await getSettingsStore()).get<unknown>(calendarColorsKey(vaultPath)).catch(() => null));
}

/** Sets ("" removes) one calendar's own colour and tells the open views. */
export async function saveCalendarColor(vaultPath: string, accountId: string, calendarId: string, color: string): Promise<CalendarColorOverrides> {
  const store = await getSettingsStore();
  const next = withCalendarColor(await loadCalendarColors(vaultPath), accountId, calendarId, color);
  await store.set(calendarColorsKey(vaultPath), next);
  await store.save();
  window.dispatchEvent(new CustomEvent(CALENDAR_COLORS_EVENT, { detail: { vaultPath } }));
  return next;
}
