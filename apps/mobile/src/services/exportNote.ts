import { referencesRelativeAttachments, toast } from "@plainva/ui";
import { utf8ToBase64, type MailAttachment } from "@plainva/ui/mail";
import type { TFunction } from "i18next";
import { shareVaultFile } from "./shareFile";
import { noteSaver, vaultOps, type MobileVault } from "./vaultService";

/**
 * "Export as Markdown…" on the phone (parity gap markdown-export-file).
 *
 * Two things this fixes over calling shareVaultFile directly (2026-08-20):
 *
 * The flush. shareVaultFile reads the note FROM DISK, and the autosave runs on
 * a ~1 s debounce with no blur to trigger it when a sheet opens — so exporting
 * right after typing handed out the PREVIOUS save. The exported file was
 * silently older than the screen. Flushing first is the same rule R1 applied
 * to renames: pending work lands before anything reads the path.
 *
 * The warning. Attachments are separate files; an exported note keeps its
 * `![[…]]` links but the images do not travel with it. The desktop has said so
 * since the export shipped, the phone said nothing.
 *
 * Where the file goes is deliberately the system sheet rather than a
 * Plainva-drawn picker: "Save to Files" lives there on both platforms, next to
 * Print, Mail and every editor installed — the same destination choice the
 * desktop's save dialog gives, in the shape the platform uses.
 */
export async function exportNoteAsMarkdown(
  vault: MobileVault,
  path: string,
  t: TFunction,
): Promise<boolean> {
  try {
    await noteSaver.flush(path);
    await shareVaultFile(vault, path);
  } catch {
    toast.warning(t("editor.exportFailed"));
    return false;
  }
  // Read AFTER the export: a failure to re-read must not turn a finished
  // export into an error message.
  const saved = await vaultOps.read(vault, path).catch(() => "");
  if (referencesRelativeAttachments(saved)) toast.info(t("editor.exportAttachmentsHint"));
  return true;
}

/**
 * The note as a FILE on a mail (S30 follow-up, 2026-08-20).
 *
 * The desktop's third mail route: not the note IN the message but the `.md`
 * attached to it, so the recipient gets something that reopens as the note.
 * The composer could always attach — the missing half was a draft that arrives
 * with the file already on it.
 *
 * Flushes first for the same reason the export does: the file is read from
 * disk, and an unflushed draft would mail out the previous save.
 *
 * Returns the attachment, or null when the note could not be read.
 */
export async function mailNoteAsAttachment(
  vault: MobileVault,
  path: string,
  title: string,
  t: TFunction,
): Promise<MailAttachment | null> {
  try {
    await noteSaver.flush(path);
    const text = await vaultOps.read(vault, path);
    return {
      name: `${title}.md`,
      mime: "text/markdown; charset=utf-8",
      contentBase64: utf8ToBase64(text),
    };
  } catch {
    toast.warning(t("editor.exportFailed"));
    return null;
  }
}
