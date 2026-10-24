import { applyTaskDueChanges, convertDueColumnToDateTime, offerDueTimeColumn, taskDueFailureText, toast, type TaskDueChange, type TaskDueOutcome } from "@plainva/ui";
import { getMobileSettings } from "./mobileSettings";
import { pimSyncNow } from "./pim/pimService";
import { syncSoon } from "./syncService";
import { vaultOps, vaultTextFiles, type MobileVault } from "./vaultService";

/**
 * Moving a task's due day on the phone (plan Befunde 2026-10-06, W2/W3). The
 * tasks screen and the Today screen both offer it, and both write the same
 * way: through `vaultOps.update` — the note is changed as it lies there, and
 * the change is in the index, the backup chain and the sync queue like any
 * other write — and with a nudge to the PIM
 * cycle, because a task mirrored from a provider list carries its new day
 * there too. What is written is the shared `applyTaskDueChanges`; the
 * desktop's twin is `applyDue` in TasksView.
 */
export async function moveTaskDueOnPhone(vault: MobileVault, dueKey: string | null, changes: readonly TaskDueChange[]): Promise<TaskDueOutcome> {
  const outcome = await applyTaskDueChanges(
    {
      updateNoteText: (path, change) => vaultOps.update(vault, path, change),
      writeDbNote: (path, mutate) => vaultOps.update(vault, path, mutate),
      dueKey,
    },
    changes,
  );
  if (outcome.moved > 0) {
    syncSoon();
    if (changes.some((change) => change.source === "database")) pimSyncNow();
    // A time set on a database whose due column shows a day only: the same
    // one-time offer to retype the column a quick capture makes (E9; wishes
    // 2026-10-24, E2). The desktop makes it in TasksView.
    const db = getMobileSettings().taskDatabase.trim();
    if (db && changes.some((change) => change.source === "database" && typeof change.time === "string")) {
      void offerDueTimeColumn({
        readTextFile: (path) => vaultOps.read(vault, path),
        vault: vault.vaultId,
        dbPath: db,
        convert: () => convertDueColumnToDateTime(vaultTextFiles(vault), db),
        converted: () => syncSoon(),
      }).catch(() => undefined);
    }
  }
  return outcome;
}

/**
 * Says what a move did: what could not be moved as a warning, what moved as a
 * notice that carries Undo — the same write, pointed back at the days that
 * were there (`outcome.undo`).
 */
export function announceTaskDue(
  outcome: TaskDueOutcome,
  words: { moved: string; skipped: (count: number) => string; undo: string },
  undo: (changes: readonly TaskDueChange[]) => void,
): void {
  if (outcome.skipped > 0) toast.warning(words.skipped(outcome.skipped));
  // A note that could not be written is not one that "changed in the
  // meantime" (finding 2026-10-12): one task says why, a section counts.
  const failed = taskDueFailureText(outcome);
  if (failed) toast.error(failed);
  if (outcome.moved === 0) return;
  const back = outcome.undo;
  toast.success(words.moved, back.length > 0 ? { label: words.undo, run: () => undo(back) } : undefined);
}
