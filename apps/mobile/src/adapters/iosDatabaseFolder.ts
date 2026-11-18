import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
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
 * `Documents` is shared with the Files app, so it can hold anything - an entry
 * the platform cannot even list (a broken link, a file in the middle of a
 * download). When `Documents` cannot be listed, each database asks for its
 * own files by name before it opens, and only a database whose own files
 * cannot be asked stays closed.
 *
 * A database that is deleted while it is closed here (its vault is removed,
 * a connect destination is discarded) is deleted where it lies - in
 * `Documents`, in the new folder or in both - and a mark
 * (`<name>SQLite.db.deleted`, in the new folder, or in `Documents` when the
 * new folder takes none) records the deletion first: when a file will not
 * go, the next start removes what is left before it moves anything, so a
 * deleted database is never brought back into the plugin's folder. Only when
 * neither mark can be written and a file will not go either does the
 * deletion fail; the vault's deletion then names the index as not removed.
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
  existsOld(file: string): Promise<boolean>;
  /** False only when the platform says the file is missing; any other failure throws. */
  existsNew(file: string): Promise<boolean>;
  /** Moves `Documents/<file>` to the new folder; the target does not exist. */
  moveToNew(file: string): Promise<void>;
  removeOld(file: string): Promise<void>;
  removeNew(file: string): Promise<void>;
  /** Writes a small file into the new folder (a deletion mark). */
  writeNew(file: string, text: string): Promise<void>;
  /** Writes a small file into `Documents` (the deletion mark when the new folder takes none). */
  writeOld(file: string, text: string): Promise<void>;
}

export interface FolderOutcome {
  /** Database names (as the app opens them, without `SQLite.db`) that must not open. */
  refused: Set<string>;
  /** True when the new folder could not be read: no database may open. */
  unknown: boolean;
  /**
   * The names in the new folder after the sweep. Set when `Documents` could
   * not be listed: each database then puts its own files in place by name.
   */
  unlisted: Set<string> | null;
}

/** The suffixes of the files beside a database, in the order they are removed. */
const COMPANIONS = [REBUILT, ...CARRIED] as const;
/** The mark of a database deleted while it was closed; see the module comment. */
const DELETED = ".deleted";

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

/** Every file of a database in both folders, each folder's database last; asked by name, so no listing is needed. */
async function removeEverywhere(folders: DatabaseFolders, dbFile: string): Promise<void> {
  await removeNewSet(folders, dbFile);
  for (const suffix of [...COMPANIONS, ""]) {
    if (await folders.existsOld(dbFile + suffix)) await folders.removeOld(dbFile + suffix);
  }
}

/** Removes what is left of a deleted database, then its mark; false when something stays. */
async function finishDeletion(folders: DatabaseFolders, dbFile: string, removeMark: () => Promise<void>): Promise<boolean> {
  try {
    await removeEverywhere(folders, dbFile);
    await removeMark();
    return true;
  } catch (error) {
    // silent: the mark stays and the name stays closed; the next start removes the rest before anything opens.
    console.warn(`[sqlite] ${nameOf(dbFile)} was deleted, but not all its files went; it stays closed until the next start`, error);
    return false;
  }
}

/**
 * Puts these files of `Documents` into the new folder (the rules of the module
 * comment); `files` is the listing of `Documents`, or the files of one
 * database asked for by name.
 */
async function placeFiles(folders: DatabaseFolders, files: readonly string[], presentNew: ReadonlySet<string>, refused: Set<string>): Promise<void> {
  const present = new Set(files);
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
}

/** Puts every database's files into the new folder; see the module comment. */
export async function moveDatabasesOutOfDocuments(folders: DatabaseFolders): Promise<FolderOutcome> {
  const refused = new Set<string>();
  let newFiles: string[];
  try {
    newFiles = await folders.listNew();
  } catch (error) {
    console.warn("[sqlite] the database folder could not be listed; no database opens", error);
    return { refused, unknown: true, unlisted: null };
  }

  // Deletions owed by an earlier lifetime come first: nothing of them may move.
  const owed = newFiles.filter((file) => file.endsWith(`${DB_SUFFIX}${DELETED}`));
  for (const mark of owed) {
    const dbFile = mark.slice(0, -DELETED.length);
    if (!(await finishDeletion(folders, dbFile, () => folders.removeNew(mark)))) refused.add(nameOf(dbFile));
  }
  if (owed.length > 0) {
    try {
      newFiles = await folders.listNew();
    } catch (error) {
      console.warn("[sqlite] the database folder could not be listed; no database opens", error);
      return { refused, unknown: true, unlisted: null };
    }
  }
  const presentNew = new Set(newFiles);

  // Companions in the new folder without their database: never ours to keep.
  for (const file of newFiles) {
    const companion = companionOf(file);
    if (!companion || presentNew.has(companion.db)) continue;
    try {
      await folders.removeNew(file);
      presentNew.delete(file);
    } catch (error) {
      console.warn(`[sqlite] ${file} without its database could not be removed; its database stays closed until the next start`, error);
      refused.add(nameOf(companion.db));
    }
  }

  let files: string[];
  try {
    files = await folders.listOld();
  } catch (error) {
    // Documents is shared with the Files app; one entry it cannot list must not close every database.
    console.warn("[sqlite] Documents could not be listed; each database looks for its own files", error);
    return { refused, unknown: false, unlisted: presentNew };
  }
  const deletedHere = new Set<string>();
  for (const mark of files.filter((file) => file.endsWith(`${DB_SUFFIX}${DELETED}`))) {
    const dbFile = mark.slice(0, -DELETED.length);
    deletedHere.add(dbFile);
    if (!(await finishDeletion(folders, dbFile, () => folders.removeOld(mark)))) refused.add(nameOf(dbFile));
  }
  const remaining = files.filter((file) => {
    const dbFile = file.endsWith(DELETED) ? file.slice(0, -DELETED.length) : (companionOf(file)?.db ?? file);
    return !deletedHere.has(dbFile);
  });
  await placeFiles(folders, remaining, presentNew, refused);
  return { refused, unknown: false, unlisted: null };
}

async function exists(path: string, directory: Directory): Promise<boolean> {
  try {
    await Filesystem.stat({ path, directory });
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
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
  existsOld: (file) => exists(file, Directory.Documents),
  existsNew: (file) => exists(`${IOS_DATABASE_FOLDER}/${file}`, Directory.Library),
  async moveToNew(file) {
    await Filesystem.rename({ from: file, directory: Directory.Documents, to: `${IOS_DATABASE_FOLDER}/${file}`, toDirectory: Directory.Library });
  },
  async removeOld(file) {
    await Filesystem.deleteFile({ path: file, directory: Directory.Documents });
  },
  async removeNew(file) {
    await Filesystem.deleteFile({ path: `${IOS_DATABASE_FOLDER}/${file}`, directory: Directory.Library });
  },
  async writeNew(file, text) {
    await Filesystem.writeFile({ path: `${IOS_DATABASE_FOLDER}/${file}`, directory: Directory.Library, data: text, encoding: Encoding.UTF8, recursive: true });
  },
  async writeOld(file, text) {
    await Filesystem.writeFile({ path: file, directory: Directory.Documents, data: text, encoding: Encoding.UTF8 });
  },
};

let outcome: Promise<FolderOutcome> | null = null;
/** Per name, when `Documents` could not be listed: its own files put in place (once per lifetime). */
const byName = new Map<string, Promise<void>>();

async function settled(name: string, folders: DatabaseFolders): Promise<FolderOutcome> {
  outcome ??= moveDatabasesOutOfDocuments(folders);
  const result = await outcome;
  const { unlisted, refused } = result;
  if (unlisted && !refused.has(name)) {
    let placing = byName.get(name);
    if (!placing) {
      placing = (async () => {
        const dbFile = `${name}${DB_SUFFIX}`;
        const own: string[] = [];
        try {
          if (await folders.existsOld(dbFile + DELETED)) {
            if (!(await finishDeletion(folders, dbFile, () => folders.removeOld(dbFile + DELETED)))) refused.add(name);
            return;
          }
          for (const suffix of ["", ...COMPANIONS]) if (await folders.existsOld(dbFile + suffix)) own.push(dbFile + suffix);
        } catch (error) {
          console.warn(`[sqlite] the files of ${name} in Documents could not be asked for; it stays closed until the next start`, error);
          refused.add(name);
          return;
        }
        await placeFiles(folders, own, unlisted, refused);
      })();
      byName.set(name, placing);
    }
    await placing;
  }
  return result;
}

/**
 * Resolves when the database files are in place for this lifetime (once; on
 * other platforms at once), and says why `name` must not open, if it must not.
 */
export async function databaseFolderRefusal(name: string, folders: DatabaseFolders = capacitorDatabaseFolders): Promise<Error | null> {
  if (Capacitor.getPlatform() !== "ios") return null;
  const { refused, unknown } = await settled(name, folders);
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
  const { refused } = await settled(name, folders);
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

/**
 * Deletes a database that is closed in this lifetime because its files could
 * not be put in place: wherever its files lie, without the plugin (which would
 * look only in its own folder). The deletion is marked first, so what will
 * not go now goes at the next start, before anything moves; the name stays
 * closed until then. Throws when not even the mark can be written.
 */
export async function deleteClosedDatabase(name: string, folders: DatabaseFolders = capacitorDatabaseFolders): Promise<void> {
  const { refused } = await settled(name, folders);
  const dbFile = `${name}${DB_SUFFIX}`;
  refused.add(name);
  const mark = dbFile + DELETED;
  let removeMark: (() => Promise<void>) | null = null;
  try {
    await folders.writeNew(mark, "");
    removeMark = () => folders.removeNew(mark);
  } catch (error) {
    console.warn(`[sqlite] the deletion mark of ${name} could not be written in the database folder; trying Documents`, error);
    try {
      await folders.writeOld(mark, "");
      removeMark = () => folders.removeOld(mark);
    } catch (second) {
      // Without a mark the deletion is still made; only if a file will not go either does it fail.
      console.warn(`[sqlite] no deletion mark of ${name} could be written`, second);
    }
  }
  await removeEverywhere(folders, dbFile);
  if (removeMark) {
    try {
      await removeMark();
    } catch (error) {
      // The database is gone; the mark goes at the next start, before anything opens.
      console.warn(`[sqlite] the deletion mark of ${name} stays until the next start`, error);
      return;
    }
  }
  // Nothing of it is left anywhere: a new database of that name may open.
  refused.delete(name);
}

/** Tests only: a new JavaScript lifetime. */
export function resetDatabaseFolderForTests(): void {
  outcome = null;
  byName.clear();
}
