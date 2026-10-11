import { editorOffsetOf, editorTextOf, frontmatterSpan } from "@plainva/core";

/**
 * Where the caret goes in a note that was just created from a template
 * (plan Vorlagen-Engine, P3 — `{{cursor}}`).
 *
 * Same shape as the search-jump store, for the same reason: the editor pane
 * that will show the note may not be MOUNTED yet when the note is written
 * (lazy Editor, first file open). The creating code parks the place here and
 * pokes mounted editors with `plainva-template-caret`; whichever consumer sees
 * that path first takes it — one shot, so a second note never inherits a
 * stale caret.
 *
 * Two texts are involved, and a place is a place in one of them. The builders
 * count in the FILE as it is written (`templateCaretInNote`). What is parked,
 * and what a consumer is handed, is a place in the text an EDITOR holds for
 * that file (`parkTemplateCaret`). A template that goes INTO a note that is
 * open crosses the same line without the store (`templateInsertInEditor`).
 */
let pending: { path: string; offset: number } | null = null;

const BYTE_ORDER_MARK = 0xfeff;

/** Where a note's text begins: behind its properties block, else behind a byte order mark it opens with. */
function textStartOf(note: string): number {
  return frontmatterSpan(note)?.end ?? (note.charCodeAt(0) === BYTE_ORDER_MARK ? 1 : 0);
}

/**
 * Where a template's `{{cursor}}` stands in the note that was written from it.
 *
 * The offset is measured in the template. On the way to the note only what is
 * in FRONT of the template's text is written — the OKF header, a view's
 * filters, a meeting's fields —, and the text itself arrives unchanged at the
 * end of the note. So a caret in the text keeps its distance from where that
 * text starts, whatever grew or shrank in front of it.
 *
 * A caret the template puts in front of its text — into its properties block —
 * goes to the start of the text. The block it stood in may have been written
 * anew, and the live editor hides the block and takes no caret in it.
 *
 * Every builder of a new note asks here (finding 2026-10-09). Each used to
 * count the offset on by what the note had grown, which is the same in the
 * text and sends a caret from the block to wherever that sum points: into the
 * line of a property that was just added, or some characters into the text.
 *
 * Both sides are FILE texts, with their line ends and their mark, so the
 * answer can be asked on from one rewrite of the block to the next. An editor
 * counts differently — see `templateCaretInEditor`.
 */
export function templateCaretInNote(template: string, note: string, caret: number): number {
  const textStart = textStartOf(template);
  const text = template.slice(textStart);
  const textInNote = note.endsWith(text) ? note.length - text.length : textStartOf(note);
  return Math.min(note.length, textInNote + Math.max(0, caret - textStart));
}

/**
 * Where a caret that was found in a written note stands in the editor that
 * opens the note. `note` is the FILE as it was written, `caret` a place in it.
 *
 * An editor holds a note with `\n` line ends and without its byte order mark
 * (`editorTextOf` in the core). A note made from a template keeps the
 * template's line ends and its mark — the header follows them —, so for a
 * template written on Windows the place in the file is not the place in the
 * editor: the caret stood one character too far right for every line above
 * it, and one more behind a mark (finding 2026-10-09).
 *
 * The ONE conversion between the two. Every caret that is parked goes through
 * it (`parkTemplateCaret`), and so do the editor that takes its caret from the
 * draft itself (`pinboardEntryCaret`) and a template that is inserted into a
 * note (`templateInsertInEditor`, where `note` is the text handed over).
 */
export function templateCaretInEditor(note: string, caret: number): number {
  return editorOffsetOf(note, caret);
}

/**
 * Parks the caret of a note that was just written, for the editor that opens
 * it next. `caret` is a place in `note`, the FILE as it was written — what a
 * builder hands back beside its content; `null` means the template had no
 * cursor marker, and nothing is parked.
 *
 * The only way into the store, for both shells: a number cannot be parked
 * without the text it was counted in, so the conversion to the editor's text
 * (`templateCaretInEditor`) cannot be left out by one of the places that
 * create a note.
 */
export function parkTemplateCaret(path: string, note: string, caret: number | null): void {
  if (caret === null) return;
  pending = { path, offset: templateCaretInEditor(note, caret) };
}

/**
 * A resolved template as an editor takes it when it is inserted INTO a note:
 * its text as an editor holds it, and `{{cursor}}` as a place in that text.
 *
 * An editor turns every `\r\n` of a text it is handed into one line end. Both
 * shells handed over the template's text as it was read and set the caret by a
 * number counted in THAT text. Behind a template written on Windows the caret
 * stood one character too far right for every line above it; without a cursor
 * marker it was asked for behind the end of what had been inserted, which at
 * the end of a note is a place outside the document — the editor refused the
 * change, and nothing was inserted at all (finding 2026-10-11, measured on
 * the editor's state). A mark the template opens with is its file's and not
 * text: it does not go into the middle of a note.
 *
 * Takes what the interactive pipeline answers, behind the questions: an
 * answer or the clipboard may bring `\r\n` of its own.
 */
export function templateInsertInEditor(resolved: { text: string; cursor: number | null }): { text: string; cursor: number | null } {
  return {
    text: editorTextOf(resolved.text),
    cursor: resolved.cursor === null ? null : templateCaretInEditor(resolved.text, resolved.cursor),
  };
}

/**
 * Hands the parked caret to the caller iff it targets `path`; clears it.
 * `offset` is a place in the text the editor holds for the note.
 */
export function consumePendingTemplateCaret(path: string | null): { path: string; offset: number } | null {
  if (!path || !pending || pending.path !== path) return null;
  const caret = pending;
  pending = null;
  return caret;
}

/** Drops a parked caret — used when the creation it belonged to was abandoned. */
export function clearPendingTemplateCaret(): void {
  pending = null;
}
