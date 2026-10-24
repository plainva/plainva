import { deleteFrontmatterPath, ensureOkfFrontmatter } from "@plainva/core";
import { TEMPLATE_FOR_PATH } from "../base/templateFiles";
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
 * A filled template without the keys that are meant for the template alone:
 * `plainva.tasks: false` keeps the TEMPLATE out of the Tasks view (a note made
 * from it is real content, and its tasks count), `plainva.templateFor` says
 * which databases offer the TEMPLATE (a note made from it is no template),
 * and an `okf_version` a legacy template still carries is a bundle
 * declaration that belongs only in the root index.md (OKF v0.2, E1 — notes
 * stop carrying it). Other `plainva` keys (icon, header colour) stay
 * inheritable on purpose.
 *
 * Each key is taken out on its own. A block that cannot be read keeps all
 * three; an entry the writer cannot take out where it stands keeps that one
 * entry, and the other two still go — the note is made either way.
 *
 * Not exported: `templateAsNewNote` is the one place that takes them out.
 */
function withoutTemplateOnlyKeys(filled: string): string {
  let text = filled;
  for (const path of [["plainva", "tasks"], TEMPLATE_FOR_PATH, ["okf_version"]]) {
    try {
      text = deleteFrontmatterPath(text, path);
    } catch {
      // This entry stays as it stands; the next one is tried all the same.
    }
  }
  return text;
}

/**
 * Whether a filled template leaves nothing of itself in a note: it has no
 * text, and no property but the ones that are meant for the template alone.
 * The daily note asks, to give such a note the heading a note without a
 * template starts with. A byte order mark is something the note keeps, so a
 * template that is a mark (and those keys) gets no heading — as it never did.
 */
export function templateLeavesNothing(filled: string): boolean {
  return withoutTemplateOnlyKeys(filled) === "";
}

/**
 * A template the engine has resolved, as the content of a new note: without
 * the keys that are meant for the template alone, with the OKF defaults on
 * its text, and its `{{cursor}}` where it stands in what is written
 * (`templateCaretInNote`).
 *
 * EVERY note that is made from a template is built with this call, on both
 * shells: a new note, the daily note, a database item, a pinboard entry, a
 * meeting note, and the notes that are made with nobody watching (a task that
 * became a note, a capture that creates the daily note on its way). Takes what
 * `finalizeTemplate` returns — from a shell's questions or from
 * `applyTemplatePlaceholders`.
 *
 * That is why the template-only keys go HERE. They used to be taken out by
 * `applyTemplatePlaceholders`, which only the paths without questions run. A
 * template that a PERSON made a note from goes through the shell's questions
 * instead, and its note kept all three (finding 2026-10-11): its tasks counted
 * as hidden and were missing from the Tasks view, and it carried its
 * template's database assignment. The pinboard entry and the meeting note
 * set the header themselves; they come through here now, so that no way of
 * making a note has a rule of its own for what it takes over.
 *
 * Only the properties block changes — the entries that go, and `type` where it
 * is missing. The template's text arrives byte for byte, which is what the
 * caret is found by.
 */
export function templateAsNewNote(
  template: { text: string; cursor: number | null },
  type: string
): { content: string; caret: number | null } {
  const content = withOkfDefaults(withoutTemplateOnlyKeys(template.text), type);
  return { content, caret: template.cursor === null ? null : templateCaretInNote(template.text, content, template.cursor) };
}
