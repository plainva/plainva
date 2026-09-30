import { TaskNameCleanupNotice, errorText, toast, useTaskNameCleanup } from "@plainva/ui";
import { mConfirm } from "../services/mobileDialogs";
import { getPimCache } from "../services/pim/pimService";
import { syncSoon } from "../services/syncService";
import { vaultOps, type MobileVault } from "../services/vaultService";

/**
 * "Task notes that still carry an id in their name" on the phone (plan
 * Befunde 2026-09-24, E12) — the twin of the desktop's TaskNamesNotice, on
 * the same shared hook and notice. Each rename is the phone's ordinary one
 * (`vaultOps.renameReport`: pending save first, links retargeted through the
 * sync chain, index, bookmarks); the task reconciler's stored note path
 * follows through the PIM cache.
 */
export function TaskNamesNotice({ vault, reloadKey, onChanged }: { vault: MobileVault; reloadKey: unknown; onChanged: () => void }) {
  const state = useTaskNameCleanup({
    vault: vault.vaultId,
    reloadKey,
    queryService: vault.queryService ?? null,
    exists: (path) => vault.files.exists(path),
    readTextFile: (path) => vaultOps.read(vault, path),
    writeTextFile: (path, content) => vaultOps.save(vault, path, content),
    renameNote: async (from, to) => {
      const title = (to.split("/").pop() ?? to).replace(/\.md$/i, "");
      const result = await vaultOps.renameReport(vault, from, title);
      return { newPath: result.newPath, linkUpdateFailed: result.linkUpdateFailed };
    },
    moveTaskNotePath: async (from, to) => {
      await getPimCache()?.moveTaskNotePath(from, to);
    },
    reindex: async (moved, added) => {
      // The index follows the rename; it does not report the old name as
      // deleted (a queued remote DELETE, issue 113).
      for (const { from, to } of moved) await vault.indexer?.relocatePathInIndex(from, to).catch(() => undefined);
      await vault.reindexPaths([...moved.map((m) => m.to), ...added]);
    },
    onChanged: () => {
      onChanged();
      syncSoon();
    },
    onError: (e) => toast.error(errorText(e)),
  });
  return <TaskNameCleanupNotice state={state} className="m-names-notice" confirm={(o) => mConfirm(o)} />;
}
