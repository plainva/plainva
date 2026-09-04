import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import type {
  DeviceCollection, DeviceEventDraft, DeviceEventHandle, DeviceEventRecord, DevicePimPort, DeviceReminderDraft, DeviceReminderRecord,
} from "@plainva/core";

/**
 * The device's calendars and reminders, through one native plugin on both
 * platforms (plan EventKit K2/K3): EventKit on iOS, the CalendarContract
 * provider on Android. The JSON shapes are the core's `DevicePimPort` records
 * one to one, so this file is a binding and nothing else — the mapping to the
 * PIM contract lives in `DevicePimTarget`, where a fake port can test it.
 *
 * What the plugin reports instead of failing on: the permission state (four
 * values, "writeOnly" is iOS 17's half-grant that cannot show a calendar), a
 * platform without a reminder store (Android answers `unsupported`), and a
 * record that is already gone on delete (a success).
 */
export type DevicePimAuthorization = "notDetermined" | "denied" | "restricted" | "fullAccess" | "writeOnly" | "unsupported";

export interface DevicePimStatus {
  events: DevicePimAuthorization;
  reminders: DevicePimAuthorization;
}

export interface DevicePimNative {
  authorizationStatus(): Promise<DevicePimStatus>;
  requestAccess(opts: { events: boolean; reminders: boolean }): Promise<DevicePimStatus>;
  /** Opens the app's page in the system settings — the only way back from "denied". */
  openSettings(): Promise<void>;
  listCollections(): Promise<{ collections: DeviceCollection[] }>;
  events(opts: { calendarId: string; fromTs: number; toTs: number }): Promise<{ events: DeviceEventRecord[] }>;
  event(opts: DeviceEventHandle): Promise<{ event: DeviceEventRecord | null }>;
  createEvent(opts: { calendarId: string; draft: DeviceEventDraft }): Promise<{ event: DeviceEventRecord }>;
  updateEvent(opts: { handle: DeviceEventHandle; draft: DeviceEventDraft }): Promise<{ event: DeviceEventRecord }>;
  deleteEvent(opts: DeviceEventHandle): Promise<void>;
  reminders(opts: { listId: string }): Promise<{ reminders: DeviceReminderRecord[] }>;
  reminder(opts: { id: string }): Promise<{ reminder: DeviceReminderRecord | null }>;
  createReminder(opts: { listId: string; draft: DeviceReminderDraft }): Promise<{ reminder: DeviceReminderRecord }>;
  updateReminder(opts: { id: string; draft: DeviceReminderDraft }): Promise<{ reminder: DeviceReminderRecord }>;
  deleteReminder(opts: { id: string }): Promise<void>;
  addListener(event: "changed", fn: () => void): Promise<PluginListenerHandle>;
}

const DevicePim = registerPlugin<DevicePimNative>("DevicePim");

/** The device account exists only on the native shells; the browser has no calendar store. */
export function isDevicePimSupported(): boolean {
  return Capacitor.isNativePlatform();
}

/** iOS has reminders; Android has no system task store (plan E2). */
export function devicePimHasReminders(): boolean {
  return Capacitor.getPlatform() === "ios";
}

export function devicePimAuthorization(): Promise<DevicePimStatus> {
  return DevicePim.authorizationStatus();
}

/**
 * Asks for FULL access to events, and to reminders where the platform has
 * them (plan E6): writing is part of the account, and write-only cannot read
 * the calendar. Asked only when the account is created, never at app start.
 */
export function requestDevicePimAccess(): Promise<DevicePimStatus> {
  return DevicePim.requestAccess({ events: true, reminders: devicePimHasReminders() });
}

export function openDevicePimSettings(): Promise<void> {
  return DevicePim.openSettings();
}

/** "Something changed" from the platform — the worker runs a cycle on it. */
export function onDevicePimChanged(fn: () => void): () => void {
  const handle = DevicePim.addListener("changed", fn);
  return () => {
    void handle.then((h) => h.remove());
  };
}

/** The port the core's `DevicePimTarget` speaks to. */
export function devicePimPort(): DevicePimPort {
  return {
    supportsReminders: devicePimHasReminders(),
    listCollections: async () => (await DevicePim.listCollections()).collections,
    events: async (calendarId, fromTs, toTs) => (await DevicePim.events({ calendarId, fromTs, toTs })).events,
    event: async (handle) => (await DevicePim.event(handle)).event,
    createEvent: async (calendarId, draft) => (await DevicePim.createEvent({ calendarId, draft })).event,
    updateEvent: async (handle, draft) => (await DevicePim.updateEvent({ handle, draft })).event,
    deleteEvent: (handle) => DevicePim.deleteEvent(handle),
    reminders: async (listId) => (await DevicePim.reminders({ listId })).reminders,
    reminder: async (id) => (await DevicePim.reminder({ id })).reminder,
    createReminder: async (listId, draft) => (await DevicePim.createReminder({ listId, draft })).reminder,
    updateReminder: async (id, draft) => (await DevicePim.updateReminder({ id, draft })).reminder,
    deleteReminder: (id) => DevicePim.deleteReminder({ id }),
  };
}
