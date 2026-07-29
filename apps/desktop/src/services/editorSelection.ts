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
