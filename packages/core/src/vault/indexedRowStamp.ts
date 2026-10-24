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
