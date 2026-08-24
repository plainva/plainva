import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import {
  planReminders,
  reminderText,
  toast,
  type PlannedReminder,
  type ReminderReason,
  type ReminderRunState,
  type ReminderSubject,
} from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import type { PimCacheRepository } from "@plainva/core";
import { getSettingsStore } from "./settingsStore";
import { loadReminderSettings } from "./reminderSettings";
import { loadTaskOverlay, type DueTaskDeps } from "./pim/taskOverlay";
import { getTaskDatabasePath } from "./taskDatabase";

/**
 * Desktop reminders (S11b).
 *
 * A different mechanism from the phone, and the difference is structural. The
 * notification plugin's DESKTOP backend builds its notification from title,
 * body, icon and sound — and never reads `schedule` (verified in
 * `tauri-plugin-notification` 2.3.3, `src/desktop.rs::show()`; the field exists
 * in the model but only the mobile path consumes it). Handing it a scheduled
 * notification therefore shows it AT ONCE, with no error and no warning. There
 * are no `pending`/`cancel` commands on the desktop either.
 *
 * So Plainva does the waking itself: it holds the plan, arms a timer per
 * reminder that is about to come due, and calls the plugin at that moment with
 * no schedule at all. The price is stated rather than hidden — **the app has to
 * be running**, and the setting says so.
 *
 * Two levels, like the backup scheduler: a cheap planning tick that recomputes
 * the window, and short-lived timers that fire precisely. Re-planning never
 * fires the same reminder twice, and a reminder whose moment passed while the
 * app was closed is simply gone — being told about a meeting that started an
 * hour ago is noise, not a reminder.
 */

const WINDOW_DAYS = 14;
const INITIAL_DELAY_MS = 20_000; // let the vault settle first, like the backup scheduler
const PLAN_INTERVAL_MS = 5 * 60_000;
/** Timers are armed for this horizon: one planning interval plus slack, so a
 * reminder due right after a tick is still armed by the tick before it. */
const ARM_HORIZON_MS = PLAN_INTERVAL_MS + 60_000;

export interface ReminderSchedulerDeps {
  vaultPath: string;
  cache: PimCacheRepository | null;
  vaultAdapter: DueTaskDeps["vaultAdapter"];
  queryService: DueTaskDeps["queryService"] | null;
  /** Brings a note to the front (the toast action). */
  openNote: (path: string) => void;
  /** Opens the calendar at a day (the toast action for an appointment). */
  openCalendar: (day: string) => void;
  /** The next upcoming appointment, as one line — the tray menu shows it
   * (S11c). Called on every plan, so it also reports "nothing in sight". */
  /** The tray line plus WHEN it is, so several vaults can be merged (stage D). */
  onNextChanged?: (text: string, at: number | null) => void;
}

/** Identity of one planned reminder — the appointment AND the moment, so two
 * lead times on the same appointment stay two reminders. */
function reminderKey(r: PlannedReminder): string {
  return `${r.subject.key}|${r.at}`;
}

function localDay(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Announces one reminder: the operating system notification, plus the same
 * thing inside the app carrying the action.
 *
 * The desktop plugin reports no clicks and offers no buttons (its Rust side
 * registers exactly `is_permission_granted`, `request_permission` and
 * `notify`), so the action cannot live on the notification. It lives in the
 * toast instead — which is honest here, because the app is running by
 * definition. What it must NOT do is steal focus: a window that jumps to the
 * front mid-sentence is worse than a missed meeting note.
 */
export function announceReminder(reminder: PlannedReminder, deps: ReminderSchedulerDeps): void {
  const { subject } = reminder;
  // Shared with the phone so both shells say the same sentence — the kind first,
  // then the moment. The desktop had the same gap: a bare time told you WHEN
  // without ever telling you WHAT (plan Mobile-Feedback, P1).
  const { title, body } = reminderText(
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

  try {
    // No `schedule` — see the note at the top of this file. This call fires now.
    sendNotification({ title, body });
  } catch (e) {
    console.warn("[reminderScheduler] notification failed", e);
  }

  const action =
    subject.kind === "task"
      ? { label: i18n.t("reminders.actionOpenTask"), run: () => deps.openNote(subject.key) }
      : { label: i18n.t("reminders.actionOpenCalendar"), run: () => deps.openCalendar(localDay(subject.startTs)) };
  toast.info(`${title} · ${body}`, action);
}

/**
 * Starts the per-vault reminder loop. Returns a disposer.
 *
 * Settings are re-read on every tick, so switching reminders on takes effect
 * without a restart — the same contract the backup scheduler set.
 */
/**
 * What the last planning run produced (plan Mobile-Feedback, P1/5).
 *
 * The desktop had no such thing: reminders were planned in a closure and the
 * settings page could only show the switches. So a person whose task reminders
 * never arrived had nothing to look at — the same silence the phone had, one
 * screen further along. A tiny external store rather than context: only the
 * reminder settings card subscribes, and it must not re-render the app on
 * every five-minute tick.
 */
const reminderListeners = new Set<() => void>();
let reminderState: ReminderRunState = {
  events: 0,
  tasks: 0,
  lastRunTs: null,
  reason: "off",
};

function setReminderState(next: ReminderRunState): void {
  reminderState = next;
  for (const l of reminderListeners) l();
}

export const reminderStateStore = {
  get: (): ReminderRunState => reminderState,
  subscribe(listener: () => void): () => void {
    reminderListeners.add(listener);
    return () => {
      reminderListeners.delete(listener);
    };
  },
};

export function startReminderScheduler(deps: ReminderSchedulerDeps): () => void {
  let stopped = false;
  const armed = new Map<string, ReturnType<typeof setTimeout>>();
  const fired = new Set<string>();
  const timeouts: ReturnType<typeof setTimeout>[] = [];
  const intervals: ReturnType<typeof setInterval>[] = [];
  let asked = false;

  const disarm = () => {
    for (const timer of armed.values()) clearTimeout(timer);
    armed.clear();
  };

  const plan = async () => {
    if (stopped) return;
    try {
      const store = await getSettingsStore();
      const settings = await loadReminderSettings(store, deps.vaultPath);
      // Two switches, two answers (plan Mobile-Feedback, P1/4). Reading
      // `enabled` alone made task reminders a SUB-setting of appointment
      // reminders — switching appointments off switched tasks off too, with
      // nothing anywhere saying so. Either one on is reason enough to plan.
      if (!settings.enabled && !settings.tasks) {
        disarm();
        setReminderState({ events: 0, tasks: 0, lastRunTs: null, reason: "off" });
        return;
      }


      if (!(await isPermissionGranted())) {
        // Asked only once per session, and only after reminders were switched
        // on — a permission prompt out of nowhere is one nobody can answer.
        setReminderState({ events: 0, tasks: 0, lastRunTs: null, reason: "denied" });
        if (asked) return;
        asked = true;
        if ((await requestPermission()) !== "granted") return;
      }

      const now = Date.now();
      const windowEndTs = now + WINDOW_DAYS * 86_400_000;
      const collected = await collectSubjects(deps, settings, now, windowEndTs);
      const subjects = collected.subjects;
      deps.onNextChanged?.(nextLine(subjects, now), nextStart(subjects, now));
      const result = planReminders(subjects, settings.rule, { now, windowEndTs });
      const tasksPlanned = result.reminders.filter((r) => r.subject.kind === "task").length;
      setReminderState({
        events: result.reminders.length - tasksPlanned,
        tasks: tasksPlanned,
        lastRunTs: now,
        // A blocked task source is worth saying even when appointments planned
        // fine: "12 planned" would otherwise read as "everything is working".
        reason: collected.reason,
      });

      // An armed timer is a COMMITMENT and is never taken back by a later
      // plan. Clearing and rebuilding looked tidier and lost reminders: the
      // planner drops everything at or before `now`, so a re-plan landing on a
      // reminder's own minute — which the five-minute tick does regularly —
      // disarmed it and then found nothing to re-arm. The cost of the other
      // direction is one stale reminder for an appointment deleted inside the
      // six-minute arming horizon; being told about a meeting that was called
      // off is a smaller failure than not being told about one that wasn't.
      for (const reminder of result.reminders) {
        const key = reminderKey(reminder);
        if (fired.has(key) || armed.has(key)) continue;
        const delay = reminder.at - Date.now();
        if (delay > ARM_HORIZON_MS) break; // sorted by time — everything after is further out
        armed.set(
          key,
          setTimeout(
            () => {
              armed.delete(key);
              if (stopped) return;
              fired.add(key);
              announceReminder(reminder, deps);
            },
            Math.max(0, delay)
          )
        );
      }
    } catch (e) {
      console.warn("[reminderScheduler] planning failed", e);
    }
  };

  const onPimChanged = () => void plan();

  timeouts.push(setTimeout(() => void plan(), INITIAL_DELAY_MS));
  intervals.push(setInterval(() => void plan(), PLAN_INTERVAL_MS));
  window.addEventListener("plainva-pim-changed", onPimChanged);
  window.addEventListener("plainva-reminders-changed", onPimChanged);

  return () => {
    stopped = true;
    disarm();
    timeouts.forEach(clearTimeout);
    intervals.forEach(clearInterval);
    window.removeEventListener("plainva-pim-changed", onPimChanged);
    window.removeEventListener("plainva-reminders-changed", onPimChanged);
  };
}

/**
 * The next upcoming appointment as one line, for the tray menu.
 *
 * Appointments only: a task is due on a day, not at a place in the day's
 * sequence, and mixing the two would make "next" mean two things.
 */
/** When the next appointment starts, or null when there is none. */
export function nextStart(subjects: readonly ReminderSubject[], now: number): number | null {
  const next = subjects
    .filter((s) => s.kind !== "task" && s.startTs >= now)
    .sort((a, b) => a.startTs - b.startTs)[0];
  return next ? next.startTs : null;
}

export function nextLine(subjects: readonly ReminderSubject[], now: number): string {
  const next = subjects
    .filter((s) => s.kind !== "task" && s.startTs >= now)
    .sort((a, b) => a.startTs - b.startTs)[0];
  if (!next) return i18n.t("background.trayNoNext");
  const time = next.allDay
    ? i18n.t("reminders.allDayBody")
    : new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(next.startTs));
  return i18n.t("background.trayNext", { title: next.title || i18n.t("pim.untitledEvent"), time });
}

/** Appointments from the cache plus, when switched on, due tasks — planned by
 * the SAME rule, which is why they are one list rather than two concepts. */
async function collectSubjects(
  deps: ReminderSchedulerDeps,
  settings: Awaited<ReturnType<typeof loadReminderSettings>>,
  now: number,
  windowEndTs: number
): Promise<{ subjects: ReminderSubject[]; reason: ReminderReason }> {
  const subjects: ReminderSubject[] = [];

  // Gated on the switch, not merely on "a cache exists": the two switches are
  // independent now, so appointments must stay out when theirs is off.
  if (settings.enabled && deps.cache) {
    const only = new Set(settings.calendars);
    for (const e of await deps.cache.listEvents(now, windowEndTs)) {
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

  let reason: ReminderReason = settings.tasks ? "ok" : "tasksOff";

  if (settings.tasks && deps.queryService) {
    try {
      // Asked separately so the two silences stay distinguishable: no database
      // configured at all, versus one whose due column is not typed as a date.
      // Both used to end as an empty list with nothing said about either.
      const dbPath = await getTaskDatabasePath(deps.vaultPath);
      const overlay = dbPath
        ? await loadTaskOverlay({
            vaultPath: deps.vaultPath,
            vaultAdapter: deps.vaultAdapter,
            queryService: deps.queryService,
          })
        : null;
      if (!dbPath) reason = "noTaskDb";
      else if (overlay && overlay.dueKey === null) reason = "taskDueNotDate";
      for (const task of overlay?.tasks ?? []) {
        if (task.done) continue;
        const [y, m, d] = task.due.split("-").map(Number);
        if (!y || !m || !d) continue;
        const startTs = new Date(y, m - 1, d, 0, task.dueMinutes ?? 0).getTime();
        if (startTs > windowEndTs + 86_400_000 || startTs < now - 86_400_000) continue;
        subjects.push({
          key: task.path,
          kind: "task",
          title: task.title,
          startTs,
          // Without a time the task is a day, and gets the TASK day rule
          // (E1) — not the all-day appointment rule it used to borrow.
          allDay: task.dueMinutes === undefined,
          startDate: task.due,
          accountId: "",
          calendarId: "",
        });
      }
    } catch (e) {
      // An unreadable task database must never cost the appointments — but it
      // must not pass unmentioned either, which is what it used to do.
      reason = "taskDbUnreadable";
      console.warn("[reminderScheduler] due tasks unavailable", e);
    }
  }

  return { subjects, reason };
}
