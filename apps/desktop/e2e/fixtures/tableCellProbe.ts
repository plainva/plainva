import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, keymap } from "@codemirror/view";
import { defaultKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { markdownDecorationPlugin, tableField } from "../../../../packages/ui/src/components/LivePreviewPlugin";
import { editorTheme, markdownTheme } from "../../../../packages/ui/src/components/MarkdownTheme";
import "../../../../packages/ui/src/styles/base-colors.css";
import "../../../../packages/ui/src/styles/tokens.css";
import "../../../../packages/ui/src/styles/ui.css";
import "../../../../packages/ui/src/themes/index.css";
import "../../src/App.css";

/**
 * A Markdown table in the live preview, mounted bare (issue #118): the
 * WebKit job is the engine of the Linux shell, the Chromium suite the
 * engine of Android, and both are where a click into an open cell field
 * could not place the caret.
 */
export const TABLE_DOC = [
  "Text above the table",
  "",
  "| Topic | Note |",
  "| --- | --- |",
  "| short | A cell with enough words to place the caret somewhere in its middle |",
  "",
  "Text below the table",
].join("\n");

function createProbe() {
  let view: EditorView;
  return {
    mount() {
      view?.destroy();
      const host = document.getElementById("host")!;
      host.replaceChildren();
      document.documentElement.dataset.theme = "light";
      document.documentElement.dataset.themeName = "petrol";
      // The caret parks on the first line, so the table shows as its widget.
      view = new EditorView({ parent: host, state: EditorState.create({ doc: TABLE_DOC, selection: { anchor: 0 }, extensions: [
        markdown({ base: markdownLanguage }), editorTheme, markdownTheme(), EditorView.lineWrapping, drawSelection(), keymap.of(defaultKeymap),
        markdownDecorationPlugin(true), tableField(true),
      ] }) });
    },
    doc() {
      return view.state.doc.toString();
    },
  };
}

export type TableCellProbeWindow = Window & { tableCellProbe: ReturnType<typeof createProbe> };
(window as unknown as TableCellProbeWindow).tableCellProbe = createProbe();
