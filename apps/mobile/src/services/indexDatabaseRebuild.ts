import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { SET_ASIDE_MARKER, setAsideIndexDatabase, type IndexDatabaseFiles } from "@plainva/ui";
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
  // Android: `files/` and `databases/` lie side by side in the app's own data folder.
  const { uri } = await Filesystem.getUri({ path: "", directory: Directory.Data });
  const root = uri.replace(/\/+$/, "").replace(/\/files$/, "");
  return { path: (file) => `${root}/databases/${file}` };
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
  };
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

/** Removes every copy of `name` set aside as damaged (a vault forgotten on this device: they hold the notes' text too). */
export async function removeSetAsideMobileIndexDatabases(name: string): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const folder = await databaseFolder();
  const listed = await Filesystem.readdir({ path: folder.path(""), ...(folder.directory ? { directory: folder.directory } : {}) })
    .catch((error: unknown) => {
      if (isMissingFile(error)) return { files: [] };
      throw error;
    });
  for (const entry of listed.files) {
    const file = typeof entry === "string" ? entry : entry.name;
    if (!file.startsWith(`${name}${DB_SUFFIX}${SET_ASIDE_MARKER}`)) continue;
    await Filesystem.deleteFile({ path: folder.path(file), ...(folder.directory ? { directory: folder.directory } : {}) });
  }
}
