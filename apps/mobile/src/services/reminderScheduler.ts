import { App as CapApp } from "@capacitor/app";
import { LocalNotifications } from "@capacitor/local-notifications";
import {
  parseBaseConfig,
  planReminders,
  reminderText,
  resolveTaskCompletionModel,
  taskDbDueKey,
  taskDbRows,
  type PlannedReminder,
  type ReminderReason,
  type ReminderRule,
  type ReminderRunState,
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

/**
 * Registers the two action types with the operating system.
 *
 * This used to run at module top level, and that was the whole of the "the
 * button is called reminders.actionDone" finding: `i18n.t` returns the KEY
 * until the language file has loaded, and importing this module happens long
 * before `await i18nReady` in the boot sequence. Android then keeps a
 * registered action type for the life of the process — so the raw key survived
 * until the next cold start, where the same race was decided again, sometimes
 * the other way. That is why it looked intermittent.
 *
 * Called once from the boot sequence AFTER i18n is ready, and again on every
 * language change: someone who switches to English mid-session should not find
 * German buttons on tomorrow's reminder.
 */
async function registerActionTypes(): Promise<void> {
  await LocalNotifications.registerActionTypes({
    types: [
      { id: ACTION_EVENT, actions: [{ id: "meeting", title: i18n.t("reminders.actionMeeting") }] },
      { id: ACTION_TASK, actions: [{ id: "done", title: i18n.t("reminders.actionDone") }] },
    ],
  }).catch(() => {});
}

let initialised = false;

/**
 * Wires the scheduler up: action types, the tap listener, the foreground
 * trigger.
 *
 * Deliberately the only way anything here starts. Importing this module must
 * have no visible effect — `reminderSchedulerInit.test.ts` reads the source and
 * fails if a top-level `void …` call comes back, because that is exactly the
 * shape that produced an untranslated button.
 *
 * Idempotent: a second call is a no-op, so a re-render or a re-entered boot
 * path cannot stack listeners.
 */
export function initReminderScheduler(): void {
  if (initialised) return;
  initialised = true;

  void registerActionTypes();
  i18n.on("languageChanged", () => {
    void registerActionTypes();
  });

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
  // returning to the app is a reminder concern, not an app-shell concern, and
  // the shell's lifecycle block is already the longest thing in that file.
  void CapApp.addListener("appStateChange", ({ isActive }) => {
    if (isActive) void rescheduleReminders();
  }).catch(() => {});
}

export interface ReminderState extends ReminderRunState {
  /** How many reminders the operating system currently holds for us. */
  scheduled: number;
  /** First moment no longer covered because the platform ceiling was reached. */
  truncatedFrom: number | null;
  dropped: number;
  /** The person declined notification permission — nothing will ever fire. */
  denied: boolean;
}

const EMPTY: Omit<ReminderState, "reason"> = {
  scheduled: 0,
  events: 0,
  tasks: 0,
  lastRunTs: null,
  truncatedFrom: null,
  dropped: 0,
  denied: false,
};

let state: ReminderState = { ...EMPTY, reason: "off" };
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
  // The body used to be the bare time, which told you WHEN without ever telling
  // you WHAT — and with the platform's default icon on top of that, a task and
  // an appointment arrived indistinguishable on the lock screen.
  const text = reminderText(
    subject,
    {
      kindEvent: i18n.t("reminders.kindEvent"),
      kindTask: i18n.t("reminders.kindTask"),
      allDay: i18n.t("reminders.allDayBody"),
      untitled: i18n.t("pim.untitledEvent"),
      dueToday: i18n.t("pim.dueToday"),
      dueOn: (date) => i18n.t("pim.dueOn", { date }),
    },
    { locale: i18n.language, now: Date.now() }
  );
  return {
    id: notificationId(index),
    title: text.title,
    body: text.body,
    // Android draws the small icon as a silhouette, so the plugin's default
    // (`ic_dialog_info`) turned every reminder into the same generic (i).
    // Two glyphs of our own, tinted with the brand colour.
    smallIcon: isTask ? "ic_stat_task" : "ic_stat_event",
    iconColor: "#0F766E",
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
  const settings = getMobileSettings();
  // Two switches, two answers (plan Mobile-Feedback, P1/4). This used to read
  // `remindEvents` alone, which quietly made task reminders a SUB-setting of
  // appointment reminders: switching appointments off switched tasks off too,
  // and nothing anywhere said so. Either one on is reason enough to plan.
  if (!settings.remindEvents && !settings.remindTasks) {
    await clearPending().catch(() => {});
    setState({ ...EMPTY, reason: "off" });
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
    setState({ ...EMPTY, denied: true, reason: "denied" });
    return;
  }

  const rule: ReminderRule = {
    defaultLeadMinutes: settings.reminderLeadMinutes,
    allDayLeadDays: settings.reminderAllDayLeadDays,
    allDayAtMinutes: settings.reminderAllDayAtMinutes,
    taskLeadDays: settings.reminderTaskLeadDays,
    taskAtMinutes: settings.reminderTaskAtMinutes,
  };
  const now = Date.now();
  const windowEndTs = now + WINDOW_DAYS * 86_400_000;
  const subjects: ReminderSubject[] = [];

  const cache = getPimCache();
  if (settings.remindEvents && cache) {
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

  let taskReason: ReminderReason;
  if (settings.remindTasks) {
    const tasks = await dueTaskSubjects(now, windowEndTs);
    taskReason = tasks.reason;
    subjects.push(...tasks.subjects);
  } else {
    taskReason = "tasksOff";
  }

  const plan = planReminders(subjects, rule, { now, windowEndTs });
  await clearPending();
  if (plan.reminders.length > 0) {
    await LocalNotifications.schedule({ notifications: plan.reminders.map(buildNotification) });
  }
  const tasksPlanned = plan.reminders.filter((r) => r.subject.kind === "task").length;
  setState({
    scheduled: plan.reminders.length,
    events: plan.reminders.length - tasksPlanned,
    tasks: tasksPlanned,
    lastRunTs: now,
    truncatedFrom: plan.truncatedFrom ?? null,
    dropped: plan.dropped,
    denied: false,
    // A blocked task source is worth saying even when appointments planned
    // fine: "12 planned" would otherwise read as "everything is working".
    reason: taskReason,
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
async function dueTaskSubjects(
  now: number,
  windowEndTs: number
): Promise<{ subjects: ReminderSubject[]; reason: ReminderReason }> {
  const db = getMobileSettings().taskDatabase.trim();
  // DECISION, not a gap (feedback round 2026-09-01, E3): only the task
  // DATABASE feeds reminders - a checkbox task in a note has no typed due
  // value to plan from. Same rule as the desktop scheduler.
  //
  // The commonest silence: the task database is a per-vault setting that
  // reaches the phone through the settings sync, so a sync that is off or
  // failing leaves this empty and every task reminder simply never happens.
  if (!db) return { subjects: [], reason: "noTaskDb" };
  try {
    const { getMobileVault, vaultOps } = await import("./vaultService");
    const vault = await getMobileVault();
    if (!vault.queryService) return { subjects: [], reason: "taskDbUnreadable" };
    const config = parseBaseConfig(await vaultOps.read(vault, db));
    const raw = (await vault.queryService.queryDatabaseFiles(config)) as Record<string, unknown>[];
    const rows = taskDbRows(raw, config, resolveTaskCompletionModel(config));
    // Asked of the SCHEMA, not of the rows: `taskDbRows` has already turned an
    // unparseable due value into null, so counting failures among the rows
    // would find nothing. A database whose due column is not typed as a date
    // has no due key at all — and every task in it is silently undateable.
    const hasDueColumn = taskDbDueKey(config) !== null;
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
        // Without a time the task is a day, and gets the TASK day rule (E1)
        // — not the all-day appointment rule it used to borrow.
        allDay: row.dueMinutes === undefined,
        startDate: row.due,
        accountId: "",
        calendarId: "",
      });
    }
    return { subjects: out, reason: hasDueColumn ? "ok" : "taskDueNotDate" };
  } catch {
    // A missing or unreadable task database must not cost the appointments —
    // but it must not pass unmentioned either, which is what it used to do.
    return { subjects: [], reason: "taskDbUnreadable" };
  }
}
