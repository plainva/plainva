import { FileCommentOperationJournal } from "@plainva/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { isMissingFile } from "../adapters/fileErrors";
import { atomicWriteText } from "../platform/atomicFile";

/** The normal draft retention skips this directory; unfinished operations stay. */
export function mobileCommentOperationJournal(vaultId: string): FileCommentOperationJournal {
  if (!vaultId || /[/\\\0]/.test(vaultId) || vaultId === "." || vaultId === "..") throw new Error("Invalid comment journal vault identity");
  const directory = `drafts/${vaultId}/comment-operations`;
  return new FileCommentOperationJournal({
    read: async (file) => {
      try {
        const result = await Filesystem.readFile({ path: `${directory}/${file}`, directory: Directory.Data, encoding: Encoding.UTF8 });
        if (typeof result.data !== "string") throw new Error("The comment journal read could not be confirmed");
        return result.data;
      } catch (error) { if (isMissingFile(error)) return null; throw error; }
    },
    writeAtomic: (file, text) => atomicWriteText(`${directory}/${file}`, text),
    list: async () => {
      try {
        const result = await Filesystem.readdir({ path: directory, directory: Directory.Data });
        if (!Array.isArray(result.files) || result.files.some((entry) => !entry || typeof entry.name !== "string"
          || !entry.name || (entry.type !== "file" && entry.type !== "directory"))) throw new Error("The comment journal listing could not be confirmed");
        return result.files.map((entry) => entry.name);
      } catch (error) { if (isMissingFile(error)) return []; throw error; }
    },
  });
}
