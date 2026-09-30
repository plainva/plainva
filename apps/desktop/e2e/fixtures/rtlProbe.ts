import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { listIndentPlugin } from "../../../../packages/ui/src/components/listIndent";
import { markdownDecorationPlugin } from "../../../../packages/ui/src/components/LivePreviewPlugin";
import { editorTheme, markdownTheme } from "../../../../packages/ui/src/components/MarkdownTheme";
import { textDirectionExtension } from "../../../../packages/ui/src/components/textDirectionExtension";
import "../../../../packages/ui/src/styles/base-colors.css";
import "../../../../packages/ui/src/styles/tokens.css";
import "../../../../packages/ui/src/styles/ui.css";
import "../../../../packages/ui/src/themes/index.css";
import "../../src/App.css";

/**
 * Right-to-left lines in a real engine (issue 111, plan Teil R, § 6): the
 * editor extensions the session uses, mounted bare so the WebKit job can ask
 * where CodeMirror puts the caret, the selection and the list widgets.
 */
export const RTL_DOC = [
  "بدأت اليوم قراءة كتاب جديد",
  "- الفصل الأول قرطبة",
  "- [x] شراء الكتاب",
  "",
  "Plainva keeps notes as Markdown files",
].join("\n");

function createProbe() {
  let view: EditorView;
  return {
    mount(live: boolean) {
      view?.destroy();
      const host = document.getElementById("host")!;
      host.replaceChildren();
      document.documentElement.dataset.theme = "light";
      document.documentElement.dataset.themeName = "petrol";
      // The caret parks on the Latin line, so the Arabic task shows its box.
      view = new EditorView({ parent: host, state: EditorState.create({ doc: RTL_DOC, selection: { anchor: RTL_DOC.length }, extensions: [
        markdown(), editorTheme, markdownTheme(), EditorView.lineWrapping, drawSelection(), keymap.of(defaultKeymap),
        listIndentPlugin({ hideLeadingWhitespace: live }), markdownDecorationPlugin(live), textDirectionExtension(),
      ] }) });
      return RTL_DOC;
    },
    /** Line n: its dir attribute, its computed direction, and where its first and last character sit. */
    line(n: number) {
      const line = view.state.doc.line(n);
      const el = view.domAtPos(line.from).node;
      const lineEl = (el.nodeType === 1 ? el as Element : el.parentElement!).closest(".cm-line")!;
      const first = view.coordsAtPos(line.from, 1);
      const last = view.coordsAtPos(line.to, -1);
      return { dir: lineEl.getAttribute("dir"), direction: getComputedStyle(lineEl).direction, firstLeft: first?.left ?? null, lastLeft: last?.left ?? null };
    },
    focusAt(n: number, offset: number) {
      const at = view.state.doc.line(n).from + offset;
      view.focus();
      view.dispatch({ selection: { anchor: at } });
      return at;
    },
    selection() {
      const { anchor, head } = view.state.selection.main;
      return { anchor, head };
    },
    /**
     * How far the drawn selection's outer edges are from the caret positions
     * that bound the first three characters of line n (null until drawn).
     * CodeMirror draws the selection layer in its next measure cycle.
     */
    selectionEdgeGaps(n: number) {
      const line = view.state.doc.line(n);
      const rects = Array.from(view.dom.querySelectorAll(".cm-selectionBackground"), (r) => r.getBoundingClientRect()).filter((r) => r.width > 0);
      const start = view.coordsAtPos(line.from, 1), third = view.coordsAtPos(line.from + 3, 1);
      if (!rects.length || !start || !third) return null;
      const left = Math.min(...rects.map((r) => r.left)), right = Math.max(...rects.map((r) => r.right));
      // Right to left: the line's start is the RIGHT edge of the selection.
      return Math.max(Math.abs(right - start.left), Math.abs(left - third.left));
    },
    /** Where the task box sits against the task's text. */
    taskGeometry() {
      const line = view.state.doc.line(3);
      const box = view.dom.querySelector(".cm-md-task")?.getBoundingClientRect() ?? null;
      const text = view.coordsAtPos(line.from + "- [x] ".length, 1);
      return { box: box ? { left: box.left, right: box.right } : null, textRight: text?.right ?? null };
    },
  };
}
export type RtlProbeWindow = Window & { rtlProbe: ReturnType<typeof createProbe> };
(window as RtlProbeWindow).rtlProbe = createProbe();
