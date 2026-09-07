import { selectAll } from "@codemirror/commands";
import { EditorView, ViewPlugin, keymap } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

/**
 * "Select all" that reaches the whole document (TestFlight feedback Build 91, P5).
 *
 * The platform's own "Select All" — the iOS callout, the desktop context
 * menu's `execCommand` — changes the DOM selection, and CodeMirror renders
 * only the viewport: at best the visible lines were selected, on a longer
 * note the selection snapped back. The app had no command of its own either;
 * `Mod-a` only existed implicitly through the basic setup.
 *
 * Two pieces: an explicit `Mod-a`, and a bridge that watches the document's
 * selection — when it spans everything CodeMirror has rendered, the intent
 * was "all of it", and the state selection becomes the whole document.
 */

/** True when the DOM range starts at the first leaf and ends at the last leaf of `dom`. */
export function rangeCoversRenderedContent(range: Range, dom: HTMLElement): boolean {
  if (!dom.contains(range.startContainer) || !dom.contains(range.endContainer)) return false;
  let first: Node = dom;
  while (first.firstChild) first = first.firstChild;
  let last: Node = dom;
  while (last.lastChild) last = last.lastChild;
  const startsAtFirst =
    (range.startContainer === dom && range.startOffset === 0) || (range.startContainer === first && range.startOffset === 0);
  const lastLength = last.nodeType === Node.TEXT_NODE ? (last.textContent?.length ?? 0) : last.childNodes.length;
  const endsAtLast =
    (range.endContainer === dom && range.endOffset === dom.childNodes.length) ||
    (range.endContainer === last && range.endOffset === lastLength);
  return startsAtFirst && endsAtLast;
}

/** Widens the state selection to the whole document when the DOM selection covers everything rendered. */
export function widenSelectAll(view: EditorView, doc: Document = view.dom.ownerDocument): boolean {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount !== 1 || sel.isCollapsed) return false;
  if (!rangeCoversRenderedContent(sel.getRangeAt(0), view.contentDOM)) return false;
  const main = view.state.selection.main;
  if (main.from === 0 && main.to === view.state.doc.length) return false; // already all
  return selectAll(view);
}

export function selectAllBridge(): Extension {
  return [
    keymap.of([{ key: "Mod-a", run: selectAll }]),
    ViewPlugin.fromClass(
      class {
        private readonly doc: Document;
        private readonly onChange: () => void;
        constructor(private readonly view: EditorView) {
          this.doc = view.dom.ownerDocument;
          this.onChange = () => {
            // After the platform applied its selection, CodeMirror reads it on
            // the next frame; widening happens after that read, not against it.
            this.doc.defaultView?.requestAnimationFrame(() => widenSelectAll(this.view, this.doc));
          };
          this.doc.addEventListener("selectionchange", this.onChange);
        }
        destroy() {
          this.doc.removeEventListener("selectionchange", this.onChange);
        }
      },
    ),
  ];
}
