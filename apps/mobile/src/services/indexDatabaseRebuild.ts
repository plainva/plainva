import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { finishSetAside, SET_ASIDE_MARKER, setAsideIndexDatabase, type IndexDatabaseFiles } from "@plainva/ui";
import { IOS_DATABASE_FOLDER } from "../adapters/iosDatabaseFolder";
import { isMissingFile } from "../adapters/fileErrors";
import { withDatabaseClosed } from "../adapters/sqliteConnections";

/**
 * The phone's side of the start's "Rebuild index" (both shells,
 * `setAsideIndexDatabase` in packages/ui): a damaged index database is set
 * aside where the plugin keeps it, under a name the plugin and the iOS
 * folder sweep never take for a database or its companion
 * (`<name>SQLite.db.broken-<time>`, `…-wal`), and an empty one takes its
 * place; the vault opens again with its index built anew.
 *
 * Where the plugin keeps its files: on iOS `Library/CapacitorDatabase`
 * (`capacitor.config.ts`), on Android the app's private `databases/` folder
 * beside `files/` (`Context.getDatabasePath`), reached by its path.
 */

const DB_SUFFIX = "SQLite.db";

interface DatabaseFolder {
  /** The path of a file in the folder, as the Filesystem plugin takes it with `directory`. */
  path(file: string): string;
  directory?: Directory;
}

async function databaseFolder(): Promise<DatabaseFolder> {
  if (Capacitor.getPlatform() === "ios") {
    return { path: (file) => `${IOS_DATABASE_FOLDER}/${file}`, directory: Directory.Library };
  }
  const { uri } = await Filesystem.getUri({ path: "", directory: Directory.Data });
  const databases = androidDatabasesFolder(uri);
  return { path: (file) => `${databases}/${file}` };
}

/**
 * Android: `files/` and `databases/` lie side by side in the app's own data
 * folder; from the uri of `files/` (with or without slashes at its end), the
 * uri of `databases/`.
 */
export function androidDatabasesFolder(filesUri: string): string {
  let root = filesUri;
  while (root.endsWith("/")) root = root.slice(0, -1);
  if (root.endsWith("/files")) root = root.slice(0, -"/files".length);
  return `${root}/databases`;
}

function filesIn(folder: DatabaseFolder): IndexDatabaseFiles {
  const at = (file: string) => ({ path: folder.path(file), ...(folder.directory ? { directory: folder.directory } : {}) });
  return {
    async exists(file) {
      try {
        await Filesystem.stat(at(file));
        return true;
      } catch (error) {
        if (isMissingFile(error)) return false;
        throw error;
      }
    },
    async rename(from, to) {
      await Filesystem.rename({
        from: folder.path(from),
        to: folder.path(to),
        ...(folder.directory ? { directory: folder.directory, toDirectory: folder.directory } : {}),
      });
    },
    async writeEmpty(file) {
      await Filesystem.writeFile({ ...at(file), data: "", encoding: Encoding.UTF8 });
    },
    async listStartingWith(prefix) {
      return (await namesIn(folder)).filter((name) => name.startsWith(prefix));
    },
    async remove(file) {
      await Filesystem.deleteFile(at(file));
    },
    async readText(file) {
      try {
        const { data } = await Filesystem.readFile({ ...at(file), encoding: Encoding.UTF8 });
        return typeof data === "string" ? data : null;
      } catch (error) {
        if (isMissingFile(error)) return null;
        throw error;
      }
    },
    async writeText(file, text) {
      await Filesystem.writeFile({ ...at(file), data: text, encoding: Encoding.UTF8 });
    },
  };
}

/** The file names in the plugin's database folder; none where it does not exist yet. */
async function namesIn(folder: DatabaseFolder): Promise<string[]> {
  const listed = await Filesystem.readdir({ path: folder.path(""), ...(folder.directory ? { directory: folder.directory } : {}) })
    .catch((error: unknown) => {
      if (isMissingFile(error)) return { files: [] };
      throw error;
    });
  return listed.files.map((entry) => (typeof entry === "string" ? entry : entry.name));
}

/**
 * Sets the damaged index database `name` (as the app opens it) aside and
 * leaves an empty one; nothing holds it while it moves (`withDatabaseClosed`).
 * Returns the file name it was set aside under.
 */
export async function setAsideMobileIndexDatabase(name: string): Promise<string> {
  const folder = await databaseFolder();
  return withDatabaseClosed(name, () => setAsideIndexDatabase(filesIn(folder), `${name}${DB_SUFFIX}`));
}

/**
 * Before the index database `name` is opened: a set-aside that stopped
 * half-way is finished (`finishSetAside`), so the database never opens
 * without its log. Nothing holds it then; the open comes after.
 */
export async function finishMobileSetAside(name: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const folder = await databaseFolder();
  await finishSetAside(filesIn(folder), `${name}${DB_SUFFIX}`);
}

/** Whether the index database `name` was set aside here before: the one there now was built anew (`restoreMobileAccountsAfterRebuild`). */
export async function mobileIndexDatabaseWasRebuilt(name: string): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false;
  const folder = await databaseFolder();
  return (await namesIn(folder).catch(() => [])).some((file) => file.startsWith(`${name}${DB_SUFFIX}${SET_ASIDE_MARKER}`));
}

/** Removes every copy of `name` set aside as damaged (a vault forgotten on this device: they hold the notes' text too). */
export async function removeSetAsideMobileIndexDatabases(name: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const folder = await databaseFolder();
  for (const file of await namesIn(folder)) {
    if (!file.startsWith(`${name}${DB_SUFFIX}${SET_ASIDE_MARKER}`)) continue;
    await Filesystem.deleteFile({ path: folder.path(file), ...(folder.directory ? { directory: folder.directory } : {}) });
  }
}
