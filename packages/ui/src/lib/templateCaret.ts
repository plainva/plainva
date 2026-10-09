import { frontmatterSpan } from "@plainva/core";

/**
 * Where the caret goes in a note that was just created from a template
 * (plan Vorlagen-Engine, P3 — `{{cursor}}`).
 *
 * Same shape as the search-jump store, for the same reason: the editor pane
 * that will show the note may not be MOUNTED yet when the note is written
 * (lazy Editor, first file open). The creating code parks the offset here and
 * pokes mounted editors with `plainva-template-caret`; whichever consumer sees
 * that path first takes it — one shot, so a second note never inherits a
 * stale caret.
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
 */
export function templateCaretInNote(template: string, note: string, caret: number): number {
  const textStart = textStartOf(template);
  const text = template.slice(textStart);
  const textInNote = note.endsWith(text) ? note.length - text.length : textStartOf(note);
  return Math.min(note.length, textInNote + Math.max(0, caret - textStart));
}

export function setPendingTemplateCaret(caret: { path: string; offset: number }): void {
  pending = caret;
}

/** Hands the parked caret to the caller iff it targets `path`; clears it. */
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
