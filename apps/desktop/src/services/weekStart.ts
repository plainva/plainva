import type { WeekStartDay } from "@plainva/ui";
import { getSettingsStore } from "./settingsStore";

/**
 * Global (app-wide) first-day-of-week preference for every calendar surface
 * (calendar tab month/week grids + the sidebar calendar widget). The three
 * standard conventions: Monday (default, ISO/Europe), Saturday (parts of the
 * Middle East), Sunday (US et al.). Stored in the settings store; consumers
 * load it async and listen for the change event.
 */

const STORE_KEY = "calendarWeekStart";
export const WEEK_START_CHANGED_EVENT = "plainva-weekstart-changed";

export type WeekStartSetting = "monday" | "saturday" | "sunday";

const TO_DAY: Record<WeekStartSetting, WeekStartDay> = { monday: 1, saturday: 6, sunday: 0 };

export function weekStartDayOf(setting: WeekStartSetting): WeekStartDay {
  return TO_DAY[setting] ?? 1;
}

export async function getWeekStartSetting(): Promise<WeekStartSetting> {
  try {
    const store = await getSettingsStore();
    const v = await store.get<string>(STORE_KEY);
    return v === "saturday" || v === "sunday" ? v : "monday";
  } catch {
    return "monday";
  }
}

export async function setWeekStartSetting(value: WeekStartSetting): Promise<void> {
  const store = await getSettingsStore();
  await store.set(STORE_KEY, value);
  await store.save();
  window.dispatchEvent(new CustomEvent(WEEK_START_CHANGED_EVENT));
}
