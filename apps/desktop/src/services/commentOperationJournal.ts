import { FileCommentOperationJournal } from "@plainva/core";
import { invoke } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { mkdir } from "@tauri-apps/plugin-fs";
import { checkedReadDirectory, checkedReadTextFile } from "../adapters/checkedFilesystem";
import { pathHash } from "./draftJournal";
import { isOwnerWindow } from "./windowContext";

/** Device-local, outside the vault. Only the owner writes recovery state. */
export function desktopCommentOperationJournal(vaultPath: string): FileCommentOperationJournal {
  let root: Promise<string> | undefined;
  const rootId = () => {
    if (!isOwnerWindow()) return Promise.reject(new Error("Comment operations are handled by the vault owner"));
    root ??= (async () => {
      const path = await join(await appDataDir(), "drafts", pathHash(vaultPath), "comment-operations");
      await mkdir(path, { recursive: true });
      return invoke<string>("register_write_root", { path });
    })().catch((error) => { root = undefined; throw error; });
    return root;
  };
  return new FileCommentOperationJournal({
    read: async (file) => checkedReadTextFile(await rootId(), file),
    writeAtomic: async (file, text) => {
      await invoke("write_file_atomic", { rootId: await rootId(), relPath: file, contents: text, encoding: "utf8" });
    },
    list: async () => {
      const entries = await checkedReadDirectory(await rootId(), "") ?? [];
      // The journal's own folder holds only files the app wrote. An entry it
      // cannot inspect is a real fault, not someone else's odd file name: a
      // listing that skipped it would silently lose an operation.
      if (entries.some((entry) => entry.unreadable)) throw new Error("The comment operation journal could not be listed completely");
      return entries.map((entry) => entry.name);
    },
  });
}
