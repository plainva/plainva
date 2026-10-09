import { ensureOkfFrontmatter } from "@plainva/core";
import { templateCaretInNote } from "./templateCaret";

/**
 * OKF write path for freshly created note content (Masterplan §9.2). Extracted
 * from the desktop's `services/newNote.ts` (feinplan G0.1) because the shared
 * mail code builds notes too; the settings-dependent parts of that module
 * (per-vault default `type`) stay in the shell.
 *
 * This is the ONE writer of the header a new note gets, for both shells
 * (finding 2026-10-09; `frontmatterDefinition.test.ts` fails a file that sets
 * the header as a string again). What it decides:
 *
 *  - `type` goes into the properties block the content carries — also the
 *    empty one, `---` directly on `---` — and a block is put in front only
 *    where there is none. A `type` the content names itself wins.
 *  - Nothing stands between the header and the text. A template's text arrives
 *    byte for byte, with the blank lines it opens with and its line endings;
 *    a note without a template starts with its heading directly under the
 *    header.
 *
 * The phone used to set the header from three strings of its own: only in
 * front of a text without a block, so a template whose block named no `type`
 * made a note without one, and with a blank line behind it that no other new
 * note has — not the daily note, the meeting note, a pinboard entry or a
 * captured mail, which came through here on both shells all along.
 */

/**
 * Ensures OKF minimum frontmatter on freshly created content. A template with
 * unparseable frontmatter must not block note creation — the content is then
 * returned unchanged (the conversion wizard is the place to repair files).
 */
export function withOkfDefaults(content: string, type: string): string {
  try {
    return ensureOkfFrontmatter(content, { type }).content;
  } catch {
    return content;
  }
}

/**
 * Initial content for a brand-new note: OKF frontmatter plus an H1 with the
 * note's name so the caret target is visible (maintainer, 2026-07-04). Callers
 * that intentionally start blank (e.g. template scaffolds) omit `title`.
 */
export function buildNewNoteContent(type: string, title?: string): string {
  const heading = title?.trim();
  return withOkfDefaults(heading ? `# ${heading}\n` : "", type);
}

/**
 * A template the engine has resolved, as the content of a new note: the OKF
 * defaults on its text, and its `{{cursor}}` where it stands in what is
 * written (`templateCaretInNote`).
 *
 * Both shells build a note from a template with this call — the desktop's
 * `buildNewNoteFromTemplate`, the phone's `buildNewNoteFromTemplateText`, the
 * daily note of both. Takes what `finalizeTemplate` returns.
 */
export function templateAsNewNote(
  template: { text: string; cursor: number | null },
  type: string
): { content: string; caret: number | null } {
  const content = withOkfDefaults(template.text, type);
  return { content, caret: template.cursor === null ? null : templateCaretInNote(template.text, content, template.cursor) };
}
