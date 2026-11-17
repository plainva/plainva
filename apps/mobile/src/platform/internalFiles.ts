import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { decodeDraftJournal, mergeDraftJournals } from "@plainva/ui";
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
 *    file by file. A file only in `Documents` moves. Where both hold a draft
 *    journal (`drafts/<vault>/<note>.json`, one entry per session), the two
 *    become one with every entry of either (`mergeDraftJournals`): each copy
 *    holds drafts the other does not, so a journal is never decided by its
 *    time. When one copy cannot be read or is no journal, both stay as they
 *    are - nothing is written over either - and the readable one is used
 *    until a later start can join them. Before the joined copy's original in
 *    `Documents` goes, a mark (`.joined/<path>` in the new place, holding that
 *    copy's time) says it is joined already: when the removal fails, the next
 *    start only removes it, and a draft discarded in between stays discarded.
 *    Where both hold any other file, the one written last stays and the other
 *    is removed - a newer state is never replaced by an older one. Each step
 *    is a rename, a removal or an atomic write, so a start that ends in
 *    between leaves files the next start sorts the same way. Folders left
 *    empty in `Documents` are removed.
 *  - a folder that could not be renamed stays where it is and is used there
 *    for this lifetime; the next start tries again.
 *  - what stays in `Documents` during a merge is still read there in this
 *    lifetime: a file whose copy in `Documents` is the one to keep but could
 *    not move, and - when the merge broke off (a listing failed) - every file
 *    that is still in `Documents`. A reader never takes "not in the new place"
 *    for "not there": an interrupted profile import would lose the way back,
 *    and the next start would keep the newer, empty answer. A listing of such
 *    a folder shows both places (`listInternalFolder`).
 */

export const INTERNAL_FOLDERS = ["drafts", "profile-journal", "okf-journal", "ai"] as const;
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
  /** When it was last written; null where the platform does not say - unknown, never "oldest". */
  mtime: number | null;
}

/** The file operations the move needs; `Documents` is "old", `Library/PlainvaData` "new". */
export interface InternalFolders {
  /** False only when the platform calls the path missing; anything else throws. */
  existsOld(path: string): Promise<boolean>;
  existsNew(path: string): Promise<boolean>;
  /** Every file below a folder, recursively. */
  listOld(folder: string): Promise<FoundFile[]>;
  /** When a file in the new place was last written; null where the platform does not say. */
  mtimeNew(path: string): Promise<number | null>;
  readOld(path: string): Promise<string>;
  readNew(path: string): Promise<string>;
  /** Replaces a file in the new place as one step (atomic). */
  writeNew(path: string, text: string): Promise<void>;
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
  /** Files whose copy in `Documents` is the one to use in this lifetime. */
  pending: Set<string>;
  /** Folders whose merge broke off: a file still in `Documents` is used there. */
  split: Set<InternalFolder>;
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut < 0 ? "" : path.slice(0, cut);
}

/** A draft journal, one entry per session: joined rather than replaced. */
const DRAFT_JOURNAL = /^drafts\/[^/]+\/[^/]+\.json$/;

/**
 * The mark of a journal whose copy in `Documents` is joined into the new one
 * already: it holds that copy's time, so a later start only removes the copy -
 * joining it again would bring back an entry discarded in between.
 */
const joinedMark = (path: string) => `.joined/${path}`;

/** A copy's text when it reads as a draft journal; `null` when it cannot be read or is no journal. */
async function journalText(read: () => Promise<string>): Promise<string | null> {
  try {
    const raw = await read();
    decodeDraftJournal(raw);
    return raw;
  } catch {
    return null;
  }
}

/**
 * Both copies of a draft journal (see the module comment). A journal is never
 * decided by its time: both copies are joined, or - when one cannot be read
 * or is no journal - both stay as they are, and the readable one is used in
 * this lifetime (`true`: the copy in `Documents`).
 */
async function sortJournal(folders: InternalFolders, path: string, oldTime: number | null, newExists: boolean): Promise<boolean> {
  const mark = joinedMark(path);
  // The mark decides, whether or not a file stands in the new place now: a copy whose joining is
  // marked is never brought in again - only removed, and the mark goes with it. (Every entry of
  // the joined journal may have been discarded since, and the file in the new place with them.)
  if (oldTime !== null && await folders.existsNew(mark)) {
    if ((await folders.readNew(mark)) === String(oldTime)) {
      await folders.removeOld(path);
      await folders.removeNew(mark);
      return false;
    }
    // The copy in Documents was written again since (an older build ran once more): join it.
    await folders.removeNew(mark);
  }
  const old = await journalText(() => folders.readOld(path));
  if (!newExists) {
    // Only in Documents. A copy that is no journal is never put in the journal's place, where it
    // would refuse every new draft of the note: it stays where it is, and nothing waits on it.
    if (old === null) {
      console.warn(`[internal-files] ${path} in Documents is no draft journal; it stays there`);
      return false;
    }
    await folders.makeNewFolder(parentOf(path));
    await folders.moveToNew(path);
    return false;
  }
  const current = await journalText(() => folders.readNew(path));
  if (old === null || current === null) {
    console.warn(`[internal-files] ${path} is in both places and one copy cannot be read; both stay until the next start`);
    return old !== null;
  }
  const both = mergeDraftJournals(old, current);
  if (both === null) return false;
  await folders.writeNew(path, both);
  // Without a known time the mark could not tell this copy from a later one: joined again next time instead.
  if (oldTime !== null) {
    try {
      await folders.writeNew(mark, String(oldTime));
    } catch (error) {
      // silent: without the mark a failed removal below is joined again at the next start - nothing is lost, a discarded draft may be offered once more.
      console.warn(`[internal-files] the joined mark of ${path} could not be written`, error);
    }
  }
  await folders.removeOld(path);
  if (oldTime !== null) await folders.removeNew(mark);
  return false;
}

async function mergeFolder(folders: InternalFolders, folder: InternalFolder, pending: Set<string>): Promise<void> {
  const files = await folders.listOld(folder);
  for (const file of files) {
    const path = `${folder}/${file.rel}`;
    // Whether the copy in Documents is the one to use if a step fails.
    let oldCounts = true;
    try {
      if (DRAFT_JOURNAL.test(path)) {
        oldCounts = false;
        if (await sortJournal(folders, path, file.mtime, await folders.existsNew(path))) pending.add(path);
        continue;
      }
      if (await folders.existsNew(path)) {
        const newTime = await folders.mtimeNew(path);
        // Without both times nothing is known to be older: neither copy goes, the one in place is used.
        if (file.mtime === null || newTime === null) {
          oldCounts = false;
          continue;
        }
        // The one written last stays; on a tie, the one already in place.
        if (file.mtime <= newTime) {
          oldCounts = false;
          await folders.removeOld(path);
          continue;
        }
        await folders.removeNew(path);
      }
      await folders.makeNewFolder(parentOf(path));
      await folders.moveToNew(path);
    } catch (error) {
      console.warn(`[internal-files] ${path} stays in Documents until the next start`, error);
      if (oldCounts) pending.add(path);
    }
  }
  try {
    if ((await folders.listOld(folder)).length === 0) await folders.removeOldFolder(folder);
  } catch (error) {
    console.warn(`[internal-files] the empty ${folder} in Documents stays until the next start`, error);
  }
}

/** Moves the app's own files out of `Documents`; see the module comment. */
export async function moveInternalFilesOutOfDocuments(folders: InternalFolders): Promise<InternalOutcome> {
  const stayed = new Set<InternalFolder>();
  const pending = new Set<string>();
  const split = new Set<InternalFolder>();
  for (const folder of INTERNAL_FOLDERS) {
    try {
      if (!(await folders.existsOld(folder))) continue;
      // The drafts always go file by file: a journal is joined or brought in by its own rules (a torn
      // copy stays out, a copy marked as joined is only removed), never moved in with its folder.
      if (folder === "drafts" || await folders.existsNew(folder)) {
        await mergeFolder(folders, folder, pending);
        continue;
      }
      await folders.makeNewFolder("");
      await folders.moveToNew(folder);
    } catch (error) {
      console.warn(`[internal-files] ${folder} could not leave Documents; what is left of it is used there until the next start`, error);
      // Nothing of it in the new place yet: used where it is. Otherwise (or
      // when that cannot be asked) each file is looked for in Documents first.
      if (await folders.existsNew(folder).catch(() => true)) split.add(folder);
      else stayed.add(folder);
    }
  }
  return { stayed, pending, split };
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
    else found.push({ rel, mtime: typeof entry.mtime === "number" && entry.mtime > 0 ? entry.mtime : null });
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
    return typeof info.mtime === "number" && info.mtime > 0 ? info.mtime : null;
  },
  async readOld(path) {
    return String((await Filesystem.readFile({ path, directory: Directory.Documents, encoding: Encoding.UTF8 })).data);
  },
  async readNew(path) {
    return String((await Filesystem.readFile({ path: under(path), directory: Directory.Library, encoding: Encoding.UTF8 })).data);
  },
  async writeNew(path, text) {
    // Loaded here: `atomicFile` itself asks `internalPlace` where a file lies.
    const { atomicWriteTextAt } = await import("./atomicFile");
    await atomicWriteTextAt({ path: under(path), directory: Directory.Library }, text);
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
  const { stayed, pending, split } = await outcome;
  const documents: InternalPlace = { directory: Directory.Data, path: rel };
  if (stayed.has(folder) || pending.has(rel)) return documents;
  if (split.has(folder)) {
    // Not in the new place is not "not there" while the merge is unfinished.
    try {
      if (await folders.existsOld(rel)) return documents;
    } catch {
      // Unknown in Documents: the new place only when the file is known to be there.
      if (!(await folders.existsNew(rel).catch(() => false))) return documents;
    }
  }
  return { directory: Directory.Library, path: under(rel) };
}

export interface InternalEntry {
  name: string;
  type: "file" | "directory";
  mtime: number | null;
}

/**
 * The entries of a folder of the app's own files (`rel` starts with one of
 * `INTERNAL_FOLDERS`). Where a merge left files in `Documents` that are read
 * there (`internalPlace`), the folder is listed in both places and an entry
 * read in `Documents` is listed from there - a listing never hides a file a
 * read would find. A folder that is missing in a place lists nothing there;
 * any other failure throws.
 */
export async function listInternalFolder(rel: string, folders: InternalFolders = capacitorInternalFolders): Promise<InternalEntry[]> {
  const listing = async (place: InternalPlace): Promise<InternalEntry[]> => {
    try {
      const { files } = await Filesystem.readdir({ path: place.path, directory: place.directory });
      // An answer that is not a listing is never taken for an empty folder.
      if (!Array.isArray(files) || files.some((entry) => !entry || typeof entry.name !== "string" || !entry.name || (entry.type !== "file" && entry.type !== "directory"))) {
        throw new Error(`The listing of ${rel} could not be confirmed`);
      }
      return files.map((entry) => ({ name: entry.name, type: entry.type, mtime: typeof entry.mtime === "number" ? entry.mtime : null }));
    } catch (error) {
      if (isMissingFile(error)) return [];
      throw error;
    }
  };
  const place = await internalPlace(rel, folders);
  if (Capacitor.getPlatform() !== "ios") return listing(place);
  const folder = folderOf(rel);
  const { stayed, pending, split } = await outcome!;
  if (stayed.has(folder)) return listing(place);
  const below = `${rel}/`;
  const library: InternalPlace = { directory: Directory.Library, path: under(rel) };
  const someInDocuments = split.has(folder) || [...pending].some((path) => path.startsWith(below));
  if (!someInDocuments) return listing(library);
  const inLibrary = await listing(library);
  let inDocuments: InternalEntry[];
  try {
    inDocuments = await listing({ directory: Directory.Data, path: rel });
  } catch (error) {
    // What lies in Library is always listed; an old folder that cannot be listed costs only what it holds.
    console.warn(`[internal-files] ${rel} in Documents could not be listed; only the new place is listed`, error);
    return inLibrary;
  }
  const entries = new Map<string, InternalEntry>();
  for (const entry of inLibrary) entries.set(entry.name, entry);
  for (const entry of inDocuments) {
    const read = await internalPlace(`${rel}/${entry.name}`, folders);
    if (read.directory !== Directory.Library || !entries.has(entry.name)) entries.set(entry.name, entry);
  }
  return [...entries.values()];
}

/** Tests only: a new JavaScript lifetime. */
export function resetInternalFilesForTests(): void {
  outcome = null;
}
