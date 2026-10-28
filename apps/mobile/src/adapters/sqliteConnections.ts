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

/** Removes a per-vault database file (vault deletion). Best effort. */
export async function deleteDatabaseFile(name: string): Promise<void> {
  await CapacitorSQLite.deleteDatabase({ database: name });
}

/** Tests only: a new JavaScript lifetime, as after a reload of the web view. */
export function resetDatabasesForTests(): void {
  sqlite = null;
  checked = false;
  open.clear();
  queue = Promise.resolve();
}
