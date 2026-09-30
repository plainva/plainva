/**
 * The text currently selected in the active editor, read on demand
 * (plan Vorlagen-Engine, P5 — `{{selection}}`).
 *
 * A READER, not a value. Publishing the selected text on every selection
 * change would copy the whole marked range on every cursor move — "select all"
 * in a large note would hand out a fresh copy of the document each time. The
 * one place that wants it (inserting a template) asks once, and only when the
 * template actually carries the token.
 */

type SelectionReader = () => string | null;

let reader: SelectionReader | null = null;

/** The active editor pane registers its reader; unmount passes `null`. */
export function setEditorSelectionReader(fn: SelectionReader | null): void {
  reader = fn;
}

/** Selected text, or null when nothing is selected / no editor is mounted. */
export function readEditorSelection(): string | null {
  try {
    const text = reader?.() ?? null;
    return text && text.length > 0 ? text : null;
  } catch {
    return null;
  }
}


/**
 * The main selection as a place in the editor's document (plan KI-Harness
 * P1.5): a suggestion needs to know where its passage stands, not only what
 * it says. Also a reader, asked once when an AI action starts.
 */
export interface EditorRange {
  path: string;
  from: number;
  to: number;
  text: string;
  /** The editor's whole document when the range was read. */
  doc: string;
}

type RangeReader = () => EditorRange | null;

let rangeReader: RangeReader | null = null;

/** The editor registers its range reader next to the selection reader; unmount passes `null`. */
export function setEditorRangeReader(fn: RangeReader | null): void {
  rangeReader = fn;
}

/** The selected range, or null when nothing is selected / no editor is mounted. */
export function readEditorRange(): EditorRange | null {
  try {
    const range = rangeReader?.() ?? null;
    return range && range.to > range.from ? range : null;
  } catch {
    return null;
  }
}

/** The conversation's view of the selection (plan KI-Harness P1.5): whether there is one, and its place. */
export const editorSelectionReader = {
  has: () => readEditorSelection() !== null,
  range: () => readEditorRange(),
};
