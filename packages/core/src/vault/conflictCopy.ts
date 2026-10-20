import type { IVaultAdapter } from "./IVaultAdapter.js";
import { copyFileContent, fileSha256 } from "./localText.js";

/**
 * What a comparison saw of a conflict it could not lay out as text — one of
 * the two files is no text (finding 2026-10-11): the hashes of their bytes.
 */
export interface ConflictCopySight {
  /** SHA-256 of the file's bytes; null where no file lies at its place. */
  original: string | null;
  /** SHA-256 of the copy's bytes. */
  copy: string;
}

/**
 * The three exits of such a comparison, as the text comparison has them: the
 * copy takes the file's place ("adopt"); or the file stays and the copy goes
 * ("discard") — or stays beside it as a file of its own (`keepCopyAs`).
 */
export type ConflictCopyAnswer = { disposition: "adopt" } | { disposition: "discard"; keepCopyAs?: string };

type SettleFiles = Pick<IVaultAdapter, "exists" | "readTextFile" | "readBinaryFile" | "writeTextFile" | "writeBinaryFile" | "renameItem" | "deleteItem"
  | "getConflictSession" | "resolveConflictBytes">;

/** Looks at both files for a comparison that offers the byte-wise exits; the copy must lie there. */
export async function seeConflictCopy(files: Pick<IVaultAdapter, "exists" | "readBinaryFile">, originalPath: string, copyPath: string): Promise<ConflictCopySight> {
  const [original, copy] = await Promise.all([fileSha256(files, originalPath), fileSha256(files, copyPath)]);
  if (copy === null) throw new Error("comparisonChanged");
  return { original, copy };
}

/**
 * Settles a conflict copy byte for byte — the one way of both shells'
 * comparisons where one of the two files is no text: an image, and just the
 * same a `.csv` in Windows-1252 beside the copy the sync left of it (§ 3.64).
 * No file is read as text here, so no reading of one can be written.
 *
 * Where the copy is the working copy of an open conflict — the file was text
 * when the conflict began, and another program turned it into something else
 * since —, the conflict ends through its own gate (`resolveConflictBytes`):
 * moving, deleting and writing bytes into it are refused while it is open.
 * Otherwise both files are asked first whether they still are what the
 * comparison saw (`comparisonChanged` where not), and then the answer is
 * carried out. Whoever replaces a file keeps a version of it before
 * (`forceBackup` in both shells); the snapshot interval does not decide that.
 */
export async function settleConflictCopy(files: SettleFiles, originalPath: string, copyPath: string, seen: ConflictCopySight, answer: ConflictCopyAnswer): Promise<void> {
  const keepCopyAs = answer.disposition === "discard" ? answer.keepCopyAs : undefined;
  const session = await files.getConflictSession?.(originalPath);
  if (session?.workingCopyPath === copyPath) {
    if (!files.resolveConflictBytes) throw new Error("Conflict-safe editing is unavailable");
    await files.resolveConflictBytes(originalPath, { originalSha256: seen.original, copySha256: seen.copy, disposition: answer.disposition, ...(keepCopyAs ? { keepCopyAs } : {}) });
    return;
  }
  if (await fileSha256(files, originalPath) !== seen.original || await fileSha256(files, copyPath) !== seen.copy) throw new Error("comparisonChanged");
  // Letting the copy go where no file is left would leave nothing at all.
  if (answer.disposition === "discard" && !keepCopyAs && seen.original === null) throw new Error("Cannot discard a conflict whose original is missing");
  if (answer.disposition === "adopt") {
    await copyFileContent(files, copyPath, originalPath);
    await files.deleteItem(copyPath);
  } else if (keepCopyAs) {
    if (await files.exists(keepCopyAs)) throw new Error("comparisonChanged");
    await files.renameItem(copyPath, keepCopyAs);
  } else {
    await files.deleteItem(copyPath);
  }
}
