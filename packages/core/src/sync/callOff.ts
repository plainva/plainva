import type { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";
import type { IVaultAdapter } from "../vault/IVaultAdapter.js";

/**
 * Calling off what an open vault still has under way, when closing or
 * switching gives up waiting for it.
 *
 * Closing a vault drains: pending writes settle, a running sync cycle
 * finishes. A cycle that waits for a provider that never answers would hold
 * the close — and the next open of the same vault — for good. After the
 * deadline the vault's runtime is called off instead: its index database and
 * its storage (the lowest vault adapter, which every link of the chain writes
 * through) are handed out fenced, and the fence refuses every new call at
 * once. A call already running ends as it would — a write of a file is whole
 * or not made, a transaction commits or rolls back — and nothing of that
 * runtime writes after it: not the sync worker or the workspace worker, not
 * the queue, the deletion journal, the sync state, nor a background task or a
 * late answer of the provider. Only then does the next runtime start.
 *
 * What a cycle had done halfway is read by the next one from the disk, the
 * provider and the database, as after a crash (see the tests of the four
 * states: an upload sent, a download written, a deletion of the provider's
 * carried out here, a confirmed deletion sent — none of them recorded).
 */
export class CalledOffError extends Error {
  constructor(what: string) {
    super(`${what}: the vault's runtime was called off`);
    this.name = "CalledOffError";
  }
}

export function isCalledOffError(error: unknown): error is CalledOffError {
  return error instanceof Error && error.name === "CalledOffError";
}

const DATABASE_CALLS = new Set(["execute", "query", "queryOne", "runBatch", "transaction"]);
const STORAGE_CALLS = new Set([
  "readTextFile", "readBinaryFile", "readTextFileState", "writeTextFile", "writeBinaryFile", "writeTextFileChange", "writeEditorText",
  "updateTextFile", "setFileTimes", "deleteItem", "deleteItemIfUnchanged", "moveToTrash", "renameItem", "createDir", "removeEmptyDir",
  "exists", "getFileInfo", "listDir", "listDirReport", "listDirForBackup", "realPath", "sameRootAsOpened",
  "getConflictSession", "listConflictSessions", "listConflictDiagnostics", "preserveConflict", "resolveConflict", "resolveConflictBytes",
]);

export interface VaultCallOff {
  /** The runtime's index database, fenced. */
  database<T extends IDatabaseAdapter>(db: T): T;
  /** The runtime's storage, fenced. */
  storage<T extends IVaultAdapter>(adapter: T): T;
  /** Refuses every new call of what this fence handed out, from now on. */
  callOff(): void;
  readonly calledOff: boolean;
}

export function createVaultCallOff(): VaultCallOff {
  let calledOff = false;
  const fence = <T extends object>(target: T, calls: ReadonlySet<string>, what: string): T =>
    new Proxy(target, {
      get(obj, key, receiver) {
        const value = Reflect.get(obj, key, receiver);
        if (typeof value !== "function") return value;
        if (typeof key !== "string" || !calls.has(key)) return value.bind(obj);
        return (...args: unknown[]) => {
          if (calledOff) return Promise.reject(new CalledOffError(`${what}.${key}`));
          return (value as (...a: unknown[]) => unknown).apply(obj, args);
        };
      },
    });
  return {
    database: (db) => fence(db, DATABASE_CALLS, "index database"),
    storage: (adapter) => fence(adapter, STORAGE_CALLS, "vault storage"),
    callOff: () => {
      calledOff = true;
    },
    get calledOff() {
      return calledOff;
    },
  };
}
