import { Directory, Filesystem } from "@capacitor/filesystem";

/**
 * Removals in the app's data folder that are allowed to find nothing.
 *
 * "Already gone" is the goal of a removal, and Capacitor answers a missing
 * file with the same rejection as a refused one. These used to swallow both
 * (stability plan R4): a journal that could not be deleted stayed behind and
 * was taken for an interrupted run at the next start — the profile import
 * journal then rolled back an import that had gone through. A removal that
 * leaves the path in place now fails; one that finds nothing does not.
 */

/** Whether a path of the data folder is still there after a removal failed. */
export async function stillInData(path: string, directory: Directory = Directory.Data): Promise<boolean> {
  try {
    await Filesystem.stat({ path, directory });
    return true;
  } catch {
    // silent: stat fails for exactly the absent path this answers for
    return false;
  }
}

/** Deletes a file of the data folder; absent is fine, a file left in place throws. */
export async function removeDataFile(path: string, directory: Directory = Directory.Data): Promise<void> {
  try {
    await Filesystem.deleteFile({ path, directory });
  } catch (error) {
    if (await stillInData(path, directory)) throw error;
  }
}

/** Deletes a folder of the data folder and all it holds; absent is fine, a folder left in place throws. */
export async function removeDataFolder(path: string, directory: Directory = Directory.Data): Promise<void> {
  try {
    await Filesystem.rmdir({ path, directory, recursive: true });
  } catch (error) {
    if (await stillInData(path, directory)) throw error;
  }
}
