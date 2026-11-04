import { checkboxJumpTerm, errorText, noteTaskTick, relocateReminderLine, setPendingSearchJump, snoozeMoment, snoozeTask, toast, type ReminderLine } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import type { CalendarFocus } from "./calendarFocus";
import { getPimCache, openMeetingNoteFor } from "./pim/pimService";
import { setTaskDone } from "./taskCompletionAction";
import { rescheduleReminders, type ReminderIntent } from "./reminderScheduler";
import { getMobileSettings } from "./mobileSettings";
import { getMobileVault, vaultOps } from "./vaultService";
import { syncSoon } from "./syncService";

/**
 * What a tapped reminder actually does (S11).
 *
 * Kept out of both the scheduler and the shell: the scheduler's job ends when
 * the notification is handed to the operating system, and the shell only knows
 * how to open things. This is the piece in between.
 */

/**
 * The day a meeting note is named after — the rule of `eventStartDayKey`: an
 * all-day event's civil date, else the LOCAL day of its start. This used
 * `toISOString`, the UTC day: a meeting at 00:30 got the previous day's note,
 * and a second one beside the note the desktop and the preview write.
 */
function meetingDayKey(event: { allDay?: boolean; start?: { date?: string } }, startTs: number): string {
  if (event.allDay && event.start?.date) return event.start.date;
  const d = new Date(startTs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export interface ReminderActionHost {
  /** Opens a note by vault path. */
  openNote: (path: string) => void;
  /**
   * Brings the calendar to the front — at the appointment's day, with the
   * appointment opened, when a focus is given (feedback round 2026-09-01,
   * M4). Without one it simply opens the calendar.
   */
  openCalendar: (focus?: CalendarFocus) => void;
}

/**
 * Where a checkbox reminder's line stands now: the index is asked, because the
 * tap may come long after the reminder was planned — the note renamed or
 * moved meanwhile (E3). Where the index cannot say, the line as it was planned.
 */
async function currentLine(line: ReminderLine): Promise<ReminderLine> {
  try {
    const vault = await getMobileVault();
    const notes = await vault.queryService?.listTasks();
    return (notes && relocateReminderLine(notes, line)) || line;
  } catch {
    return line;
  }
}

/**
 * A checkbox task's reminder (E3): "Done" and a plain tap. "Later" is the task
 * note's own (`runReminderIntent`): it parks a moment under the reminder's
 * key, which for a box is its line.
 */
async function runCheckboxIntent(intent: ReminderIntent & { line: ReminderLine }, host: ReminderActionHost): Promise<void> {
  const line = await currentLine(intent.line);
  if (intent.action === "done") {
    // The tick a box gets anywhere: the note as it lies there, the line found
    // again in it, completion date and recurrence by the shared mutation.
    try {
      const vault = await getMobileVault();
      const update = await vaultOps.update(vault, line.path, noteTaskTick(line, true));
      if (update.changed) {
        syncSoon();
        // An editor holding this note takes the new line (the chain reports
        // no write of the app's own).
        window.dispatchEvent(new CustomEvent("m-external-update", { detail: { path: line.path, vaultId: vault.vaultId } }));
        toast.info(i18n.t("reminders.taskDone"));
      }
    } catch (e) {
      // A box is no property: the reason as the vault gives it.
      toast.error(errorText(e));
    }
    return;
  }
  // A plain tap: the note, at the line — the jump the task lists make.
  setPendingSearchJump({ path: line.path, term: checkboxJumpTerm(line.text) });
  host.openNote(line.path);
}

export async function runReminderIntent(intent: ReminderIntent, host: ReminderActionHost): Promise<void> {
  if (intent.kind === "task" && intent.line && intent.action !== "later1h" && intent.action !== "laterTomorrow") {
    await runCheckboxIntent({ ...intent, line: intent.line }, host);
    return;
  }
  if (intent.kind === "task") {
    if (intent.action === "done") {
      try {
        const result = await setTaskDone(intent.uid, true);
        // Ticking off from a notification is the one case where nothing on
        // screen confirms it — so it says so itself.
        if (result.spawnFailed) toast.error(i18n.t("tasks.repeatFailed"));
        else if (result.spawnedDue) toast.info(i18n.t("tasks.repeatSpawned", { date: result.spawnedDue }));
        else if (result.changed) toast.info(i18n.t("reminders.taskDone"));
      } catch (e) {
        // The tick writes the note's completion property: the sentence a
        // property write gets, with the reason as `errorText` reads it
        // (finding 2026-10-12) — the bare message of a block that is no YAML
        // quotes the note's own line.
        toast.error(i18n.t("mobile.propertyWriteFailed", { message: errorText(e) }));
      }
      return;
    }
    if (intent.action === "later1h" || intent.action === "laterTomorrow") {
      // "Later" parks ONE moment for this task on this device; the scheduler
      // plans it instead of the regular reminder until it has passed (B4).
      try {
        const now = Date.now();
        const until = snoozeMoment(intent.action === "later1h" ? "hour" : "tomorrow", now, getMobileSettings().reminderTaskAtMinutes);
        snoozeTask((await getMobileVault()).vaultId, intent.uid, until, now);
        await rescheduleReminders();
        toast.info(
          i18n.t("reminders.snoozedUntil", {
            time: new Intl.DateTimeFormat(i18n.language, { weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(until)),
          })
        );
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    // For a task the intent's `uid` IS the note path: the scheduler keys task
    // subjects by `row.path` (dueTaskSubjects), and `setTaskDone` above takes
    // the same value. Not a uid-to-path lookup waiting to be written.
    host.openNote(intent.uid);
    return;
  }

  if (intent.action === "meeting") {
    const cache = getPimCache();
    const event = cache ? await cache.getEventByUid(intent.accountId, intent.calendarId, intent.uid) : null;
    if (!event) {
      // The appointment has moved or gone since the reminder was scheduled —
      // the phone plans up to 14 days ahead, so this is normal, not an error.
      toast.error(i18n.t("reminders.eventGone"));
      host.openCalendar();
      return;
    }
    try {
      const res = await openMeetingNoteFor(event, meetingDayKey(event, intent.startTs));
      if (res) host.openNote(res.path); // null: the template's questions were cancelled
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    return;
  }

  // "open": the tap lands on the appointment itself, not on "today". The
  // intent carries everything needed; it was only never passed on.
  host.openCalendar({ uid: intent.uid, accountId: intent.accountId, calendarId: intent.calendarId, startTs: intent.startTs });
}
