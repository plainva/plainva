import { applyTaskDueChanges, toast, type TaskDueChange, type TaskDueOutcome } from "@plainva/ui";
import { pimSyncNow } from "./pim/pimService";
import { syncSoon } from "./syncService";
import { vaultOps, type MobileVault } from "./vaultService";

/**
 * Moving a task's due day on the phone (plan Befunde 2026-10-06, W2/W3). The
 * tasks screen and the Today screen both offer it, and both write the same
 * way: through `vaultOps.save` — so the change is in the index, the backup
 * chain and the sync queue like any other write — and with a nudge to the PIM
 * cycle, because a task mirrored from a provider list carries its new day
 * there too. What is written is the shared `applyTaskDueChanges`; the
 * desktop's twin is `applyDue` in TasksView.
 */
export async function moveTaskDueOnPhone(vault: MobileVault, dueKey: string | null, changes: readonly TaskDueChange[]): Promise<TaskDueOutcome> {
  const outcome = await applyTaskDueChanges(
    {
      readTextFile: (path) => vaultOps.read(vault, path),
      writeNoteText: (path, content) => vaultOps.save(vault, path, content),
      writeDbNote: async (path, mutate) => {
        const raw = await vaultOps.read(vault, path);
        const next = mutate(raw);
        if (next !== raw) await vaultOps.save(vault, path, next);
      },
      dueKey,
    },
    changes,
  );
  if (outcome.moved > 0) {
    syncSoon();
    if (changes.some((change) => change.source === "database")) pimSyncNow();
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
  if (outcome.moved === 0) return;
  const back = outcome.undo;
  toast.success(words.moved, back.length > 0 ? { label: words.undo, run: () => undo(back) } : undefined);
}
