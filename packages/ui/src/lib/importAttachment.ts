import { isImagePath } from "../services/imageFiles";
import { isAudioTarget } from "./imageTarget";
import { resolveAttachmentPath } from "./attachmentPath";

/**
 * Copying an outside file INTO the vault (issue #56).
 *
 * Three gestures end here — a drop from the file manager, a paste from the
 * clipboard, and since #56 a picker the user opens on purpose — and they must
 * all produce the same thing: the bytes in the attachment folder, and a
 * reference at the caret that is an embed for an image and a link for anything
 * else. That last rule used to live in the desktop editor only, which is why
 * the phone wrote `![[Report.pdf]]` and drew a broken image for it.
 *
 * No I/O of its own beyond what the caller hands in: a Tauri file dialog and a
 * Capacitor filesystem have nothing in common, but the naming, the folder and
 * the reference do.
 */

export interface AttachmentImportFile {
  /** Empty for clipboard bitmaps — the timestamp name steps in then. */
  name: string;
  /** May be empty (a file dialog gives a path, not a MIME type). */
  mime: string;
  bytes: Uint8Array;
}

export interface AttachmentImportIo {
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
  writeBinaryFile(path: string, bytes: Uint8Array): Promise<void>;
}

export interface AttachmentImportResult {
  /** Vault-relative path the bytes were written to. */
  path: string;
  /** `![[path]]` for an image, `[[path]]` for everything else. */
  insert: string;
}

/**
 * Is this an image? Both signals are used on purpose: a clipboard bitmap
 * carries a MIME type and no name, a file dialog gives a name and no MIME type.
 */
function looksLikeImage(file: AttachmentImportFile): boolean {
  return file.mime.startsWith("image/") || isImagePath(file.name);
}

/** Is this sound? Same two signals (plan Journal-Erweiterungen, X3). */
function looksLikeAudio(file: AttachmentImportFile): boolean {
  return file.mime.startsWith("audio/") || isAudioTarget(file.name);
}

export async function importAttachment(
  file: AttachmentImportFile,
  opts: { configuredFolder: string; noteFolder: string },
  io: AttachmentImportIo,
): Promise<AttachmentImportResult> {
  const path = await resolveAttachmentPath(
    { configuredFolder: opts.configuredFolder, noteFolder: opts.noteFolder, fileName: file.name, mime: file.mime },
    io.exists,
  );
  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
  if (folder) await io.createDir(folder);
  await io.writeBinaryFile(path, file.bytes);
  // Sound joins the picture as an EMBED (X3): a link would open the file in
  // another application, and the point of a voice memo is that it plays where
  // it was written.
  const embeds = looksLikeImage(file) || looksLikeAudio(file);
  return { path, insert: embeds ? `![[${path}]]` : `[[${path}]]` };
}
