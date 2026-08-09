import { toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";
import { getPimCache, openMeetingNoteFor } from "./pim/pimService";
import { setTaskDone } from "./taskCompletionAction";
import type { ReminderIntent } from "./reminderScheduler";

/**
 * What a tapped reminder actually does (S11).
 *
 * Kept out of both the scheduler and the shell: the scheduler's job ends when
 * the notification is handed to the operating system, and the shell only knows
 * how to open things. This is the piece in between.
 */

export interface ReminderActionHost {
  /** Opens a note by vault path. */
  openNote: (path: string) => void;
  /** Brings the calendar area to the front. */
  openCalendar: () => void;
}

export async function runReminderIntent(intent: ReminderIntent, host: ReminderActionHost): Promise<void> {
  if (intent.kind === "task") {
    if (intent.action === "done") {
      try {
        const result = await setTaskDone(intent.uid, true);
        // Ticking off from a notification is the one case where nothing on
        // screen confirms it — so it says so itself.
        if (result.spawnedDue) toast.info(i18n.t("tasks.repeatSpawned", { date: result.spawnedDue }));
        else if (result.changed) toast.info(i18n.t("reminders.taskDone"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      }
      return;
    }
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

  host.openCalendar();
}
