import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from "@capacitor-community/sqlite";
import { TransactionTurns } from "./transactionTurns";

/**
 * Every database the phone opens goes through ONE `SQLiteConnection`
 * (device finding 2026-10-28).
 *
 * The plugin keeps two lists of open databases: the native one, and one per
 * `SQLiteConnection` object on the JavaScript side. Each database adapter
 * used to make its own object and ask it `checkConnectionsConsistency()`
 * before opening. A new object's list is empty, and an empty list tells the
 * native side that nothing should be open: on iOS and on Android it then
 * closes EVERY database (`closeAllConnections`). So opening a second
 * database - the files step of the connect wizard opening the new vault's
 * index, deleting a vault reading the deleted vault's - closed the active
 * vault's index under it, and its next query failed with "Connection to
 * plainva-… not available" (iOS) or "No available connection for database"
 * (Android). The wizard stopped at its first step.
 *
 * Here one object knows every database that is open, so the check agrees
 * with the native side. It runs once per JavaScript lifetime, on the first
 * open: what is still open natively from before a reload of the web view is
 * closed then, and only then, while nothing of this lifetime is open yet.
 *
 * A database opened twice (two adapters on one name) is ONE native
 * connection: it is counted, closed with its last user, and its transactions
 * take turns across both adapters, as they must on a single connection.
 */

interface OpenDatabase {
  connection: SQLiteDBConnection;
  users: number;
  turns: TransactionTurns;
}

export interface DatabaseHandle {
  connection: SQLiteDBConnection;
  turns: TransactionTurns;
}

let sqlite: SQLiteConnection | null = null;
let checked = false;
const open = new Map<string, OpenDatabase>();
/** Opening and closing take turns, so that a close and an open of one name never cross. */
let queue: Promise<unknown> = Promise.resolve();

function inQueue<T>(work: () => Promise<T>): Promise<T> {
  const turn = queue.then(work);
  queue = turn.catch(() => {});
  return turn;
}

function plugin(): SQLiteConnection {
  sqlite ??= new SQLiteConnection(CapacitorSQLite);
  return sqlite;
}

/** Opens `name`, or hands out the connection that is already open, and counts the user. */
export function acquireDatabase(name: string): Promise<DatabaseHandle> {
  return inQueue(async () => {
    const known = open.get(name);
    if (known) {
      known.users += 1;
      return { connection: known.connection, turns: known.turns };
    }
    const conn = plugin();
    if (!checked) {
      // Nothing of this lifetime is open yet: the native side closes what a
      // previous lifetime left open, which `createConnection` would refuse.
      await conn.checkConnectionsConsistency();
      checked = true;
    }
    const connection = (await conn.isConnection(name, false)).result
      ? await conn.retrieveConnection(name, false)
      : await conn.createConnection(name, false, "no-encryption", 1, false);
    try {
      await connection.open();
    } catch (error) {
      await conn.closeConnection(name, false).catch(() => {});
      throw error;
    }
    await useWriteAheadLog(name, connection);
    const entry: OpenDatabase = { connection, users: 1, turns: new TransactionTurns() };
    open.set(name, entry);
    return { connection, turns: entry.turns };
  });
}

/** One user is done with `name`; the last one closes it. */
export function releaseDatabase(name: string): Promise<void> {
  return inQueue(async () => {
    const entry = open.get(name);
    if (!entry) return;
    entry.users -= 1;
    if (entry.users > 0) return;
    open.delete(name);
    try {
      await entry.connection.close();
    } finally {
      await plugin().closeConnection(name, false);
    }
  });
}

/**
 * The database writes through a write-ahead log, and waits for the disk only
 * at a checkpoint (performance plan L4, finding B5) - as the desktop's has
 * always done (`TauriDatabaseAdapter`). The plugin opens a database in its
 * rollback-journal mode, where every single write waits for the disk: in the
 * core's measurement the index of a saved note took twice as long that way.
 *
 * What it costs, and why it is safe:
 *  - The log is a file beside the database (`<name>-wal`, with its index
 *    `<name>-shm`). SQLite folds it into the database when the last
 *    connection closes and removes both; deleting a database leaves the log
 *    first (`deleteDatabaseFile`), so no log of a deleted database is left
 *    for a new one of the same name to replay. Nothing on the phone copies or
 *    backs up a database file: the index is rebuilt from the vault.
 *  - An app killed in the middle of a write comes back with every committed
 *    transaction and nothing of the one that was open: SQLite reads the log
 *    on the next open and drops what was never committed (`walRecovery.test.ts`
 *    shows it on a real file). `synchronous = NORMAL` can lose the last
 *    transactions only when the device itself loses power, and even then
 *    never corrupts the file - the index is rebuilt, the notes are files.
 *  - The journal mode is kept in the file; `synchronous` is not, so both are
 *    set at every open. Android's SQLite opens a database in its own default
 *    mode and so folds the log back first; that is a checkpoint, no loss.
 *  - In the browser build (jeep-sqlite, the database in memory and stored
 *    whole) there is no log: SQLite answers "memory" and nothing changes.
 *
 * `query`, not `execute`: `PRAGMA journal_mode` answers with a row, and
 * Android runs `execute` through a call that refuses statements with rows.
 * A database that does not take the log stays in its old mode and works.
 */
async function useWriteAheadLog(name: string, connection: SQLiteDBConnection): Promise<void> {
  try {
    await connection.query("PRAGMA journal_mode = WAL;");
    await connection.query("PRAGMA synchronous = NORMAL;");
  } catch (error) {
    console.warn(`[sqlite] ${name} keeps its journal mode`, error);
  }
}

/**
 * Removes a per-vault database file (vault deletion, a discarded connect
 * destination). Best effort.
 *
 * The plugin deletes only a database it has a connection for, and the vault
 * being deleted has been closed by then: "No available connection" (Android)
 * or "Connection … not available" (iOS) was the answer, swallowed by the
 * caller, and the index - every note's text - stayed on the phone. So a
 * connection is opened for the deletion when none is. Before the file goes,
 * the database leaves its write-ahead log: the log is folded in and removed
 * with its index file, which the plugin's deletion on iOS would leave behind
 * (it removes the database file alone).
 */
export function deleteDatabaseFile(name: string): Promise<void> {
  return inQueue(async () => {
    const known = open.get(name);
    let connection = known?.connection ?? null;
    let opened = false;
    if (!connection) {
      const conn = plugin();
      if (!checked) {
        await conn.checkConnectionsConsistency();
        checked = true;
      }
      connection = (await conn.isConnection(name, false)).result
        ? await conn.retrieveConnection(name, false)
        : await conn.createConnection(name, false, "no-encryption", 1, false);
      opened = true;
      await connection.open().catch(() => {});
    }
    try {
      await connection.query("PRAGMA journal_mode = DELETE;").catch(() => {});
      await CapacitorSQLite.deleteDatabase({ database: name });
    } finally {
      if (opened) await plugin().closeConnection(name, false).catch(() => {});
    }
  });
}

/** Tests only: a new JavaScript lifetime, as after a reload of the web view. */
export function resetDatabasesForTests(): void {
  sqlite = null;
  checked = false;
  open.clear();
  queue = Promise.resolve();
}
