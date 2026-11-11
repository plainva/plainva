import type { EditorView } from "@codemirror/view";
import type { LineLinkMode } from "@plainva/ui";

/**
 * Which open editor can make a link to one of its lines (F2) — for the
 * right-click menu, which only sees the element that was clicked
 * (`webviewHardening.ts`) and asks here what the click landed on.
 *
 * Each editor registers its view with the action that copies the link at a
 * position (the note's path and name live in the editor, not here); the
 * registration ends with the editor session.
 */
interface Entry {
  view: EditorView;
  copy: (pos: number, mode: LineLinkMode) => void;
}

const editors = new WeakMap<Element, Entry>();

export function registerLineLinkEditor(view: EditorView, copy: (pos: number, mode: LineLinkMode) => void): () => void {
  editors.set(view.dom, { view, copy });
  return () => {
    if (editors.get(view.dom)?.view === view) editors.delete(view.dom);
  };
}

/** The line-link actions at a right-click, or `null` outside an editor that offers them. */
export function lineLinkAt(target: EventTarget | null, x: number, y: number): { copy: (mode: LineLinkMode) => void } | null {
  const element = target instanceof Element ? target : target instanceof Node ? target.parentElement : null;
  const root = element?.closest(".cm-editor");
  if (!root) return null;
  const entry = editors.get(root);
  if (!entry) return null;
  const pos = entry.view.posAtCoords({ x, y }) ?? entry.view.state.selection.main.head;
  return { copy: (mode) => entry.copy(pos, mode) };
}
