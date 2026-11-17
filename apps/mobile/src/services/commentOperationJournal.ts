import { FileCommentOperationJournal } from "@plainva/core";
import { Encoding, Filesystem } from "@capacitor/filesystem";
import { isMissingFile } from "../adapters/fileErrors";
import { atomicWriteInternalText } from "../platform/atomicFile";
import { internalPlace } from "../platform/internalFiles";

/** The normal draft retention skips this directory; unfinished operations stay. */
export function mobileCommentOperationJournal(vaultId: string): FileCommentOperationJournal {
  if (!vaultId || /[/\\\0]/.test(vaultId) || vaultId === "." || vaultId === "..") throw new Error("Invalid comment journal vault identity");
  const directory = `drafts/${vaultId}/comment-operations`;
  return new FileCommentOperationJournal({
    read: async (file) => {
      try {
        const place = await internalPlace(`${directory}/${file}`);
        const result = await Filesystem.readFile({ path: place.path, directory: place.directory, encoding: Encoding.UTF8 });
        if (typeof result.data !== "string") throw new Error("The comment journal read could not be confirmed");
        return result.data;
      } catch (error) { if (isMissingFile(error)) return null; throw error; }
    },
    writeAtomic: (file, text) => atomicWriteInternalText(`${directory}/${file}`, text),
    list: async () => {
      try {
        const place = await internalPlace(directory);
        const result = await Filesystem.readdir({ path: place.path, directory: place.directory });
        if (!Array.isArray(result.files) || result.files.some((entry) => !entry || typeof entry.name !== "string"
          || !entry.name || (entry.type !== "file" && entry.type !== "directory"))) throw new Error("The comment journal listing could not be confirmed");
        return result.files.map((entry) => entry.name);
      } catch (error) { if (isMissingFile(error)) return []; throw error; }
    },
  });
}
