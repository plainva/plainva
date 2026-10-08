import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FileCommentOperationJournal, createWorkspaceObjectId, type CommentOperationFiles, type CommentOperationJournal } from "@plainva/core";

/**
 * The journal of comment operations for the write gate's tests: the real
 * file journal over a folder of the test's own, in place of the desktop's
 * (which lives in the app's data through Tauri). Kept in a module of its own,
 * without any import of the app, so the mock of the desktop's journal module
 * can load it while the app's modules are still being wired.
 */
const folders = new Map<string, string>();

/** Says where the journal of a vault lies. Called by the harness before the vault's comment service is built. */
export function setGateJournalFolder(vaultPath: string, folder: string): void {
  folders.set(vaultPath, folder);
}

export function gateJournal(vaultPath: string): CommentOperationJournal {
  const dir = folders.get(vaultPath);
  if (!dir) throw new Error(`no journal folder for ${vaultPath}`);
  const files: CommentOperationFiles = {
    read: async (file) => {
      try {
        return await readFile(join(dir, file), "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    writeAtomic: async (file, content) => {
      await mkdir(dir, { recursive: true });
      const part = join(dir, `${file}.${createWorkspaceObjectId()}.part`);
      await writeFile(part, content);
      await rename(part, join(dir, file));
    },
    list: async () => {
      try {
        return await readdir(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      }
    },
  };
  return new FileCommentOperationJournal(files);
}
