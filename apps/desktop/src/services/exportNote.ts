import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { toast } from "@plainva/ui";
import i18n from "@plainva/ui/i18n";

/**
 * "Export as Markdown…" (GitHub issue #6): copies the saved note to a
 * user-picked location OUTSIDE the vault via the OS save dialog. PDF export
 * stays the print dialog (printView.ts); HTML is a follow-up format with its
 * own spec (v0.1.4 candidate) — deliberately not a half-embedded hybrid.
 */

/**
 * True when the body references vault-relative attachments that a standalone
 * .md copy will not carry along: wiki embeds (`![[…]]`) or MD images whose
 * target is neither an absolute URL nor a data URI.
 */
export function referencesRelativeAttachments(content: string): boolean {
  if (/!\[\[/.test(content)) return true;
  const mdImage = /!\[[^\]]*\]\(([^)\s]+)[^)]*\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdImage.exec(content)) !== null) {
    const target = m[1].trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(target)) return true;
  }
  return false;
}

type ReadAdapter = { readTextFile(path: string): Promise<string> };

/**
 * Reads the SAVED note (autosave debounce is ~1 s; the editor flushes on
 * blur/close) and writes it wherever the user points the save dialog.
 * Returns true when a file was written, false on cancel.
 */
export async function exportNoteAsMarkdown(adapter: ReadAdapter, notePath: string): Promise<boolean> {
  const fileName = notePath.split("/").pop() ?? notePath;
  const target = await saveDialog({
    defaultPath: fileName,
    filters: [{ name: "Markdown", extensions: ["md"] }],
  });
  if (!target) return false;
  const content = await adapter.readTextFile(notePath);
  await writeTextFile(target, content);
  if (referencesRelativeAttachments(content)) {
    toast.info(i18n.t("editor.exportAttachmentsHint"));
  }
  return true;
}
