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
 * or not made, a transaction commits or rolls back — and the fence counts it,
 * with every call that waits for a turn inside an adapter, until it ends:
 * the same vault opens again only once the called-off runtime has ENDED
 * (`ended`). Never two runtimes at one vault. A step that writes past the
 * fence (the app's settings, the keychain) asks it first (`allows`), and a
 * write elsewhere is counted (`track`).
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
  /**
   * Whether a step that writes past the fenced database and storage — the
   * app's settings, the keychain — may still apply what it got: false once
   * called off (a late answer must not overwrite what the next runtime set).
   */
  allows(): boolean;
  /**
   * Counts `work` as one of this runtime's open calls (a write that does not
   * go through the fenced database or storage), so `ended` waits for it.
   */
  track<T>(work: Promise<T>): Promise<T>;
  /**
   * Resolves once the runtime is called off AND none of its calls is open any
   * more — running or waiting for a turn inside an adapter. Only then may the
   * same vault open again: never two runtimes at one vault.
   */
  ended(): Promise<void>;
  /** How many of the runtime's calls are open now (for the notice while the same vault waits to open). */
  readonly open: number;
}

export function createVaultCallOff(): VaultCallOff {
  let calledOff = false;
  let open = 0;
  let waiters: Array<() => void> = [];
  const settleIfEnded = () => {
    if (!calledOff || open > 0) return;
    const ready = waiters;
    waiters = [];
    for (const resolve of ready) resolve();
  };
  const track = <T>(work: Promise<T>): Promise<T> => {
    open += 1;
    const done = () => {
      open -= 1;
      settleIfEnded();
    };
    work.then(done, done);
    return work;
  };
  const fence = <T extends object>(target: T, calls: ReadonlySet<string>, what: string): T =>
    new Proxy(target, {
      get(obj, key, receiver) {
        const value = Reflect.get(obj, key, receiver);
        if (typeof value !== "function") return value;
        if (typeof key !== "string" || !calls.has(key)) return value.bind(obj);
        return (...args: unknown[]) => {
          if (calledOff) return Promise.reject(new CalledOffError(`${what}.${key}`));
          const result = (value as (...a: unknown[]) => unknown).apply(obj, args);
          // Counted until it settles: a call that waits for a turn inside the adapter is open too.
          return result instanceof Promise ? track(result) : result;
        };
      },
    });
  return {
    database: (db) => fence(db, DATABASE_CALLS, "index database"),
    storage: (adapter) => fence(adapter, STORAGE_CALLS, "vault storage"),
    callOff: () => {
      calledOff = true;
      settleIfEnded();
    },
    get calledOff() {
      return calledOff;
    },
    allows: () => !calledOff,
    track,
    ended: () =>
      new Promise<void>((resolve) => {
        waiters.push(resolve);
        settleIfEnded();
      }),
    get open() {
      return open;
    },
  };
}
