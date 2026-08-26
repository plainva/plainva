import {
  hasOpenAnnotations,
  referencesRelativeAttachments,
  renderNoteExport,
  toast,
  type CommentExportMode,
} from "@plainva/ui";
import { utf8ToBase64, type MailAttachment } from "@plainva/ui/mail";
import type { WorkspaceCommentRecord } from "@plainva/core";
import type { TFunction } from "i18next";
import { mSelect } from "./mobileDialogs";
import { listMobileCommentAuthors, listMobileComments } from "./mobileComments";
import { shareVaultText } from "./shareFile";
import { noteSaver, vaultOps, type MobileVault } from "./vaultService";

/**
 * How the annotations should travel.
 *
 * The list is the default and stands first: it renders in every tool, where
 * CriticMarkup only renders in the few that know it. Somebody who wants the
 * marked-up file knows what CriticMarkup is; somebody who does not should not
 * receive a file full of curly braces by default.
 */
async function askExportMode(t: TFunction): Promise<CommentExportMode | null> {
  const chosen = await mSelect({
    title: t("editor.exportFormatTitle"),
    message: t("editor.exportFormatBody"),
    value: "appendix",
    options: [
      { value: "appendix", label: t("editor.exportFormatAppendix") },
      { value: "critic", label: t("editor.exportFormatCritic") },
      { value: "plain", label: t("editor.exportFormatPlain") },
    ],
  });
  return chosen === "plain" || chosen === "critic" || chosen === "appendix" ? chosen : null;
}

/**
 * "Export as Markdown…" on the phone (parity gap markdown-export-file).
 *
 * Two things this fixes over handing the file out directly (2026-08-20):
 *
 * The flush. The export reads the note FROM DISK, and the autosave runs on
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
 *
 * Since D10 the file is ASSEMBLED rather than copied: the invisible anchor
 * markers come out in every case, and open annotations can travel as a list or
 * as CriticMarkup. That moved the read in front of the share — it now feeds
 * what gets handed out, so a note that cannot be read is a failed export
 * rather than a finished one with a missing hint.
 */
export async function exportNoteAsMarkdown(
  vault: MobileVault,
  path: string,
  t: TFunction,
): Promise<boolean> {
  let text: string;
  try {
    await noteSaver.flush(path);
    const raw = await vaultOps.read(vault, path);
    let records: readonly WorkspaceCommentRecord[] = [];
    let names: ReadonlyMap<string, string> = new Map();
    // A failing comment lookup must never cost the user the export itself.
    try {
      [records, names] = await Promise.all([
        listMobileComments(vault, path),
        listMobileCommentAuthors(vault),
      ]);
    } catch (e) {
      console.error("[export] could not read annotations", e);
    }
    let mode: CommentExportMode = "plain";
    if (hasOpenAnnotations(records, names)) {
      // Asked before the share sheet, and only when there is something to ask
      // about: a note without annotations exports in one step, as it always did.
      const chosen = await askExportMode(t);
      if (!chosen) return false;
      mode = chosen;
    }
    text = renderNoteExport({ raw, comments: records, names, mode }).text;
    await shareVaultText(path.split("/").pop() ?? path, text, "text/markdown; charset=utf-8");
  } catch {
    toast.warning(t("editor.exportFailed"));
    return false;
  }
  if (referencesRelativeAttachments(text)) toast.info(t("editor.exportAttachmentsHint"));
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
