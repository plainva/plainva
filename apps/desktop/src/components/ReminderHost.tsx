import { useEffect } from "react";
import { useVault } from "../contexts/VaultContext";
import { requestCalendarDay } from "../services/pim/calendarNav";
import { startReminderScheduler } from "../services/reminderScheduler";

/**
 * Runs the desktop reminder loop for the open vault (S11b).
 *
 * Its own component rather than another block in App.tsx: the loop needs the
 * vault's calendar cache and query service AND the shell's two ways of opening
 * something, and that combination is exactly what a small host is for. The
 * shell keeps one line.
 */
export function ReminderHost({
  onOpenNote,
  onOpenCalendar,
}: {
  onOpenNote: (path: string) => void;
  onOpenCalendar: () => void;
}): null {
  const { vaultPath, vaultAdapter, queryService, pimRuntime } = useVault();

  useEffect(() => {
    if (!vaultPath || !vaultAdapter) return;
    return startReminderScheduler({
      vaultPath,
      cache: pimRuntime?.cache ?? null,
      vaultAdapter,
      queryService: queryService ?? null,
      openNote: onOpenNote,
      openCalendar: (day) => {
        // Park the day first: the calendar tab reads it when it mounts, so a
        // tab that is not open yet still lands on the right day.
        requestCalendarDay(day);
        onOpenCalendar();
      },
    });
  }, [vaultPath, vaultAdapter, queryService, pimRuntime, onOpenNote, onOpenCalendar]);

  return null;
}
