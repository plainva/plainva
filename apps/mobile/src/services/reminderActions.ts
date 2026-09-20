import { snoozeMoment, snoozeTask, toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getPimCache, openMeetingNoteFor } from "./pim/pimService";
import { setTaskDone } from "./taskCompletionAction";
import { rescheduleReminders, type ReminderIntent } from "./reminderScheduler";
import { getMobileSettings } from "./mobileSettings";
import { getMobileVault } from "./vaultService";

/**
 * What a tapped reminder actually does (S11).
 *
 * Kept out of both the scheduler and the shell: the scheduler's job ends when
 * the notification is handed to the operating system, and the shell only knows
 * how to open things. This is the piece in between.
 */

/** The appointment a tapped reminder points at — enough to find it in the cache. */
export interface CalendarFocus {
  uid: string;
  accountId: string;
  calendarId: string;
  startTs: number;
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

export async function runReminderIntent(intent: ReminderIntent, host: ReminderActionHost): Promise<void> {
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
        toast.error(e instanceof Error ? e.message : String(e));
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
      const { path } = await openMeetingNoteFor(event, new Date(intent.startTs).toISOString().slice(0, 10));
      host.openNote(path);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
    return;
  }

  // "open": the tap lands on the appointment itself, not on "today". The
  // intent carries everything needed; it was only never passed on.
  host.openCalendar({ uid: intent.uid, accountId: intent.accountId, calendarId: intent.calendarId, startTs: intent.startTs });
}
