import type { WeekStartDay } from "../lib/calendarGrid";
import { getPlatformServices } from "../platform/services";

/**
 * The first day of the week, for every calendar surface (calendar tab month/week
 * grids, the sidebar calendar widget, the date pickers) and for templates
 * (`{{weekday:…}}`). The three standard conventions: Monday (default,
 * ISO/Europe), Saturday (parts of the Middle East), Sunday (US et al.).
 * Consumers load it async and listen for the change event.
 *
 * Shared since S26: the phone's calendar grids need the same answer.
 *
 * It travels with the vault (decision E4 of the bug-clearing plan, Sammelplan
 * § 3.46/§ 3.97): it was a setting of each device, and a template with
 * `{{weekday:monday}}` gave one vault two different dates on two devices. The
 * vault's value is kept where each shell keeps a vault's settings (profile
 * field `weekStart`) and reaches this module through the scope the shell
 * registers for the vault it shows (`setVaultWeekStartScope`). A vault that
 * has not said yet - every vault before this change - follows the device's
 * own choice, which is kept as before; choosing a week start writes both, so a
 * vault opened later starts from the last choice too.
 */

const STORE_KEY = "calendarWeekStart";
export const WEEK_START_CHANGED_EVENT = "plainva-weekstart-changed";

export type WeekStartSetting = "monday" | "saturday" | "sunday";

const TO_DAY: Record<WeekStartSetting, WeekStartDay> = { monday: 1, saturday: 6, sunday: 0 };

export function weekStartDayOf(setting: WeekStartSetting): WeekStartDay {
  return TO_DAY[setting] ?? 1;
}

const isSetting = (v: unknown): v is WeekStartSetting => v === "monday" || v === "saturday" || v === "sunday";

/** Where the vault a window shows keeps its week start; registered by the shell. */
export interface VaultWeekStartScope {
  /** The vault's value: a setting, or anything else (absent, "") for "not said". */
  read(): Promise<unknown>;
  write(value: WeekStartSetting): Promise<void>;
}

let vaultScope: VaultWeekStartScope | null = null;

/**
 * The shell names the vault whose week start applies - the one the window
 * shows -, or none. Everything that asks reads again.
 */
export function setVaultWeekStartScope(scope: VaultWeekStartScope | null): void {
  vaultScope = scope;
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WEEK_START_CHANGED_EVENT));
}

async function deviceWeekStart(): Promise<WeekStartSetting> {
  try {
    const store = await getPlatformServices().loadSettings();
    const v = await store.get<string>(STORE_KEY);
    return isSetting(v) ? v : "monday";
  } catch {
    return "monday";
  }
}

export async function getWeekStartSetting(): Promise<WeekStartSetting> {
  const scope = vaultScope;
  if (scope) {
    const own = await scope.read().catch(() => null);
    if (isSetting(own)) return own;
  }
  return deviceWeekStart();
}

export async function setWeekStartSetting(value: WeekStartSetting): Promise<void> {
  const store = await getPlatformServices().loadSettings();
  await store.set(STORE_KEY, value);
  await store.save();
  await vaultScope?.write(value);
  window.dispatchEvent(new CustomEvent(WEEK_START_CHANGED_EVENT));
}
