import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import {
  checkboxJumpTerm,
  checkboxReminderSubjects,
  planReminders,
  readTaskSnoozes,
  relocateReminderLine,
  reminderText,
  taskReminderSubjects,
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
/**
 * A change in the vault re-plans after this quiet spell: a checkbox given a
 * time, ticked or deleted is planned anew within seconds instead of at the
 * next five-minute tick — which could come after its moment. Debounced,
 * because typing saves often and every plan reads the vault's task lines.
 */
const VAULT_CHANGE_QUIET_MS = 3_000;

export interface ReminderSchedulerDeps {
  vaultPath: string;
  cache: PimCacheRepository | null;
  vaultAdapter: DueTaskDeps["vaultAdapter"];
  queryService: DueTaskDeps["queryService"] | null;
  /** Brings a note to the front (the toast action). */
  openNote: (path: string) => void;
  /**
   * Brings a note to the front at the place where `term` stands — a checkbox
   * reminder opens its note at its line (E3). Without it the note opens at
   * the top.
   */
  openNoteAt?: (path: string, term: string) => void;
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
      ? { label: i18n.t("reminders.actionOpenTask"), run: () => void openTask(subject, deps) }
      : { label: i18n.t("reminders.actionOpenCalendar"), run: () => deps.openCalendar(localDay(subject.startTs)) };
  toast.info(`${title} · ${body}`, action);
}

/**
 * Opens what a task reminder is about. A task note is its path. A checkbox
 * opens its note AT its line — the jump the calendar's checkbox rows make —
 * and the line is asked of the index first: the toast may be clicked minutes
 * later, after the note was renamed or moved (E3).
 */
async function openTask(subject: ReminderSubject, deps: ReminderSchedulerDeps): Promise<void> {
  const planned = subject.line;
  if (!planned) {
    deps.openNote(subject.key);
    return;
  }
  let line = planned;
  try {
    const notes = await deps.queryService?.listTasks?.();
    if (notes) line = relocateReminderLine(notes, planned) ?? planned;
  } catch {
    /* The index could not answer: the note where the line was planned. */
  }
  if (deps.openNoteAt) deps.openNoteAt(line.path, checkboxJumpTerm(line.text));
  else deps.openNote(line.path);
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
      if (!settings.enabled && !settings.tasks && !settings.checkboxes) {
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
              // An appointment's armed reminder is a commitment (above). A
              // task's is checked once more at its moment: ticked, deleted,
              // moved or given another time inside the arming horizon, it is
              // no longer due — and being reminded of something one has
              // finished is how reminders stop being trusted (E3).
              if (reminder.subject.kind !== "task") {
                announceReminder(reminder, deps);
                return;
              }
              void stillPlanned(reminder, deps).then((still) => {
                if (still && !stopped) announceReminder(reminder, deps);
              });
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
  let quiet: ReturnType<typeof setTimeout> | null = null;
  const onVaultChanged = (e: Event) => {
    const vault = (e as CustomEvent<{ vaultPath?: string } | undefined>).detail?.vaultPath;
    if (vault !== undefined && vault !== deps.vaultPath) return;
    if (quiet) clearTimeout(quiet);
    quiet = setTimeout(() => {
      quiet = null;
      void plan();
    }, VAULT_CHANGE_QUIET_MS);
  };

  timeouts.push(setTimeout(() => void plan(), INITIAL_DELAY_MS));
  // Planned over half an index, the checkbox reminders of the notes not read
  // yet are missing (performance plan L3): planned again the moment it is whole.
  void (deps.queryService as { untilWholeIndex?: () => Promise<void> } | null)?.untilWholeIndex?.().then(() => { if (!stopped) void plan(); }, () => {});
  intervals.push(setInterval(() => void plan(), PLAN_INTERVAL_MS));
  window.addEventListener("plainva-pim-changed", onPimChanged);
  window.addEventListener("plainva-reminders-changed", onPimChanged);
  window.addEventListener(REMINDER_SOURCES_CHANGED, onVaultChanged);

  return () => {
    stopped = true;
    disarm();
    if (quiet) clearTimeout(quiet);
    timeouts.forEach(clearTimeout);
    intervals.forEach(clearInterval);
    window.removeEventListener("plainva-pim-changed", onPimChanged);
    window.removeEventListener("plainva-reminders-changed", onPimChanged);
    window.removeEventListener(REMINDER_SOURCES_CHANGED, onVaultChanged);
  };
}

/**
 * The vault's files changed (the index moved on): task reminders may have
 * changed with them. The vault context says it; the scheduler re-plans after
 * a quiet spell.
 */
export const REMINDER_SOURCES_CHANGED = "plainva-reminder-sources-changed";

/** Whether a task reminder is still due at its moment, asked of the vault as it is now. */
async function stillPlanned(reminder: PlannedReminder, deps: ReminderSchedulerDeps): Promise<boolean> {
  try {
    const settings = await loadReminderSettings(await getSettingsStore(), deps.vaultPath);
    const now = reminder.at - 1;
    // Tasks only: the appointments are not asked (their switch off here).
    const { subjects } = await collectSubjects(deps, { ...settings, enabled: false }, now, now + WINDOW_DAYS * 86_400_000);
    const same = subjects.filter((s) => s.key === reminder.subject.key);
    return planReminders(same, settings.rule, { now, windowEndTs: reminder.at }).reminders.some((r) => r.at === reminder.at);
  } catch {
    // The vault could not be asked: announce rather than swallow it.
    return true;
  }
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

  // "Switched off" only when neither kind of task reminds: with checkbox
  // reminders on, the task count is theirs and nothing is off.
  let reason: ReminderReason = settings.tasks || settings.checkboxes ? "ok" : "tasksOff";

  if (settings.tasks && deps.queryService) {
    try {
      // The task DATABASE, behind its switch. Checkbox tasks have their own
      // switch below (Sammelplan § 3.145 Nr. 1, decision E3 of 30.10.).
      //
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
      // One rule with the phone (`taskReminderSubjects`): a task with a time
      // reminds at its time, `remind` in the note is the exception per task,
      // and a parked "later" replaces the regular moment until it has passed.
      subjects.push(...taskReminderSubjects(overlay?.tasks ?? [], { now, windowEndTs, snoozes: readTaskSnoozes(deps.vaultPath, now) }));
    } catch (e) {
      // An unreadable task database must never cost the appointments — but it
      // must not pass unmentioned either, which is what it used to do.
      reason = "taskDbUnreadable";
      console.warn("[reminderScheduler] due tasks unavailable", e);
    }
  }

  // Checkbox tasks with a due date AND a time, from the index's task lines —
  // derived anew on every plan, so a ticked, deleted or moved line is simply
  // no longer there. One rule with the phone (`checkboxReminderSubjects`).
  if (settings.checkboxes && deps.queryService?.listTasks) {
    try {
      const notes = await deps.queryService.listTasks();
      subjects.push(...checkboxReminderSubjects(notes, { now, windowEndTs, snoozes: readTaskSnoozes(deps.vaultPath, now) }));
    } catch (e) {
      console.warn("[reminderScheduler] checkbox tasks unavailable", e);
    }
  }

  return { subjects, reason };
}
