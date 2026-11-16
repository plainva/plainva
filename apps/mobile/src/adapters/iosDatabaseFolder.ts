import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";

/**
 * On iOS the phone's databases leave `Documents` for `Library/CapacitorDatabase`
 * (open item 3.181 no. 3, release list A11).
 *
 * The SQLite plugin keeps a database as `<name>SQLite.db` in its location
 * folder, `Documents` unless `iosDatabaseLocation` says otherwise. The app
 * shares `Documents` with the Files app (`UIFileSharingEnabled`,
 * `LSSupportsOpeningDocumentsInPlace`) - that is where the vaults lie. Since
 * the databases write through a log (performance plan L4), `-wal` and `-shm`
 * stood there beside every database, and anyone could delete them. That would
 * not lose notes, but these files are more than the index: they hold the sync
 * queue, the sync states (merge bases, ETags), the deletion journal, the
 * comment and workspace queues and the calendar caches, and the log holds
 * their last committed transactions. `capacitor.config.ts` now sets
 * `iosDatabaseLocation: "Library/CapacitorDatabase"`, which the Files app does
 * not show.
 *
 * The plugin moves existing databases itself, once, at launch (before any
 * JavaScript runs), when it creates that folder - but only the `…SQLite.db`
 * files (`UtilsFile.moveAllDBSQLite`). The log and a rollback journal stay
 * behind in `Documents`; a database opened without its log has lost the
 * transactions that were not yet folded in. And a move that failed half way is
 * never tried again, because the folder exists by then. So before this
 * JavaScript lifetime opens or deletes its first database, this module puts
 * every database's files where the plugin now looks:
 *
 *  - a database still in `Documents` (the plugin's move failed, or an older
 *    build ran after the move and made a new one there): its journal and log
 *    go first, the database last. A rename inside the app's container is one
 *    step, so a kill between two files leaves the database where it was and
 *    the next start goes on with what is left; a log never waits in
 *    `Library` without its database for longer than that.
 *  - a database in BOTH places: only an older build writes `Documents`, so the
 *    copy there is the last one written and wins; the one in `Library` is
 *    removed with its files first. (A newer build never writes `Documents`.)
 *  - a log or journal left in `Documents` whose database the plugin moved:
 *    it follows its database, unless the database already has a log of its
 *    own in `Library` (then it was opened since and the old log is stale).
 *  - a log or journal whose database is nowhere: left over from a deletion,
 *    removed.
 *  - `-shm` is the log's index, rebuilt by SQLite from the log when no
 *    connection is open (as here, before the first open): it is removed, never
 *    moved.
 *
 * A database whose files could not be moved is not opened in this lifetime:
 * the plugin would make a new, empty one in `Library` while the real one,
 * with its queue, waits in `Documents` - two databases for one vault. The
 * vault runs without its index (stability plan R5, the strip on top says so),
 * and the next start tries again. If even the listing of `Documents` fails,
 * nothing is known, and no database opens. Nothing here ever deletes a
 * database that is the only copy.
 *
 * Android keeps its databases in the app's private `databases/` folder
 * (`Context.getDatabasePath`), which no other app sees: nothing to move.
 */

/** The location the plugin is configured with (`capacitor.config.ts`), below `Library`. */
export const IOS_DATABASE_FOLDER = "CapacitorDatabase";

const DB_SUFFIX = "SQLite.db";
/** Files that belong to a database and carry its data; moved with it, before it. */
const CARRIED = ["-journal", "-wal"] as const;
/** The log's index: rebuilt from the log, so removed rather than moved. */
const REBUILT = "-shm";

/** The file operations the move needs; `Documents` is "old", the plugin's folder "new". */
export interface DatabaseFolders {
  /** File names at the top of `Documents`. */
  listOld(): Promise<string[]>;
  existsNew(file: string): Promise<boolean>;
  /** Moves `Documents/<file>` to the new folder; the target does not exist. */
  moveToNew(file: string): Promise<void>;
  removeOld(file: string): Promise<void>;
  removeNew(file: string): Promise<void>;
}

export interface FolderOutcome {
  /** Database names (as the app opens them, without `SQLite.db`) that must not open. */
  refused: Set<string>;
  /** True when `Documents` could not be read: no database may open. */
  unknown: boolean;
}

function companionOf(file: string): { db: string; suffix: string } | null {
  for (const suffix of [...CARRIED, REBUILT]) {
    const tail = `${DB_SUFFIX}${suffix}`;
    if (file.endsWith(tail)) return { db: file.slice(0, -suffix.length), suffix };
  }
  return null;
}

function nameOf(dbFile: string): string {
  return dbFile.slice(0, -DB_SUFFIX.length);
}

async function removeNewSet(folders: DatabaseFolders, dbFile: string): Promise<void> {
  for (const suffix of ["", ...CARRIED, REBUILT]) {
    if (await folders.existsNew(dbFile + suffix)) await folders.removeNew(dbFile + suffix);
  }
}

/** Puts every database's files into the new folder; see the module comment. */
export async function moveDatabasesOutOfDocuments(folders: DatabaseFolders): Promise<FolderOutcome> {
  const refused = new Set<string>();
  let files: string[];
  try {
    files = await folders.listOld();
  } catch (error) {
    console.warn("[sqlite] Documents could not be listed; no database opens", error);
    return { refused, unknown: true };
  }
  const present = new Set(files);
  const databases = files.filter((file) => file.endsWith(DB_SUFFIX));

  for (const dbFile of databases) {
    try {
      // Only an older build writes Documents: its copy is the last one written.
      if (await folders.existsNew(dbFile)) await removeNewSet(folders, dbFile);
      for (const suffix of CARRIED) {
        const file = dbFile + suffix;
        if (!present.has(file)) continue;
        if (await folders.existsNew(file)) await folders.removeNew(file);
        await folders.moveToNew(file);
      }
      if (present.has(dbFile + REBUILT)) await folders.removeOld(dbFile + REBUILT);
      await folders.moveToNew(dbFile);
    } catch (error) {
      console.warn(`[sqlite] ${nameOf(dbFile)} could not leave Documents; it stays closed until the next start`, error);
      refused.add(nameOf(dbFile));
    }
  }

  for (const file of files) {
    const companion = companionOf(file);
    if (!companion || present.has(companion.db)) continue;
    try {
      const dbMoved = await folders.existsNew(companion.db);
      if (dbMoved && companion.suffix !== REBUILT && !(await folders.existsNew(file))) {
        // The plugin moved the database at launch and left its log behind.
        await folders.moveToNew(file);
      } else {
        await folders.removeOld(file);
      }
    } catch (error) {
      console.warn(`[sqlite] ${file} could not leave Documents; its database stays closed until the next start`, error);
      refused.add(nameOf(companion.db));
    }
  }
  return { refused, unknown: false };
}

/** The real folders, through the Filesystem plugin. */
export const capacitorDatabaseFolders: DatabaseFolders = {
  async listOld() {
    const { files } = await Filesystem.readdir({ path: "", directory: Directory.Documents });
    return files.filter((entry) => entry.type === "file").map((entry) => entry.name);
  },
  async existsNew(file) {
    try {
      await Filesystem.stat({ path: `${IOS_DATABASE_FOLDER}/${file}`, directory: Directory.Library });
      return true;
    } catch {
      return false;
    }
  },
  async moveToNew(file) {
    await Filesystem.rename({ from: file, directory: Directory.Documents, to: `${IOS_DATABASE_FOLDER}/${file}`, toDirectory: Directory.Library });
  },
  async removeOld(file) {
    await Filesystem.deleteFile({ path: file, directory: Directory.Documents });
  },
  async removeNew(file) {
    await Filesystem.deleteFile({ path: `${IOS_DATABASE_FOLDER}/${file}`, directory: Directory.Library });
  },
};

let outcome: Promise<FolderOutcome> | null = null;

/**
 * Resolves when the database files are in place for this lifetime (once; on
 * other platforms at once), and says why `name` must not open, if it must not.
 */
export async function databaseFolderRefusal(name: string, folders: DatabaseFolders = capacitorDatabaseFolders): Promise<Error | null> {
  if (Capacitor.getPlatform() !== "ios") return null;
  outcome ??= moveDatabasesOutOfDocuments(folders);
  const { refused, unknown } = await outcome;
  if (unknown || refused.has(name)) {
    return new Error(`Database ${name} is not opened: its files could not be moved out of Documents. The next start tries again.`);
  }
  return null;
}

/** Tests only: a new JavaScript lifetime. */
export function resetDatabaseFolderForTests(): void {
  outcome = null;
}
