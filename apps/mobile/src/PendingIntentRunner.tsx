import { useEffect } from "react";
import type { PendingShare } from "./services/shareTarget";
import { consumeReminderIntent } from "./services/reminderScheduler";
import { runReminderIntent } from "./services/reminderActions";

/**
 * Runs the intents that arrive from outside the app — a launcher shortcut, a
 * share, a tapped reminder (S11). They are parked as state while the vault is
 * still booting and executed here, once the closures that can act on them
 * exist.
 *
 * Its own module since S11: App.tsx is under a structural ratchet, and the
 * notification routing is a third kind of outside intent — exactly the sort of
 * feature block that must not keep accreting in the shell.
 */
export function PendingIntentRunner({
  pendingShortcut,
  pendingShare,
  setPendingShortcut,
  setPendingShare,
  onCapture,
  onCaptureShared,
  onOpenToday,
  onOpenNote,
  onOpenCalendar,
}: {
  pendingShortcut: string | null;
  pendingShare: PendingShare | null;
  setPendingShortcut: (v: string | null) => void;
  setPendingShare: (v: PendingShare | null) => void;
  onCapture: () => void;
  onCaptureShared: (share: PendingShare) => void;
  onOpenToday: () => void;
  onOpenNote: (path: string) => void;
  onOpenCalendar: () => void;
}) {
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
  useEffect(() => {
    if (!pendingShortcut) return;
    setPendingShortcut(null);
    if (pendingShortcut === "new-note") onCapture();
    else if (pendingShortcut === "today") onOpenToday();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShortcut]);
  useEffect(() => {
    if (!pendingShare) return;
    setPendingShare(null);
    onCaptureShared(pendingShare);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingShare]);
  return null;
}
