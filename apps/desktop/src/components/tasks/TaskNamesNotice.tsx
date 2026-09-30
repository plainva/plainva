import { TaskNameCleanupNotice, errorText, toast, useTaskNameCleanup } from "@plainva/ui";
import { useVault } from "../../contexts/VaultContext";
import { appConfirm } from "../../services/appDialogs";
import { applyIndexChanges, reindexAfterRename, renameToName } from "../../services/fileActions";
import { notifyFileOps } from "../../services/indexMdAutoUpdate";
import { requestSaveFlush } from "../../services/saveFlush";

/**
 * "Task notes that still carry an id in their name" in the tasks view (plan
 * Befunde 2026-09-24, E12) — the desktop's wiring of the shared hook and
 * notice; the phone's twin is `apps/mobile/src/components/TaskNamesNotice`.
 *
 * Each rename is the desktop's ordinary one: a pending editor save lands
 * first, `renameToName` moves the file and retargets links, bookmarks and
 * pinboards, the index follows, open tabs follow (`onRenamed`). The stored
 * note path of the task reconciler follows through its cache.
 */
export function TaskNamesNotice({
  reloadKey,
  onRenamed,
  onChanged,
}: {
  /** Anything that means "the index may have changed". */
  reloadKey: unknown;
  /** Open tabs follow a renamed note. */
  onRenamed: (from: string, to: string) => void;
  onChanged: () => void;
}) {
  const { queryService, vaultAdapter, vaultPath, indexer, pimRuntime } = useVault();
  const state = useTaskNameCleanup({
    vault: vaultAdapter ? vaultPath : null,
    reloadKey,
    queryService: queryService ?? null,
    exists: (path) => vaultAdapter!.exists(path),
    readTextFile: (path) => vaultAdapter!.readTextFile(path),
    writeTextFile: (path, content) => vaultAdapter!.writeTextFile(path, content),
    renameNote: async (from, to) => {
      await requestSaveFlush(from, vaultPath ?? undefined);
      const name = (to.split("/").pop() ?? to).replace(/\.md$/i, "");
      const result = await renameToName({ adapter: vaultAdapter!, queryService: queryService ?? null, oldPath: from, newName: name, isFolder: false });
      if (!result.ok) throw new Error(result.reason);
      onRenamed(from, result.newPath);
      if (indexer) await reindexAfterRename(indexer, { oldPath: from, newPath: result.newPath, isFolder: false, changedPaths: result.changedPaths });
      notifyFileOps([{ type: "move", from, to: result.newPath }]);
      return { newPath: result.newPath, linkUpdateFailed: result.linkUpdateFailed };
    },
    moveTaskNotePath: async (from, to) => {
      if (pimRuntime) await pimRuntime.cache.moveTaskNotePath(from, to);
    },
    reindex: async (removed, added) => {
      if (indexer) await applyIndexChanges(indexer, { removed, added });
    },
    onChanged,
    onError: (e) => {
      console.error("[TaskNamesNotice]", e);
      toast.error(errorText(e));
    },
  });
  return (
    <TaskNameCleanupNotice
      state={state}
      className="pv-names-notice--inset"
      confirm={(o) => appConfirm({ ...o, kind: "warning" })}
    />
  );
}
