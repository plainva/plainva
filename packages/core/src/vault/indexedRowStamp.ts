import type { SqlStatements } from "../db/IDatabaseAdapter.js";
import type { IVaultAdapter } from "./IVaultAdapter.js";
/**
 * What tells the index row of one file from the row of another file at the
 * same path: the timestamp the row carries (`files.mtime_local` — the file's
 * own, as it was when the index last read it).
 *
 * A pass that reports a file gone says which row it removed
 * (`VaultIndexerOptions.onLocalFileDeleted`), and the sync worker says which
 * row a removal of its own will be reported for (`SyncQueue.indexedRow`) — so
 * that "was that deletion mine?" is answered for the file and not for the
 * name (`OwnDeletionRegister`, finding 2026-10-12).
 */
export interface IndexedRowStamp {
  mtime: number;
}

/** The stamp of a row, from the timestamp column as a database hands it back. */
export function indexedRowStamp(mtimeLocal: unknown): IndexedRowStamp {
  return { mtime: Number(mtimeLocal ?? 0) };
}

/** The stamp of the index row of `path`, or null where the index holds none — read the one way (`SyncQueue`, the workspace state). */
export async function readIndexedRow(db: Pick<SqlStatements, "queryOne">, path: string): Promise<IndexedRowStamp | null> {
  const row = await db.queryOne<{ mtime_local: number | null }>(`SELECT mtime_local FROM files WHERE path = ?`, [path]);
  return row ? indexedRowStamp(row.mtime_local) : null;
}

/**
 * The stamps an own removal of `path` is marked with (`OwnDeletionRegister.mark`):
 * the row the index holds, and the file's own timestamp where it differs —
 * the index may not have read the file since its last write. The one source
 * for the plain sync and the encrypted workspace.
 */
export async function ownRemovalStamps(
  indexed: () => Promise<IndexedRowStamp | null>,
  vault: Pick<IVaultAdapter, "getFileInfo">,
  path: string,
): Promise<IndexedRowStamp[]> {
  const stamps: IndexedRowStamp[] = [];
  const row = await indexed();
  if (row) stamps.push(row);
  const info = await Promise.resolve().then(() => vault.getFileInfo(path)).catch(() => null);
  if (info && !info.isDirectory && !stamps.some((s) => s.mtime === info.mtime)) stamps.push(indexedRowStamp(info.mtime));
  return stamps;
}
