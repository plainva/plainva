import { editorOffsetOf, editorTextOf, frontmatterSpan } from "@plainva/core";
import { isFreshNote, markFreshNote } from "./freshNote";

/**
 * Where the caret goes in a note that was just created from a template
 * (plan Vorlagen-Engine, P3 — `{{cursor}}`).
 *
 * Same shape as the search-jump store, for the same reason: the editor pane
 * that will show the note may not be MOUNTED yet when the note is written
 * (lazy Editor, first file open). The creating code parks the place here and
 * pokes mounted editors with `plainva-template-caret`; whichever consumer sees
 * that path first takes it — one shot, so a second note never inherits a
 * stale caret. Every surface a new note opens in is such a consumer, the
 * desktop's peek window too (`takeTemplateCaret`): a surface that does not
 * ask leaves the caret to whatever shows the note later. A window that hands
 * its note on to another surface hands the caret on with it, as the place it
 * holds by then (`handTemplateCaretOver`).
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
 *
 * Every such place is one that has just written a note for the user to open,
 * so it is also where the note is marked fresh - it opens to be written in
 * (`freshNote.ts`), with or without a cursor marker.
 */
export function parkTemplateCaret(path: string, note: string, caret: number | null): void {
  markFreshNote(path);
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

/**
 * Where an editor sits when it asks for the caret of the note it shows.
 *
 * `"pane"` is the pane the person works in: the note opened there. `"preview"`
 * is a window that shows a note beside the work — the desktop's peek window,
 * where a database opens the entry it has just made, and the pinboard's entry
 * window (whose caret comes from its draft; nothing is parked for it on the
 * desktop).
 */
export type TemplateCaretSurface = "pane" | "preview";

/**
 * Hands the caret parked for `path` to the editor of `surface`, and says
 * whether the text gets the keyboard with it - it does, wherever it is taken.
 * The one question an editor of the desktop asks the store; `null` is an editor
 * that is neither — a second pane the person is not working in —, and it
 * leaves the caret for the one the note opens in.
 *
 * A preview takes the caret of its note like a pane does (finding 2026-10-12).
 * It used not to ask at all: only the active pane did, and a new database
 * entry opens in the peek window. The caret stayed parked and went to the tab
 * that showed the entry later — a place counted when the note was written,
 * whatever had been typed in the window since.
 *
 * A preview takes the keyboard with it (maintainer decision E5 of the
 * bug-clearing plan, 2026-10-30). Until then the window left the keyboard
 * where it was - on "+ Entry" behind it -, so that title and properties could
 * be filled in first; typing went nowhere until the text was clicked. Only a
 * template with `{{cursor}}` parks a caret, so a template that says where the
 * writing starts is written there at once - on the desktop as on the phone,
 * which opens a new entry as a note screen with the keyboard at the caret
 * (`EditorHost`, `freshNote.ts`). The place is the selection of the window's
 * editor from then on; a rename of the entry hands it on to the editor that
 * shows the new name (`handTemplateCaretAcrossRename`).
 */
export function takeTemplateCaret(
  path: string | null,
  surface: TemplateCaretSurface | null,
): { path: string; offset: number; focus: boolean } | null {
  if (surface === null) return null;
  const caret = consumePendingTemplateCaret(path);
  return caret ? { ...caret, focus: true } : null;
}

/**
 * A window's note was renamed, and the window shows it under its new name in a
 * new editor (Sammelplan § 3.140 Nr. 1). The caret went with the old editor:
 * the new one opened at the start of the note, in the hidden properties block,
 * and gave nothing on to a tab either. Now the place the old editor held
 * (`doc`, its text, and its selection) is parked for the new name, counted in
 * the note as it is after the rename (`renamed`, the FILE): a rename carries a
 * heading that repeats the old name, and that moves what stands behind it.
 *
 * Only for a note made in this session - the rename has carried the mark
 * along (`followFreshNoteMove`) -, and not for a caret still in the
 * properties block, the same rules as `handTemplateCaretOver`.
 */
export function handTemplateCaretAcrossRename(path: string, doc: string, selection: { head: number }, renamed: string): void {
  if (!isFreshNote(path) || selection.head <= 0 || selection.head < textStartOf(doc)) return;
  const next = editorTextOf(renamed);
  const offset = placeAcrossChange(doc, next, selection.head);
  if (offset < textStartOf(next)) return;
  // Parked through the one way into the store, as a place in the file.
  parkTemplateCaret(path, renamed, fileOffsetFor(renamed, offset));
}

/** The first place in `file` that an editor counts as `offset` (the inverse of `templateCaretInEditor`). */
function fileOffsetFor(file: string, offset: number): number {
  let low = 0;
  let high = file.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (templateCaretInEditor(file, middle) < offset) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Where `head`, a place in `before`, stands in `after`: unchanged in front of
 * what changed, moved by the difference behind it, at the end of the new text
 * inside it.
 */
function placeAcrossChange(before: string, after: string, head: number): number {
  let front = 0;
  const shorter = Math.min(before.length, after.length);
  while (front < shorter && before.charCodeAt(front) === after.charCodeAt(front)) front++;
  let back = 0;
  while (back < shorter - front && before.charCodeAt(before.length - 1 - back) === after.charCodeAt(after.length - 1 - back)) back++;
  if (head <= front) return head;
  if (head >= before.length - back) return head + (after.length - before.length);
  return after.length - back;
}

/**
 * A window hands its note on to another surface — the desktop's peek window
 * opens it as a tab or in the split — and the caret goes along: parked for
 * that note as the place the window's editor holds by then (`doc`, the text it
 * holds, and its selection), for the surface the note opens in next.
 *
 * Only for a note made on this device in this session (`freshNote.ts`), with
 * or without a template. A template's caret was taken by the window
 * (`takeTemplateCaret`), and a tab opened from the window used to find it
 * parked still — at the place of the moment the note was written. Now the tab
 * continues where the window is. A note that was there before opens in a tab
 * as it always has, and a caret still in the properties block — nobody has
 * placed one — is not handed on.
 */
export function handTemplateCaretOver(path: string, doc: string, selection: { head: number }): void {
  if (!isFreshNote(path) || selection.head <= 0 || selection.head < textStartOf(doc)) return;
  parkTemplateCaret(path, doc, selection.head);
}

/** Drops a parked caret — used when the creation it belonged to was abandoned. */
export function clearPendingTemplateCaret(): void {
  pending = null;
}
