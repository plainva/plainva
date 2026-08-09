import { App as CapApp } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import { planReminders, type PlannedReminder, type ReminderRule, type ReminderSubject } from "@plainva/ui";
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

// The scheduler owns its own triggers rather than being called from App.tsx:
// returning to the app is a reminder concern, not an app-shell concern, and the
// shell's lifecycle block is already the longest thing in that file.
void CapApp.addListener("appStateChange", ({ isActive }) => {
  if (isActive) void rescheduleReminders();
}).catch(() => {});

/** Defaults until S11 makes them configurable. */
const RULE: ReminderRule = { defaultLeadMinutes: 15, allDayLeadDays: 1, allDayAtMinutes: 19 * 60 };

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
  const time = subject.allDay
    ? i18n.t("reminders.allDayBody")
    : new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(subject.startTs));
  return {
    id: notificationId(index),
    title: subject.title || i18n.t("pim.untitledEvent"),
    body: time,
    schedule: {
      at: new Date(reminder.at),
      // Android's Doze mode would otherwise batch the alarm into the next
      // maintenance window — which for a reminder means "some time later",
      // i.e. after the appointment.
      allowWhileIdle: true,
    },
    extra: { uid: subject.key, accountId: subject.accountId, calendarId: subject.calendarId, startTs: subject.startTs },
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

  const cache = getPimCache();
  if (!cache) return;

  const now = Date.now();
  const windowEndTs = now + WINDOW_DAYS * 86_400_000;
  const rows = await cache.listEvents(now, windowEndTs);
  const subjects: ReminderSubject[] = rows.map((e) => ({
    key: e.uid,
    title: e.title,
    startTs: e.start.ts,
    allDay: e.allDay,
    startDate: e.start.date,
    reminders: e.reminders,
    accountId: e.accountId,
    calendarId: e.calendarId,
  }));

  const plan = planReminders(subjects, RULE, { now, windowEndTs });
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
