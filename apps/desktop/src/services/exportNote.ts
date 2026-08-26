import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import {
  hasOpenAnnotations,
  referencesRelativeAttachments,
  renderNoteExport,
  toast,
  type CommentExportMode,
} from "@plainva/ui";
import type { WorkspaceCommentRecord } from "@plainva/core";
import i18n from "@plainva/ui/i18n";
import { appTemplateAnswers } from "./appDialogs";

/**
 * "Export as Markdown…" (GitHub issue #6): copies the saved note to a
 * user-picked location OUTSIDE the vault via the OS save dialog. PDF export
 * stays the print dialog (printView.ts); HTML is a follow-up format with its
 * own spec (v0.1.4 candidate) — deliberately not a half-embedded hybrid.
 *
 * Since D10 the copy can carry the note's open annotations. The question is
 * only asked when the note has some — a note without comments exports exactly
 * as it always did, in one dialog, not two.
 */

// Re-exported so the existing tests keep proving the behaviour is unchanged
// after the check moved into the shared layer (both shells export notes).
export { referencesRelativeAttachments };

type ReadAdapter = { readTextFile(path: string): Promise<string> };

/** Where the shell gets the annotations from; omitted when there is no workspace. */
export interface ExportCommentSource {
  listComments(path: string): Promise<WorkspaceCommentRecord[]>;
  listNames(): Promise<ReadonlyMap<string, string>>;
}

/**
 * Asks how the annotations should travel.
 *
 * The default is the list at the end: it renders in every tool, where
 * CriticMarkup only renders in the few that know it. Somebody who wants the
 * marked-up file knows what CriticMarkup is; somebody who does not should not
 * receive a file full of curly braces by default.
 */
async function askExportMode(): Promise<CommentExportMode | null> {
  const field = i18n.t("editor.exportFormatField");
  const plain = i18n.t("editor.exportFormatPlain");
  const appendix = i18n.t("editor.exportFormatAppendix");
  const critic = i18n.t("editor.exportFormatCritic");
  const answers = await appTemplateAnswers({
    title: i18n.t("editor.exportFormatTitle"),
    message: i18n.t("editor.exportFormatBody"),
    fields: [{ label: field, kind: "select", defaultValue: appendix, options: [plain, appendix, critic] }],
  });
  if (!answers) return null;
  const chosen = answers[field];
  return chosen === critic ? "critic" : chosen === plain ? "plain" : "appendix";
}

/**
 * Reads the SAVED note (autosave debounce is ~1 s; the editor flushes on
 * blur/close) and writes it wherever the user points the save dialog.
 * Returns true when a file was written, false on cancel.
 *
 * Order of the two dialogs is deliberate: WHAT goes into the file first, WHERE
 * it lands second — and the OS dialog is never opened for an export the user
 * abandons at the first question.
 */
export async function exportNoteAsMarkdown(
  adapter: ReadAdapter,
  notePath: string,
  comments?: ExportCommentSource,
): Promise<boolean> {
  let mode: CommentExportMode = "plain";
  let records: readonly WorkspaceCommentRecord[] = [];
  let names: ReadonlyMap<string, string> = new Map();
  if (comments) {
    // A failing comment lookup must never cost the user the export itself.
    try {
      [records, names] = await Promise.all([comments.listComments(notePath), comments.listNames()]);
    } catch (e) {
      console.error("[export] could not read annotations", e);
    }
    if (hasOpenAnnotations(records, names)) {
      const chosen = await askExportMode();
      if (!chosen) return false;
      mode = chosen;
    }
  }
  const fileName = notePath.split("/").pop() ?? notePath;
  const target = await saveDialog({
    defaultPath: fileName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!target) return false;
  const raw = await adapter.readTextFile(notePath);
  const { text } = renderNoteExport({ raw, comments: records, names, mode });
  await writeTextFile(target, text);
  if (referencesRelativeAttachments(text)) {
    toast.info(i18n.t("editor.exportAttachmentsHint"));
  }
  return true;
}
