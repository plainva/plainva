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
export type ConflictCopyAnswer = ({ disposition: "adopt" } | { disposition: "discard"; keepCopyAs?: string }) & NoNetAnswer;

/**
 * The person's "Delete anyway" to "Delete without a backup?" (D1): an exit
 * that lets the copy's content go deletes it even where no snapshot of it
 * could be written first. Without it, such an exit throws
 * `SnapshotBeforeDeleteError` and leaves both files as they are.
 */
export interface NoNetAnswer {
  withoutSnapshot?: true;
}

type SettleFiles = Pick<IVaultAdapter, "exists" | "readTextFile" | "readBinaryFile" | "writeTextFile" | "writeBinaryFile" | "renameItem" | "deleteItem"
  | "getConflictSession" | "resolveConflictBytes">;

/** What a comparison of two texts saw: the file's text (null where none lay there) and the copy's. */
export interface ConflictTextSight {
  original: string | null;
  copy: string;
}

/** The three exits of a comparison of two texts: `content` takes the file's place, or the file stays and the copy goes or is kept. */
export type ConflictTextAnswer = ({ disposition: "adopt"; content: string } | { disposition: "discard"; keepCopyAs?: string }) & NoNetAnswer;

type SettleTextFiles = Pick<IVaultAdapter, "exists" | "readTextFile" | "writeTextFile" | "renameItem" | "deleteItem" | "getConflictSession" | "resolveConflict">;

/**
 * Settles a conflict copy both shells' comparisons showed as text — the one
 * way of their three exits, for the working copy of an open conflict and for
 * a copy the sync left beside the file alike.
 *
 * Both go through the chain (`resolveConflict`): the working copy through its
 * session, a copy beside the file named by `copyPath`, so that the check of
 * what the comparison saw and the write that answers it are one step under
 * the gate every write of the chain takes (Sammelplan § 3.86 no. 8). The
 * shells used to check and then write, rename and delete through the chain
 * one by one: a write of the app between the check and the write was
 * overwritten, and a copy changed between them was deleted.
 *
 * An adapter without the chain's gate (none of the shells hands one out)
 * goes the old way, step by step.
 */
export async function settleConflictText(files: SettleTextFiles, originalPath: string, copyPath: string, seen: ConflictTextSight, answer: ConflictTextAnswer): Promise<void> {
  const keepCopyAs = answer.disposition === "discard" ? answer.keepCopyAs : undefined;
  const content = answer.disposition === "adopt" ? answer.content : seen.original ?? "";
  if (files.resolveConflict) {
    await files.resolveConflict(originalPath, {
      originalText: seen.original, copyText: seen.copy, content, copyPath,
      ...(answer.disposition === "discard" ? { disposition: "discard" as const } : {}),
      ...(keepCopyAs ? { keepCopyAs } : {}),
      ...(answer.withoutSnapshot ? { withoutSnapshot: true as const } : {}),
    });
    return;
  }
  // A copy whose text took the file's place needs no snapshot of its own to go (D1).
  const noNet = answer.withoutSnapshot || (answer.disposition === "adopt" && answer.content === seen.copy) ? { withoutSnapshot: true as const } : undefined;
  const current = await files.exists(originalPath) ? await files.readTextFile(originalPath) : null;
  if (current !== seen.original || !await files.exists(copyPath) || await files.readTextFile(copyPath) !== seen.copy) throw new Error("comparisonChanged");
  if (answer.disposition === "adopt") {
    await files.writeTextFile(originalPath, answer.content);
    await files.deleteItem(copyPath, false, noNet);
  } else if (keepCopyAs) {
    if (await files.exists(keepCopyAs)) throw new Error("comparisonChanged");
    await files.renameItem(copyPath, keepCopyAs);
  } else {
    if (seen.original === null) throw new Error("Cannot discard a conflict whose original is missing");
    await files.deleteItem(copyPath, false, noNet);
  }
}

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
 * since —, the conflict ends through its own gate: moving, deleting and
 * writing bytes into it are refused while it is open. A copy beside the file
 * goes through the chain as well (`resolveConflictBytes` with `copyPath`):
 * both files are asked whether they still are what the comparison saw
 * (`comparisonChanged` where not), and the answer is carried out, in one step
 * under the gate every write of the chain takes (Sammelplan § 3.86 no. 8 — a
 * write of the app between the check and the copy taking the file's place was
 * overwritten). Whoever replaces a file keeps a version of it before
 * (`forceBackup` in both shells); the snapshot interval does not decide that.
 *
 * An adapter without the chain's gate (none of the shells hands one out)
 * goes the old way, step by step.
 */
export async function settleConflictCopy(files: SettleFiles, originalPath: string, copyPath: string, seen: ConflictCopySight, answer: ConflictCopyAnswer): Promise<void> {
  const keepCopyAs = answer.disposition === "discard" ? answer.keepCopyAs : undefined;
  if (files.resolveConflictBytes) {
    await files.resolveConflictBytes(originalPath, { originalSha256: seen.original, copySha256: seen.copy, disposition: answer.disposition, copyPath, ...(keepCopyAs ? { keepCopyAs } : {}), ...(answer.withoutSnapshot ? { withoutSnapshot: true as const } : {}) });
    return;
  }
  const session = await files.getConflictSession?.(originalPath);
  if (session?.workingCopyPath === copyPath) throw new Error("Conflict-safe editing is unavailable");
  if (await fileSha256(files, originalPath) !== seen.original || await fileSha256(files, copyPath) !== seen.copy) throw new Error("comparisonChanged");
  // Letting the copy go where no file is left would leave nothing at all.
  if (answer.disposition === "discard" && !keepCopyAs && seen.original === null) throw new Error("Cannot discard a conflict whose original is missing");
  if (answer.disposition === "adopt") {
    await copyFileContent(files, copyPath, originalPath);
    // Its bytes are the file's now (D1).
    await files.deleteItem(copyPath, false, { withoutSnapshot: true });
  } else if (keepCopyAs) {
    if (await files.exists(keepCopyAs)) throw new Error("comparisonChanged");
    await files.renameItem(copyPath, keepCopyAs);
  } else {
    await files.deleteItem(copyPath, false, answer.withoutSnapshot ? { withoutSnapshot: true } : undefined);
  }
}
