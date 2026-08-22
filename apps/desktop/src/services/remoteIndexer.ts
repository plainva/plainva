import type { VaultFileInfo, IndexScanReport } from "@plainva/core";

/**
 * The indexer an auxiliary window gets (multi-window P1).
 *
 * Every one of these is a deliberate no-op, and the reason is the same in each
 * case: in a client window the write that precedes the index update has already
 * travelled to the owner, and the owner indexes it there — `ownerBus` runs the
 * same `indexFile` / `applyIndexChanges` the central window runs for its own
 * saves, then broadcasts `index-changed`, which this window follows. Doing the
 * work a second time from here would need a write connection to the index that
 * the aux capability deliberately withholds, and would race the owner for the
 * same rows.
 *
 * So why an object at all rather than `null`? Because the editor and the file
 * actions treat a missing indexer as "this vault is not ready" and refuse to
 * SAVE (`if (!activePath || !vaultAdapter || !indexer) return;`). A null
 * indexer would make an auxiliary window silently read-only — the failure would
 * look like a UI bug and be diagnosed as one. This object says instead: there
 * is an indexer, it is simply not this window's job.
 *
 * `indexFile` returns false on purpose. Its result answers "did metadata change,
 * i.e. must the tree refresh" — and that refresh is driven by the owner's
 * broadcast. Returning true would make the client refresh twice for every
 * keystroke-triggered save.
 */
export interface IndexerApi {
  indexFile(fileInfo: VaultFileInfo): Promise<boolean>;
  indexPath(path: string): Promise<"indexed" | "removed" | "unchanged" | "needs-full-scan">;
  removePathFromIndex(path: string): Promise<void>;
  indexVaultFull(): Promise<IndexScanReport>;
}

const EMPTY_REPORT: IndexScanReport = {
  added: 0,
  changed: 0,
  removed: 0,
  skipped: [],
  durationMs: 0,
};

/** Creates the no-op indexer described above. */
export function createRemoteIndexer(): IndexerApi {
  return {
    async indexFile() {
      return false;
    },
    async indexPath() {
      return "unchanged";
    },
    async removePathFromIndex() {
      /* the owner de-indexed it as part of the delegated delete */
    },
    async indexVaultFull() {
      return EMPTY_REPORT;
    },
  };
}
