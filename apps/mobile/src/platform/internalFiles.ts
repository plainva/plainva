import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { isExistingDirectory, isMissingFile } from "../adapters/fileErrors";

/**
 * Where the app keeps the files that belong to it, not to the person
 * (release list A11, the class of the database move): the drafts of unsaved
 * notes and the unfinished comment operations (`drafts/`), the journals of a
 * profile import and of an OKF conversion (`profile-journal/`,
 * `okf-journal/`), and the AI conversations per vault (`ai/`).
 *
 * They were written to `Directory.Data`. On Android that is the app's private
 * `files/` folder, which no other app sees - nothing changes there. On iOS it
 * is `Documents`, which the app shares with the Files app (that is where the
 * vaults lie), so anyone could delete a draft, an open operation or a
 * conversation there. On iOS they now live in `Library/PlainvaData`: not shown
 * by the Files app, and - unlike `Library/Caches` - part of the iCloud backup,
 * as they were in `Documents`. No reader lies outside the app: the widget,
 * the share extension and the shortcuts use the app group container.
 *
 * The move runs once per JavaScript lifetime, before the first of these files
 * is read or written (`internalPlace` waits for it), one folder at a time:
 *
 *  - only `Documents/<folder>`: the whole folder is renamed into place - one
 *    step, so a start that ends there finds it either here or there.
 *  - both (an older build ran after a newer one and wrote `Documents` again):
 *    file by file. A file only in `Documents` moves; where both hold a file,
 *    the one written last stays and the other is removed - a newer state is
 *    never replaced by an older one. Each step is a rename or a removal, so a
 *    start that ends in between leaves files the next start sorts the same
 *    way. Folders left empty in `Documents` are removed.
 *  - a folder that could not be renamed stays where it is and is used there
 *    for this lifetime; the next start tries again. A file that could not move
 *    during a merge stays in `Documents` until the next start; the files
 *    already moved are read from the new place.
 */

// "backup": the mark of a vault archive's try (`vaultBackup.ts`), written with fsync before the try reads the vault.
export const INTERNAL_FOLDERS = ["drafts", "profile-journal", "okf-journal", "ai", "backup"] as const;
export type InternalFolder = (typeof INTERNAL_FOLDERS)[number];

/** The folder below `Library` that holds them on iOS. */
export const IOS_INTERNAL_FOLDER = "PlainvaData";

export interface InternalPlace {
  directory: Directory;
  path: string;
}

/** A file found below a folder: its path relative to that folder, and when it was last written. */
export interface FoundFile {
  rel: string;
  mtime: number;
}

/** The file operations the move needs; `Documents` is "old", `Library/PlainvaData` "new". */
export interface InternalFolders {
  /** False only when the platform calls the path missing; anything else throws. */
  existsOld(path: string): Promise<boolean>;
  existsNew(path: string): Promise<boolean>;
  /** Every file below a folder, recursively. */
  listOld(folder: string): Promise<FoundFile[]>;
  /** When a file in the new place was last written. */
  mtimeNew(path: string): Promise<number>;
  /** Makes a folder in the new place, with its parents; one that exists is fine. */
  makeNewFolder(path: string): Promise<void>;
  /** Renames `Documents/<path>` to the same path in the new place; the target does not exist. */
  moveToNew(path: string): Promise<void>;
  removeOld(path: string): Promise<void>;
  removeNew(path: string): Promise<void>;
  /** Removes a folder in `Documents` that holds no file any more. */
  removeOldFolder(path: string): Promise<void>;
}

export interface InternalOutcome {
  /** Folders that stay in `Documents` for this lifetime. */
  stayed: Set<InternalFolder>;
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

async function mergeFolder(folders: InternalFolders, folder: InternalFolder): Promise<void> {
  const files = await folders.listOld(folder);
  for (const file of files) {
    const path = `${folder}/${file.rel}`;
    try {
      if (await folders.existsNew(path)) {
        // The one written last stays; on a tie, the one already in place.
        if (file.mtime <= (await folders.mtimeNew(path))) {
          await folders.removeOld(path);
          continue;
        }
        await folders.removeNew(path);
      }
      await folders.makeNewFolder(parentOf(path));
      await folders.moveToNew(path);
    } catch (error) {
      console.warn(`[internal-files] ${path} stays in Documents until the next start`, error);
    }
  }
  if ((await folders.listOld(folder)).length === 0) await folders.removeOldFolder(folder);
}

/** Moves the app's own files out of `Documents`; see the module comment. */
export async function moveInternalFilesOutOfDocuments(folders: InternalFolders): Promise<InternalOutcome> {
  const stayed = new Set<InternalFolder>();
  for (const folder of INTERNAL_FOLDERS) {
    try {
      if (!(await folders.existsOld(folder))) continue;
      if (await folders.existsNew(folder)) {
        await mergeFolder(folders, folder);
        continue;
      }
      await folders.makeNewFolder("");
      await folders.moveToNew(folder);
    } catch (error) {
      console.warn(`[internal-files] ${folder} could not leave Documents; it is used there until the next start`, error);
      // Used where it is only while nothing of it is in the new place yet.
      if (!(await folders.existsNew(folder).catch(() => true))) stayed.add(folder);
    }
  }
  return { stayed };
}

const under = (path: string) => (path ? `${IOS_INTERNAL_FOLDER}/${path}` : IOS_INTERNAL_FOLDER);

async function exists(path: string, directory: Directory): Promise<boolean> {
  try {
    await Filesystem.stat({ path, directory });
    return true;
  } catch (error) {
    if (isMissingFile(error)) return false;
    throw error;
  }
}

async function listFiles(path: string, prefix = ""): Promise<FoundFile[]> {
  const { files } = await Filesystem.readdir({ path, directory: Directory.Documents });
  const found: FoundFile[] = [];
  for (const entry of files) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.type === "directory") found.push(...(await listFiles(`${path}/${entry.name}`, rel)));
    else found.push({ rel, mtime: typeof entry.mtime === "number" ? entry.mtime : 0 });
  }
  return found;
}

/** The real folders, through the Filesystem plugin. */
export const capacitorInternalFolders: InternalFolders = {
  existsOld: (path) => exists(path, Directory.Documents),
  existsNew: (path) => exists(under(path), Directory.Library),
  listOld: (folder) => listFiles(folder),
  async mtimeNew(path) {
    const info = await Filesystem.stat({ path: under(path), directory: Directory.Library });
    return typeof info.mtime === "number" ? info.mtime : 0;
  },
  async makeNewFolder(path) {
    try {
      await Filesystem.mkdir({ path: under(path), directory: Directory.Library, recursive: true });
    } catch (error) {
      if (!isExistingDirectory(error)) throw error;
    }
  },
  async moveToNew(path) {
    await Filesystem.rename({ from: path, directory: Directory.Documents, to: under(path), toDirectory: Directory.Library });
  },
  async removeOld(path) {
    await Filesystem.deleteFile({ path, directory: Directory.Documents });
  },
  async removeNew(path) {
    await Filesystem.deleteFile({ path: under(path), directory: Directory.Library });
  },
  async removeOldFolder(path) {
    await Filesystem.rmdir({ path, directory: Directory.Documents, recursive: true });
  },
};

let outcome: Promise<InternalOutcome> | null = null;

function folderOf(rel: string): InternalFolder {
  const first = rel.split("/", 1)[0];
  const folder = INTERNAL_FOLDERS.find((name) => name === first);
  if (!folder) throw new Error(`${rel} is not below one of the app's own folders`);
  return folder;
}

/**
 * Where an app-owned file lies: `rel` starts with one of `INTERNAL_FOLDERS`.
 * On iOS the first call moves the folders (once per lifetime).
 */
export async function internalPlace(rel: string, folders: InternalFolders = capacitorInternalFolders): Promise<InternalPlace> {
  const folder = folderOf(rel);
  if (Capacitor.getPlatform() !== "ios") return { directory: Directory.Data, path: rel };
  outcome ??= moveInternalFilesOutOfDocuments(folders);
  const { stayed } = await outcome;
  if (stayed.has(folder)) return { directory: Directory.Data, path: rel };
  return { directory: Directory.Library, path: under(rel) };
}

/** Tests only: a new JavaScript lifetime. */
export function resetInternalFilesForTests(): void {
  outcome = null;
}
