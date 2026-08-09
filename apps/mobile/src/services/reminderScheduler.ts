import { App as CapApp } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  parseBaseConfig,
  planReminders,
  resolveTaskCompletionModel,
  taskDbRows,
  type PlannedReminder,
  type ReminderRule,
  type ReminderSubject,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getMobileSettings } from "./mobileSettings";
import { getPimCache } from "./pim/pimService";

/**
 * Mobile reminder scheduler (S10).
 *
 * The phone hands its reminders to the operating system, so they fire with the
 * app closed. That is the whole point — and it is also the limit: the OS can
 * only announce what the phone had already SEEN at its last calendar sync. An
 * invitation that arrives ten minutes before it starts never reaches a
 * notification. That sentence belongs in the settings, not in fine print.
 *
 * Refilled on three occasions, all of them cheap: app start, every finished PIM
 * cycle, and every return to the foreground. Each run replaces the whole window
 * rather than diffing it — the plan is small, and a diff would be a second
 * source of truth about what is currently pending.
 */

const WINDOW_DAYS = 14;

/** Action type ids registered with the OS; the buttons hang off these. */
const ACTION_EVENT = "plainva-event";
const ACTION_TASK = "plainva-task";

/**
 * What a tapped reminder should do, parked until the shell can act on it.
 *
 * A notification can arrive while the app is cold: the OS starts the process,
 * and the vault is not open yet. Parking rather than acting is therefore not a
 * nicety — acting immediately would reach a vault that does not exist.
 */
export interface ReminderIntent {
  kind: "event" | "task";
  uid: string;
  accountId: string;
  calendarId: string;
  startTs: number;
  /** `meeting` opens the meeting note, `done` ticks the task off, `open` is a
   * plain tap on the notification itself. */
  action: "open" | "meeting" | "done";
}

let pendingIntent: ReminderIntent | null = null;

/** Takes the parked intent, if any — reading it clears it. */
export function consumeReminderIntent(): ReminderIntent | null {
  const intent = pendingIntent;
  pendingIntent = null;
  return intent;
}

void LocalNotifications.registerActionTypes({
  types: [
    { id: ACTION_EVENT, actions: [{ id: "meeting", title: i18n.t("reminders.actionMeeting") }] },
    { id: ACTION_TASK, actions: [{ id: "done", title: i18n.t("reminders.actionDone") }] },
  ],
}).catch(() => {});

void LocalNotifications.addListener("localNotificationActionPerformed", (event) => {
  const extra = (event.notification.extra ?? {}) as Partial<ReminderIntent>;
  if (!extra.uid) return;
  const action = event.actionId === "meeting" || event.actionId === "done" ? event.actionId : "open";
  pendingIntent = {
    kind: extra.kind === "task" ? "task" : "event",
    uid: extra.uid,
    accountId: extra.accountId ?? "",
    calendarId: extra.calendarId ?? "",
    startTs: extra.startTs ?? 0,
    action,
  };
  window.dispatchEvent(new CustomEvent("m-reminder-intent"));
}).catch(() => {});

// The scheduler owns its own triggers rather than being called from App.tsx:
// returning to the app is a reminder concern, not an app-shell concern, and the
// shell's lifecycle block is already the longest thing in that file.
void CapApp.addListener("appStateChange", ({ isActive }) => {
  if (isActive) void rescheduleReminders();
}).catch(() => {});



export interface ReminderState {
  /** How many reminders the operating system currently holds for us. */
  scheduled: number;
  /** First moment no longer covered because the platform ceiling was reached. */
  truncatedFrom: number | null;
  dropped: number;
  /** The person declined notification permission — nothing will ever fire. */
  denied: boolean;
}

let state: ReminderState = { scheduled: 0, truncatedFrom: null, dropped: 0, denied: false };
const listeners = new Set<() => void>();
let running = false;
let queued = false;

export function getReminderState(): ReminderState {
  return state;
}

export function subscribeReminderState(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: ReminderState): void {
  state = next;
  for (const l of listeners) l();
}

/** Notification ids are numeric and we replace the whole window each run, so a
 * plain sequence is enough — and cannot collide the way a hashed uid would. */
function notificationId(index: number): number {
  return index + 1;
}

function buildNotification(reminder: PlannedReminder, index: number) {
  const { subject } = reminder;
  const isTask = subject.kind === "task";
  const time = subject.allDay
    ? i18n.t("reminders.allDayBody")
    : new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(subject.startTs));
  return {
    id: notificationId(index),
    title: subject.title || i18n.t("pim.untitledEvent"),
    body: time,
    actionTypeId: isTask ? ACTION_TASK : ACTION_EVENT,
    schedule: {
      at: new Date(reminder.at),
      // Android's Doze mode would otherwise batch the alarm into the next
      // maintenance window — which for a reminder means "some time later",
      // i.e. after the appointment.
      allowWhileIdle: true,
    },
    extra: {
      kind: isTask ? "task" : "event",
      uid: subject.key,
      accountId: subject.accountId,
      calendarId: subject.calendarId,
      startTs: subject.startTs,
    },
  };
}

async function clearPending(): Promise<void> {
  const pending = await LocalNotifications.getPending();
  if (pending.notifications.length > 0) await LocalNotifications.cancel(pending);
}

/**
 * Rebuilds the whole reminder window.
 *
 * Serialised deliberately: the three triggers can arrive within the same
 * second (a foreground switch finishes a PIM cycle), and two runs cancelling
 * each other's notifications half-way is exactly the race that would leave the
 * phone silent.
 */
export async function rescheduleReminders(): Promise<void> {
  if (running) {
    queued = true;
    return;
  }
  running = true;
  try {
    do {
      queued = false;
      await runOnce();
    } while (queued);
  } finally {
    running = false;
  }
}

async function runOnce(): Promise<void> {
  const enabled = getMobileSettings().remindEvents;
  if (!enabled) {
    await clearPending().catch(() => {});
    setState({ scheduled: 0, truncatedFrom: null, dropped: 0, denied: false });
    return;
  }

  const permission = await LocalNotifications.checkPermissions().catch(() => null);
  let granted = permission?.display === "granted";
  if (!granted) {
    // Asked only once the person switched reminders ON — a permission prompt
    // out of nowhere is a prompt nobody can answer meaningfully.
    const asked = await LocalNotifications.requestPermissions().catch(() => null);
    granted = asked?.display === "granted";
  }
  if (!granted) {
    setState({ scheduled: 0, truncatedFrom: null, dropped: 0, denied: true });
    return;
  }

  const settings = getMobileSettings();
  const rule: ReminderRule = {
    defaultLeadMinutes: settings.reminderLeadMinutes,
    allDayLeadDays: settings.reminderAllDayLeadDays,
    allDayAtMinutes: settings.reminderAllDayAtMinutes,
  };
  const now = Date.now();
  const windowEndTs = now + WINDOW_DAYS * 86_400_000;
  const subjects: ReminderSubject[] = [];

  const cache = getPimCache();
  if (cache) {
    // An empty calendar list means ALL: a calendar added later then reminds by
    // default rather than falling silently through a list written before it
    // existed.
    const only = new Set(settings.reminderCalendars);
    for (const e of await cache.listEvents(now, windowEndTs)) {
      if (only.size > 0 && !only.has(`${e.accountId} ${e.calendarId}`)) continue;
      subjects.push({
        key: e.uid,
        kind: "event",
        title: e.title,
        startTs: e.start.ts,
        allDay: e.allDay,
        startDate: e.start.date,
        reminders: e.reminders,
        accountId: e.accountId,
        calendarId: e.calendarId,
      });
    }
  }

  if (settings.remindTasks) subjects.push(...(await dueTaskSubjects(now, windowEndTs)));

  const plan = planReminders(subjects, rule, { now, windowEndTs });
  await clearPending();
  if (plan.reminders.length > 0) {
    await LocalNotifications.schedule({ notifications: plan.reminders.map(buildNotification) });
  }
  setState({
    scheduled: plan.reminders.length,
    truncatedFrom: plan.truncatedFrom ?? null,
    dropped: plan.dropped,
    denied: false,
  });
}

/**
 * Tasks whose due date falls inside the window, as reminder subjects.
 *
 * A task carries no reminder of its own, so the rule always applies — and a due
 * time (S6) makes it behave exactly like a timed appointment. A task already
 * ticked off is not announced: being reminded of something one has finished is
 * the fastest way to stop trusting the reminders.
 */
async function dueTaskSubjects(now: number, windowEndTs: number): Promise<ReminderSubject[]> {
  const db = getMobileSettings().taskDatabase.trim();
  if (!db) return [];
  try {
    const { getMobileVault, vaultOps } = await import("./vaultService");
    const vault = await getMobileVault();
    if (!vault.queryService) return [];
    const config = parseBaseConfig(await vaultOps.read(vault, db));
    const raw = (await vault.queryService.queryDatabaseFiles(config)) as Record<string, unknown>[];
    const rows = taskDbRows(raw, config, resolveTaskCompletionModel(config));
    const out: ReminderSubject[] = [];
    for (const row of rows) {
      if (row.done || !row.due) continue;
      const [y, m, d] = row.due.split("-").map(Number);
      if (!y || !m || !d) continue;
      const startTs = new Date(y, m - 1, d, 0, row.dueMinutes ?? 0).getTime();
      if (startTs > windowEndTs + 86_400_000 || startTs < now - 86_400_000) continue;
      out.push({
        key: row.path,
        kind: "task",
        title: row.title,
        startTs,
        // Without a time the task is a day, and gets the all-day rule.
        allDay: row.dueMinutes === undefined,
        startDate: row.due,
        accountId: "",
        calendarId: "",
      });
    }
    return out;
  } catch {
    // A missing or unreadable task database must not cost the appointments.
    return [];
  }
}
