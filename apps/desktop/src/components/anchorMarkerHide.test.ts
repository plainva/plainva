// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState, EditorSelection } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import { markdown } from "@codemirror/lang-markdown";
import { cursorCharRight } from "@codemirror/commands";
import { anchorMarkerHidePlugin, isAnchorMarkerText, markdownDecorationPlugin } from "@plainva/ui";

const DOC = "The contract runs <!--pv#7f3a-->until the end of the year<!--/pv#7f3a--> and renews.\n\n<!-- -->\n- a\n";
const OPEN_FROM = DOC.indexOf("<!--pv#7f3a-->");
const OPEN_TO = OPEN_FROM + "<!--pv#7f3a-->".length;
const CLOSE_FROM = DOC.indexOf("<!--/pv#7f3a-->");
const CLOSE_TO = CLOSE_FROM + "<!--/pv#7f3a-->".length;

function ranges(deco: DecorationSet): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  const it = deco.iter();
  while (it.value) {
    out.push({ from: it.from, to: it.to });
    it.next();
  }
  return out;
}

function hiddenRanges(view: EditorView): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  for (const set of view.state.facet(EditorView.decorations)) {
    const resolved = typeof set === "function" ? set(view) : set;
    for (const r of ranges(resolved)) {
      const spec = ((resolved.iter(r.from).value as unknown) as { spec?: { widget?: unknown; block?: boolean } })?.spec;
      // A replace decoration without a widget is a plain hide.
      if (spec && spec.widget === undefined && !spec.block) out.push(r);
    }
  }
  return out;
}

/**
 * The marker hide (K1, finding 2026-09-03): live preview replaces the anchor
 * markers, active line included, and the caret steps over them; source mode
 * leaves them visible; the block-drag separator `<!-- -->` is untouched.
 */
describe("anchorMarkerHidePlugin", () => {
  it("names exactly the two marker shapes", () => {
    expect(isAnchorMarkerText("<!--pv#7f3a-->")).toBe(true);
    expect(isAnchorMarkerText("<!--/pv#7f3a-->")).toBe(true);
    expect(isAnchorMarkerText("<!-- -->")).toBe(false);
    expect(isAnchorMarkerText("<!--pv#7f3a--> ")).toBe(false);
    expect(isAnchorMarkerText("<!--pv#7F3A-->")).toBe(false);
  });

  it("hides both markers in live mode even where the caret sits, and nothing else", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions: [markdown(), anchorMarkerHidePlugin(true)], selection: EditorSelection.single(OPEN_FROM + 3) }),
      parent: document.body,
    });
    try {
      const hidden = hiddenRanges(view);
      expect(hidden).toEqual([{ from: OPEN_FROM, to: OPEN_TO }, { from: CLOSE_FROM, to: CLOSE_TO }]);
      // Atomic: moving right from just before the marker lands just after it.
      view.dispatch({ selection: EditorSelection.single(OPEN_FROM) });
      cursorCharRight(view);
      expect(view.state.selection.main.head).toBe(OPEN_TO);
    } finally {
      view.destroy();
    }
  });

  it("does nothing in source mode", () => {
    const view = new EditorView({ state: EditorState.create({ doc: DOC, extensions: [markdown(), anchorMarkerHidePlugin(false)] }), parent: document.body });
    try {
      expect(hiddenRanges(view)).toEqual([]);
    } finally {
      view.destroy();
    }
  });

  it("the live decoration plugin no longer dims a marker, but still dims the separator", () => {
    const view = new EditorView({
      state: EditorState.create({ doc: DOC, extensions: [markdown(), markdownDecorationPlugin(true)], selection: EditorSelection.single(DOC.length - 1) }),
      parent: document.body,
    });
    try {
      const dimmed: Array<{ from: number; to: number }> = [];
      for (const set of view.state.facet(EditorView.decorations)) {
        const resolved = typeof set === "function" ? set(view) : set;
        const it = resolved.iter();
        while (it.value) {
          const cls = (it.value as unknown as { spec?: { class?: string } }).spec?.class ?? "";
          if (cls.includes("cm-md-comment-dim")) dimmed.push({ from: it.from, to: it.to });
          it.next();
        }
      }
      const sep = DOC.indexOf("<!-- -->");
      expect(dimmed).toEqual([{ from: sep, to: sep + "<!-- -->".length }]);
    } finally {
      view.destroy();
    }
  });
});
