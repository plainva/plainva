/**
 * The text currently selected in the open editor, read on demand
 * (plan Vorlagen-Engine, P6 — `{{selection}}` on the phone).
 *
 * A READER, not a value, for the same reason as on the desktop: publishing the
 * selected text on every selection change would copy the marked range on every
 * cursor move. The one place that wants it — inserting a template — asks once,
 * and only when the template actually carries the token.
 */

type SelectionReader = () => string | null;

let reader: SelectionReader | null = null;

/** The mounted editor registers its reader; unmount passes `null`. */
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
