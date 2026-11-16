import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { isMissingFile } from "./fileErrors";

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
 * The plugin would move existing databases itself when it creates that
 * folder at launch - but only the `…SQLite.db` files (`UtilsFile.moveAllDBSQLite`),
 * leaving the log and a rollback journal in `Documents`, and it excludes the
 * folder from the iCloud backup while the notes stay in it. So the app makes
 * the folder before the plugin loads and keeps it in the backup
 * (`MainViewController.swift`, `DatabaseFolder`), and the plugin moves
 * nothing. Before this JavaScript lifetime opens or deletes its first
 * database, this module puts every database's files where the plugin now
 * looks:
 *
 *  - a log, journal or log index in the new folder whose database is not
 *    there: no move of this module leaves one (the database always goes
 *    first), so it is left from a deletion or a removal that ended half way.
 *    It is removed first - SQLite would replay it into the next database of
 *    that name.
 *  - a database still in `Documents` (written by a build before this one, or
 *    by an older build after it): if the new folder holds that database too,
 *    the copy in `Documents` is the last one written - only an older build
 *    writes there - and the one in the new folder goes, its log first and the
 *    database last. Then the database moves, then its journal and log, and its
 *    log index is removed. A rename inside the app's container is one step,
 *    so a start that ends in between leaves the database in the new folder
 *    and its log in `Documents`, which the next start brings after it.
 *  - a log or journal left in `Documents` whose database is in the new folder:
 *    it follows its database, unless the database already has a log of its
 *    own there (then it was opened since and the old log is stale).
 *  - a log or journal whose database is nowhere: left over from a deletion,
 *    removed.
 *  - `-shm` is the log's index, rebuilt by SQLite from the log when no
 *    connection is open (as here, before the first open): it is removed, never
 *    moved.
 *
 * Only a file the platform calls missing counts as missing; any other answer
 * leaves the database's files where they are, and the database closed until
 * the next start.
 *
 * A database whose files could not be moved is not opened in this lifetime:
 * the plugin would make a new, empty one in `Library` while the real one,
 * with its queue, waits in `Documents` - two databases for one vault. The
 * vault runs without its index (stability plan R5, the strip on top says so),
 * and the next start tries again. If even a folder cannot be listed,
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
  /** File names in the new folder; none when it does not exist. */
  listNew(): Promise<string[]>;
  /** False only when the platform says the file is missing; any other failure throws. */
  existsNew(file: string): Promise<boolean>;
  /** Moves `Documents/<file>` to the new folder; the target does not exist. */
  moveToNew(file: string): Promise<void>;
  removeOld(file: string): Promise<void>;
  removeNew(file: string): Promise<void>;
}

export interface FolderOutcome {
  /** Database names (as the app opens them, without `SQLite.db`) that must not open. */
  refused: Set<string>;
  /** True when a folder could not be read: no database may open. */
  unknown: boolean;
}

/** The suffixes of the files beside a database, in the order they are removed. */
const COMPANIONS = [REBUILT, ...CARRIED] as const;

function companionOf(file: string): { db: string; suffix: string } | null {
  for (const suffix of COMPANIONS) {
    const tail = `${DB_SUFFIX}${suffix}`;
    if (file.endsWith(tail)) return { db: file.slice(0, -suffix.length), suffix };
  }
  return null;
}

function nameOf(dbFile: string): string {
  return dbFile.slice(0, -DB_SUFFIX.length);
}

/** The files of a database in the new folder: its companions first, the database last. */
async function removeNewSet(folders: DatabaseFolders, dbFile: string): Promise<void> {
  for (const suffix of [...COMPANIONS, ""]) {
    if (await folders.existsNew(dbFile + suffix)) await folders.removeNew(dbFile + suffix);
  }
}

/** Puts every database's files into the new folder; see the module comment. */
export async function moveDatabasesOutOfDocuments(folders: DatabaseFolders): Promise<FolderOutcome> {
  const refused = new Set<string>();
  let files: string[];
  let newFiles: string[];
  try {
    files = await folders.listOld();
    newFiles = await folders.listNew();
  } catch (error) {
    console.warn("[sqlite] the database folders could not be listed; no database opens", error);
    return { refused, unknown: true };
  }
  const present = new Set(files);
  const presentNew = new Set(newFiles);

  // Companions in the new folder without their database: never ours to keep.
  for (const file of newFiles) {
    const companion = companionOf(file);
    if (!companion || presentNew.has(companion.db)) continue;
    try {
      await folders.removeNew(file);
    } catch (error) {
      console.warn(`[sqlite] ${file} without its database could not be removed; its database stays closed until the next start`, error);
      refused.add(nameOf(companion.db));
    }
  }

  for (const dbFile of files.filter((file) => file.endsWith(DB_SUFFIX))) {
    if (refused.has(nameOf(dbFile))) continue;
    try {
      // Only an older build writes Documents: its copy is the last one written.
      if (presentNew.has(dbFile) || (await folders.existsNew(dbFile))) await removeNewSet(folders, dbFile);
      if (present.has(dbFile + REBUILT)) await folders.removeOld(dbFile + REBUILT);
      await folders.moveToNew(dbFile);
      for (const suffix of CARRIED) {
        if (present.has(dbFile + suffix)) await folders.moveToNew(dbFile + suffix);
      }
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
        // A start that ended between the database and its log.
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
  async listNew() {
    try {
      const { files } = await Filesystem.readdir({ path: IOS_DATABASE_FOLDER, directory: Directory.Library });
      return files.filter((entry) => entry.type === "file").map((entry) => entry.name);
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  },
  async existsNew(file) {
    try {
      await Filesystem.stat({ path: `${IOS_DATABASE_FOLDER}/${file}`, directory: Directory.Library });
      return true;
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
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

/**
 * After the plugin deleted a database (it removes the database file alone on
 * iOS), removes the files beside it, so a new database of that name never
 * replays an old log. When that fails, the name stays closed until the next
 * start, whose sweep removes them before anything opens.
 */
export async function removeDatabaseLeftovers(name: string, folders: DatabaseFolders = capacitorDatabaseFolders): Promise<void> {
  if (Capacitor.getPlatform() !== "ios") return;
  outcome ??= moveDatabasesOutOfDocuments(folders);
  const { refused } = await outcome;
  try {
    for (const suffix of COMPANIONS) {
      const file = `${name}${DB_SUFFIX}${suffix}`;
      if (await folders.existsNew(file)) await folders.removeNew(file);
    }
  } catch (error) {
    refused.add(name);
    throw error;
  }
}

/** Tests only: a new JavaScript lifetime. */
export function resetDatabaseFolderForTests(): void {
  outcome = null;
}
