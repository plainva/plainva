import type { IVaultAdapter } from "@plainva/core";
import { pinboardDraftLedger, sweepPinboardDrafts, type PinboardDraftSweep, type PinboardDraftSweepFiles } from "@plainva/ui";
import { applyIndexChanges, type RenameReindexer } from "./fileActions";
import { notifyFileOps } from "./indexMdAutoUpdate";

/**
 * The desktop's file paths for a pinboard draft that has to be finished — the
 * same ones "New entry" uses: the adapter chain (so a delete reaches the sync
 * like any other), the trash for the delete itself, then the index and the
 * managed overviews (plan Befunde 2026-09-24, E15).
 */
export function desktopDraftFiles(adapter: IVaultAdapter, indexer: RenameReindexer | null): PinboardDraftSweepFiles {
  return {
    exists: (path) => adapter.exists(path),
    readBytes: (path) => adapter.readBinaryFile(path),
    remove: async (path) => {
      await adapter.deleteItem(path, false, { confirmed: true });
      if (indexer) await applyIndexChanges(indexer, { removed: [path] }).catch(() => {});
      notifyFileOps([{ type: "delete", path }]);
    },
  };
}

/**
 * What an app that was closed or killed during a pinboard entry left behind,
 * finished once the vault is open in the main window (VaultContext): an empty
 * draft goes the way closing its window would have taken it.
 */
export function sweepDesktopPinboardDrafts(vaultPath: string, adapter: IVaultAdapter, indexer: RenameReindexer | null): Promise<PinboardDraftSweep> {
  return sweepPinboardDrafts(desktopDraftFiles(adapter, indexer), pinboardDraftLedger(vaultPath));
}
