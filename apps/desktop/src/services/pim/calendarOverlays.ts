import { getSettingsStore } from "../settingsStore";
import { calendarOverlaysKey } from "../settingsProfile";

/**
 * Which database views the calendar shows (S18, plan P9a).
 *
 * A VAULT setting, not a device preference — the settings profile carries it,
 * so a calendar looks the same on the desktop and on the phone. Storing it
 * per device would quietly hand the two machines different calendars, which is
 * exactly what the step set out to avoid.
 *
 * The value is a list of `path#view` keys. A stored key whose database or view
 * is gone simply matches nothing; it is not pruned on read, because a database
 * that is momentarily unreadable must not silently drop out of the selection.
 */
export async function loadCalendarOverlays(vaultPath: string): Promise<string[]> {
  try {
    const store = await getSettingsStore();
    const raw = await store.get<unknown>(calendarOverlaysKey(vaultPath));
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export async function saveCalendarOverlays(vaultPath: string, keys: readonly string[]): Promise<void> {
  const store = await getSettingsStore();
  await store.set(calendarOverlaysKey(vaultPath), [...keys]);
  await store.save();
}
