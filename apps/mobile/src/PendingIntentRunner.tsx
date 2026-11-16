import { useEffect } from "react";
import { consumeReminderIntent } from "./services/reminderScheduler";
import type { CalendarFocus } from "./services/calendarFocus";
import { runReminderIntent } from "./services/reminderActions";
import { useStableHandler } from "@plainva/ui";
import { receiveNoteLinks } from "./services/noteLinkRoute";
import type { MobileVault } from "./services/vaultService";

/**
 * Runs the intents that arrive from outside the app — a launcher shortcut, a
 * tapped reminder (S11). They are parked as state while the vault is
 * still booting and executed here, once the closures that can act on them
 * exist.
 *
 * Its own module since S11: App.tsx is under a structural ratchet, and the
 * notification routing is a third kind of outside intent — exactly the sort of
 * feature block that must not keep accreting in the shell.
 */
export function PendingIntentRunner({
  pendingShortcut,
  setPendingShortcut,
  onCapture,
  onNewTask,
  onJournal,
  onOpenToday,
  onOpenNote,
  onOpenCalendar,
  vault,
}: {
  pendingShortcut: string | null;
  setPendingShortcut: (v: string | null) => void;
  onCapture: () => void;
  /** Opens the tasks tab with the quick-capture sheet (launcher shortcut "new-task", B6). */
  onNewTask: () => void;
  /** Opens the capture sheet on its journal kind (launcher shortcut "journal", plan Journal J4). */
  onJournal: () => void;
  onOpenToday: () => void;
  onOpenNote: (path: string) => void;
  onOpenCalendar: (focus?: CalendarFocus) => void;
  /** The open vault: note links (F2) open in it, and wait while there is none. */
  vault: MobileVault | null;
}) {
  // A note link (`plainva://open?…`, F2) — from the system, or clicked in the
  // app. It can be what started the app, so it waits in the shared inbox
  // until this vault says how it opens a note; a vault switch registers anew.
  const openLinkedNote = useStableHandler(onOpenNote);
  useEffect(() => receiveNoteLinks(vault, openLinkedNote), [vault, openLinkedNote]);
  // A tapped reminder can arrive on a COLD start: the OS wakes the process and
  // the vault is not open yet. The scheduler therefore parks the intent and
  // only signals; this runs once the closures that can act on it exist, and
  // drains anything already waiting.
  useEffect(() => {
    const run = () => {
      const intent = consumeReminderIntent();
      if (intent) void runReminderIntent(intent, { openNote: onOpenNote, openCalendar: onOpenCalendar });
    };
    window.addEventListener("m-reminder-intent", run);
    run();
    return () => window.removeEventListener("m-reminder-intent", run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A tapped widget row, the same way round (plan Widgets, W3): the service
  // resolves the position to a note and parks it, because the tap can be what
  // started the app and no vault is open yet at that moment.
  useEffect(() => {
    const run = () => {
      void import("./services/widgetService")
        .then(({ consumeWidgetOpen }) => {
          const target = consumeWidgetOpen();
          if (target) onOpenNote(target.path);
        })
        .catch(() => {});
    };
    window.addEventListener("m-widget-open", run);
    run();
    return () => window.removeEventListener("m-widget-open", run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!pendingShortcut) return;
    setPendingShortcut(null);
    if (pendingShortcut === "new-note") onCapture();
    else if (pendingShortcut === "new-task") onNewTask();
    else if (pendingShortcut === "journal") onJournal();
    else if (pendingShortcut === "today") onOpenToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShortcut]);
  return null;
}
