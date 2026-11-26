import { selectAll } from "@codemirror/commands";
import { EditorView } from "@codemirror/view";

/**
 * "Select all" in a CodeMirror editor through the editor's own command (Sammelplan § 3.141 Nr. 1): the platform's
 * command changes the page's selection, and CodeMirror renders only the lines in view. Loaded with the first editor
 * a menu stands over (`editableField.ts`), so the start carries no CodeMirror (performance plan L5). False where the
 * element holds no editor.
 */
export function selectAllInCodeMirror(root: HTMLElement): boolean {
  const view = EditorView.findFromDOM(root);
  if (!view) return false;
  view.focus();
  selectAll(view);
  return true;
}
