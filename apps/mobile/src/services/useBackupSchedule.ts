import { useEffect } from "react";
import { backupIfDue } from "./vaultBackup";
import type { MobileVault } from "./vaultService";

/**
 * The scheduled archive's trigger (S36), out of the shell.
 *
 * It is one effect, but it is a feature block, and the shell's line budget
 * exists precisely so features do not accumulate there. It also belongs next
 * to the service it drives: the "when" of the archive is part of the archive,
 * not part of the app frame.
 *
 * The check runs on open and on every foreground — a phone gets no background
 * timer, so "due" can only be asked while the app is in front. That makes this
 * a catch-up, never a clock, and `backupIfDue` says so too.
 */
export function useBackupSchedule(vault: MobileVault | null, vaultName: string): void {
  useEffect(() => {
    if (!vault) return;
    const check = () => void backupIfDue(vault, vaultName);
    check();
    window.addEventListener("m-backup-due", check);
    return () => window.removeEventListener("m-backup-due", check);
  }, [vault, vaultName]);
}
