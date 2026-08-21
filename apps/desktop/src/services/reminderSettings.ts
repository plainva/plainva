import type { ISettingsStore } from "@plainva/ui";
import type { ReminderRule } from "@plainva/ui";

/**
 * Desktop reminder settings (S11b).
 *
 * The same settings the phone carries (S11), read here through the desktop's
 * per-vault store keys — and, today, ONLY here: none of them travel through the
 * settings profile (no reminder key appears in the profile field list). This
 * comment used to claim that five of the six did; they never have.
 *
 * Whether the rule SHOULD travel is a real question with a real counter-argument
 * on one side: the calendar filter must stay device-local, because it names
 * calendars and signing in happens per device — a filter carried to a device
 * where those accounts are not signed in would match nothing, and "matches
 * nothing" means silence, the one outcome this whole area exists to prevent.
 * That decision is deliberately not part of the mobile-feedback plan
 * (Sammelplan candidate); what this file owes today is an honest description.
 */

const b64 = (p: string) => btoa(unescape(encodeURIComponent(p)));

export const remindEventsKey = (v: string) => `remindEvents_${b64(v)}`;
export const reminderLeadKey = (v: string) => `reminderLeadMinutes_${b64(v)}`;
export const reminderAllDayLeadKey = (v: string) => `reminderAllDayLeadDays_${b64(v)}`;
export const reminderAllDayAtKey = (v: string) => `reminderAllDayAtMinutes_${b64(v)}`;
export const remindTasksKey = (v: string) => `remindTasks_${b64(v)}`;
export const reminderTaskLeadKey = (v: string) => `reminderTaskLeadDays_${b64(v)}`;
export const reminderTaskAtKey = (v: string) => `reminderTaskAtMinutes_${b64(v)}`;
export const reminderCalendarsKey = (v: string) => `reminderCalendars_${b64(v)}`;

export interface ReminderSettings {
  enabled: boolean;
  rule: ReminderRule;
  tasks: boolean;
  /** `accountId + " " + calendarId`; EMPTY means all — so a calendar connected
   * later reminds by default rather than falling through a list written before
   * it existed. */
  calendars: string[];
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  enabled: false,
  rule: {
    defaultLeadMinutes: 15,
    allDayLeadDays: 1,
    allDayAtMinutes: 19 * 60,
    // A task is due ON its day, so the default announces it that morning
    // rather than the evening before (E1).
    taskLeadDays: 0,
    taskAtMinutes: 9 * 60,
  },
  tasks: false,
  calendars: [],
};

function num(value: unknown, fallback: number, min: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min ? Math.floor(value) : fallback;
}

export async function loadReminderSettings(store: ISettingsStore, vaultPath: string): Promise<ReminderSettings> {
  const d = DEFAULT_REMINDER_SETTINGS;
  const calendars = await store.get<unknown>(reminderCalendarsKey(vaultPath));
  return {
    enabled: (await store.get<boolean>(remindEventsKey(vaultPath))) ?? d.enabled,
    rule: {
      defaultLeadMinutes: num(await store.get(reminderLeadKey(vaultPath)), d.rule.defaultLeadMinutes, 0),
      allDayLeadDays: num(await store.get(reminderAllDayLeadKey(vaultPath)), d.rule.allDayLeadDays, 0),
      allDayAtMinutes: num(await store.get(reminderAllDayAtKey(vaultPath)), d.rule.allDayAtMinutes, 0),
      taskLeadDays: num(await store.get(reminderTaskLeadKey(vaultPath)), d.rule.taskLeadDays, 0),
      taskAtMinutes: num(await store.get(reminderTaskAtKey(vaultPath)), d.rule.taskAtMinutes, 0),
    },
    tasks: (await store.get<boolean>(remindTasksKey(vaultPath))) ?? d.tasks,
    calendars: Array.isArray(calendars) ? calendars.filter((c): c is string => typeof c === "string") : d.calendars,
  };
}
