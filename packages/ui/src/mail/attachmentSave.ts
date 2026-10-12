import { trimChars, trimEndChars } from "@plainva/core";
import { safeFileStem } from "../lib/fileStem";

/**
 * Saving a received attachment into the vault: where it goes and what it is
 * called — one rule for both shells.
 *
 * The phone has saved attachments since 2026-07 and the rule lived in its
 * message screen; the desktop listed attachments as text and could do nothing
 * with them (parity gap without a catalog entry, finding 2026-10-09). A second
 * copy of "next to the captured mail, never over an existing file" would have
 * drifted on exactly the cases that matter — two mails carrying `scan.pdf`, a
 * name with a path separator in it — so the rule moved here and both read it.
 *
 * The file goes into the vault because that is the storage both shells can
 * reach and the one that syncs: a phone has no download folder the app may
 * write to, and a file in the vault is on the other devices too.
 */

export interface AttachmentSaveAdapter {
  exists(path: string): Promise<boolean>;
  createDir(path: string): Promise<void>;
  writeBinaryFile(path: string, data: Uint8Array): Promise<void>;
}

/** The folder received attachments are saved into: `Attachments` under the
 *  folder captured mail lands in. */
export function attachmentFolder(mailFolder: string): string {
  const base = trimChars(mailFolder.trim(), "/") || "Mail";
  return `${base}/Attachments`;
}

/**
 * Names Windows keeps for devices, with or without an extension: a file called
 * `NUL.txt` or `com1` cannot be written there — or, worse, is "written" to the
 * device. The name is whatever precedes the first dot.
 */
const DEVICE_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** A file name may be 255 bytes on the file systems a vault lives on. The stem
 *  leaves room for the number a second file of the same name gets, and for the
 *  extension. */
const MAX_STEM_BYTES = 180;

/** `text`, cut after the last whole character that still fits `max` UTF-8 bytes. */
function withinBytes(text: string, max: number): string {
  let used = 0;
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
    if (used + size > max) break;
    used += size;
    out += ch;
  }
  return out;
}

/**
 * A file name as the sender wrote it, split into a stem and an extension that
 * are safe as a file name on every platform Plainva runs on.
 *
 * The name is somebody else's choice — whoever sent the mail. It may hold a
 * path, a control character, a device name or a novel; what is saved is a
 * plain file under the attachments folder, called as close to that as a file
 * system allows.
 */
export function attachmentFileName(name: string): { stem: string; ext: string } {
  // Control characters first: they are no part of any name, and one in the
  // middle of an extension must not make the rest of it look like a name.
  const plain = Array.from(typeof name === "string" ? name : "")
    .map((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code < 0x20 || code === 0x7f ? " " : ch;
    })
    .join("");
  const dot = plain.lastIndexOf(".");
  const rawExt = dot >= 0 ? plain.slice(dot + 1) : "";
  // An extension is letters and digits. Anything else after the last dot —
  // blanks, a separator, half a path — is part of a name somebody made up.
  const ext = /^[A-Za-z0-9]{1,12}$/.test(rawExt) ? rawExt : "";
  // No leading dot: a file saved from a mail must not land as a hidden one.
  let stem = (safeFileStem(ext ? plain.slice(0, dot) : plain) ?? "").replace(/^[.\s]+/, "");
  // Cut to what a file system takes; a cut must not end in a blank or a dot.
  // (`safeFileStem` has made every run of white space one blank.)
  stem = trimEndChars(withinBytes(stem, MAX_STEM_BYTES), ". ");
  if (DEVICE_NAME.test(stem.split(".")[0].trim())) stem = `_${stem}`;
  return { stem: stem || "attachment", ext: ext || "bin" };
}

/**
 * Writes the attachment into the vault and returns the path it got.
 *
 * Never overwrites: two mails may carry the same file name, and the second one
 * becomes `name-2.ext`. The content is standard base64, as `fetchAttachment`
 * and `fetchAttachments` hand it out.
 */
export async function saveMailAttachment(
  adapter: AttachmentSaveAdapter,
  mailFolder: string,
  name: string,
  contentBase64: string
): Promise<string> {
  const folder = attachmentFolder(mailFolder);
  await adapter.createDir(folder).catch(() => undefined);
  const { stem, ext } = attachmentFileName(name);
  let path = `${folder}/${stem}.${ext}`;
  for (let n = 2; await adapter.exists(path); n++) path = `${folder}/${stem}-${n}.${ext}`;
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  await adapter.writeBinaryFile(path, bytes);
  return path;
}
