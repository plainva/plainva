import { describe, it, expect } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import {
  anchorDisplayLabel,
  anchorFrameAt,
  anchorFrameSignature,
  anchorHighlightExtension,
  hasAnchorHighlightChange,
  setAnchorHighlights,
  type AnchorHighlight,
} from "@plainva/ui";

const DOC = "Intro line\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
// The stretch of Markdown the table widget covers.
const TABLE_FROM = DOC.indexOf("| a |");
const TABLE_TO = DOC.length;

function stateWith(extra: Extension = []): EditorState {
  return EditorState.create({ doc: DOC, extensions: [anchorHighlightExtension(() => {}), extra] });
}

/** The mark decorations the field hands to the view — a framed entry must contribute none. */
function markRanges(state: EditorState): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  for (const value of state.facet(EditorView.decorations)) {
    if (typeof value === "function") continue; // view plugins; the field provides a set
    const it = (value as DecorationSet).iter();
    while (it.value) {
      out.push({ from: it.from, to: it.to });
      it.next();
    }
  }
  return out;
}

function apply(state: EditorState, list: readonly AnchorHighlight[]): EditorState {
  return state.update({ effects: setAnchorHighlights.of(list) }).state;
}

describe("anchorDisplayLabel", () => {
  it("names the image and the diagram without parameters", () => {
    expect(anchorDisplayLabel({ kind: "image" })).toEqual({ key: "workspaceSecurity.commentAtImage" });
    expect(anchorDisplayLabel({ kind: "diagram" })).toEqual({ key: "workspaceSecurity.commentAtDiagram" });
  });

  it("reads the column one-based and keeps the row as stored", () => {
    // Row 0 is the header; column 0 is the first one a reader calls "1".
    expect(anchorDisplayLabel({ kind: "tableCell", row: 2, column: 0 })).toEqual({
      key: "workspaceSecurity.commentAtCell",
      params: { row: 2, column: 1 },
      caveat: "workspaceSecurity.commentCellMoved",
    });
  });

  it("says the cell may have moved instead of inventing coordinates", () => {
    // Without row/column there is nothing honest to name — the caveat IS the label.
    expect(anchorDisplayLabel({ kind: "tableCell" })).toEqual({ key: "workspaceSecurity.commentCellMoved" });
  });
});

describe("anchor frames", () => {
  it("draws no mark over a framed range — a widget leaves no text to tint", () => {
    const framed = apply(stateWith(), [{ commentId: "c1", from: TABLE_FROM, to: TABLE_TO, frame: { kind: "tableCell", row: 2, column: 0 } }]);
    expect(markRanges(framed)).toEqual([]);

    // Counter-proof: the same range without a frame IS tinted.
    const plain = apply(stateWith(), [{ commentId: "c1", from: TABLE_FROM, to: TABLE_TO }]);
    expect(markRanges(plain)).toEqual([{ from: TABLE_FROM, to: TABLE_TO }]);
  });

  it("hands a widget the frame over its own range and nothing over a foreign one", () => {
    const state = apply(stateWith(), [{ commentId: "c1", from: TABLE_FROM, to: TABLE_TO, frame: { kind: "tableCell", row: 2, column: 1 } }]);
    expect(anchorFrameAt(state, TABLE_FROM, TABLE_TO)).toEqual({ commentId: "c1", kind: "tableCell", row: 2, column: 1, active: false });
    expect(anchorFrameAt(state, 0, 5)).toBeNull();
  });

  it("lets the open card's frame win over a quiet one on the same widget", () => {
    const state = apply(stateWith(), [
      { commentId: "quiet", from: TABLE_FROM, to: TABLE_TO, frame: { kind: "tableCell" } },
      { commentId: "open", from: TABLE_FROM, to: TABLE_TO, active: true, frame: { kind: "tableCell" } },
    ]);
    expect(anchorFrameAt(state, TABLE_FROM, TABLE_TO)?.commentId).toBe("open");
  });

  it("keeps the frame on its widget while someone types above it", () => {
    const framed = apply(stateWith(), [{ commentId: "c1", from: TABLE_FROM, to: TABLE_TO, frame: { kind: "image" } }]);
    const typed = framed.update({ changes: { from: 0, insert: "New paragraph\n\n" } }).state;
    const shift = "New paragraph\n\n".length;
    expect(anchorFrameAt(typed, TABLE_FROM + shift, TABLE_TO + shift)?.commentId).toBe("c1");
    // The stale offsets no longer hold — that is the point of mapping.
    expect(anchorFrameAt(typed, 0, TABLE_FROM)).toBeNull();
  });
});

describe("anchorFrameSignature", () => {
  it("changes when the frame appears or opens, so a widget rebuilds its DOM", () => {
    // CodeMirror reuses DOM whenever eq() says equal; a signature that ignored
    // `active` would leave the frame unpainted.
    const quiet = { commentId: "c1", kind: "tableCell", row: 2, column: 0, active: false } as const;
    expect(anchorFrameSignature(null)).toBe("");
    expect(anchorFrameSignature(quiet)).not.toBe("");
    expect(anchorFrameSignature({ ...quiet, active: true })).not.toBe(anchorFrameSignature(quiet));
    expect(anchorFrameSignature({ ...quiet, column: 1 })).not.toBe(anchorFrameSignature(quiet));
  });
});

describe("hasAnchorHighlightChange", () => {
  it("is true only for the transaction that carries the effect", () => {
    const state = stateWith();
    const withEffect = state.update({ effects: setAnchorHighlights.of([]) });
    const withEdit = state.update({ changes: { from: 0, insert: "x" } });
    expect(hasAnchorHighlightChange(withEffect)).toBe(true);
    expect(hasAnchorHighlightChange(withEdit)).toBe(false);
  });
});
