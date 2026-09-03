// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, type DecorationSet } from "@codemirror/view";
import {
  anchorDisplayLabel,
  anchorFrameAt,
  anchorFrameSignature,
  anchorFramesAt,
  anchorFramesSignature,
  anchorHighlightExtension,
  decorateAnchorTarget,
  hasAnchorHighlightChange,
  setAnchorHighlights,
  toAnchorFrameHint,
  type AnchorHighlight,
} from "@plainva/ui";

const DOC = "Intro line\n\n| a | b |\n| - | - |\n| 1 | 2 |\n";
// The stretch of Markdown the table widget covers.
const TABLE_FROM = DOC.indexOf("| a |");
const TABLE_TO = DOC.length;
// A second range, standing in for a picture. The field tracks ranges and does
// not care which widget covers one.
const PIC_FROM = 0;
const PIC_TO = "Intro line".length;

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

  it("says a marked spot instead of the whole picture when there is a region", () => {
    // "On the picture" would hide what the writer actually pointed at.
    expect(anchorDisplayLabel({ kind: "image", rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } })).toEqual({
      key: "workspaceSecurity.commentAtImageRegion",
    });
  });

  it("reads the column one-based and keeps the row as stored", () => {
    // Row 0 is the header; column 0 is the first one a reader calls "1".
    // No caveat by default (V7): a cell that sits where it was says nothing;
    // only a moved or changed one earns a word.
    expect(anchorDisplayLabel({ kind: "tableCell", row: 2, column: 0 })).toEqual({
      key: "workspaceSecurity.commentAtCell",
      params: { row: 2, column: 1, label: "" },
      caveat: undefined,
    });
    expect(anchorDisplayLabel({ kind: "tableCell", row: 3, column: 0, columnLabel: "Status", moved: true })).toEqual({
      key: "workspaceSecurity.commentAtCellNamed",
      params: { row: 3, column: 1, label: "Status" },
      caveat: "workspaceSecurity.commentCellMoved",
    });
    expect(anchorDisplayLabel({ kind: "tableCell", row: 2, column: 0, changed: true }).caveat).toBe("workspaceSecurity.commentCellChanged");
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

describe("anchorFramesAt", () => {
  it("hands a picture EVERY marking on it, not just one", () => {
    // Two regions on one screenshot is the normal case; the singular helper
    // would show whichever came first and drop the rest.
    const state = apply(stateWith(), [
      { commentId: "a", from: PIC_FROM, to: PIC_TO, frame: { kind: "image", rect: { x: 0, y: 0, w: 0.4, h: 0.4 } } },
      { commentId: "b", from: PIC_FROM, to: PIC_TO, frame: { kind: "image", rect: { x: 0.5, y: 0.5, w: 0.3, h: 0.3 } } },
    ]);
    expect(anchorFramesAt(state, PIC_FROM, PIC_TO).map((f) => f.commentId).sort()).toEqual(["a", "b"]);
    expect(anchorFrameAt(state, PIC_FROM, PIC_TO)?.commentId).toBe("a");
    expect(anchorFramesAt(state, TABLE_FROM, TABLE_TO)).toEqual([]);
  });

  it("puts the open card's marking last, so it is drawn on top", () => {
    const state = apply(stateWith(), [
      { commentId: "open", from: PIC_FROM, to: PIC_TO, active: true, frame: { kind: "image", rect: { x: 0, y: 0, w: 0.4, h: 0.4 } } },
      { commentId: "quiet", from: PIC_FROM, to: PIC_TO, frame: { kind: "image", rect: { x: 0.1, y: 0.1, w: 0.4, h: 0.4 } } },
    ]);
    expect(anchorFramesAt(state, PIC_FROM, PIC_TO).map((f) => f.commentId)).toEqual(["quiet", "open"]);
  });

  it("carries the region through, so the widget can place it", () => {
    const rect = { x: 0.25, y: 0.5, w: 0.25, h: 0.125 };
    const state = apply(stateWith(), [{ commentId: "c1", from: PIC_FROM, to: PIC_TO, frame: { kind: "image", rect } }]);
    expect(anchorFramesAt(state, PIC_FROM, PIC_TO)[0]?.rect).toEqual(rect);
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

  it("changes when a marking moves inside the picture", () => {
    // An edit can shift a region; without this the widget keeps the DOM it has
    // and the marking stays where it was drawn.
    const framed = { commentId: "c1", kind: "image", active: false, rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } } as const;
    expect(anchorFrameSignature(framed)).not.toBe(anchorFrameSignature({ ...framed, rect: { x: 0.3, y: 0.1, w: 0.2, h: 0.2 } }));
    // A comment on the whole picture is a different drawing from one on a spot.
    expect(anchorFrameSignature({ commentId: "c1", kind: "image", active: false })).not.toBe(anchorFrameSignature(framed));
  });
});

describe("anchorFramesSignature", () => {
  it("changes when one of several markings changes", () => {
    const a = { commentId: "a", kind: "image", active: false, rect: { x: 0, y: 0, w: 0.2, h: 0.2 } } as const;
    const b = { commentId: "b", kind: "image", active: false, rect: { x: 0.5, y: 0.5, w: 0.2, h: 0.2 } } as const;
    expect(anchorFramesSignature([])).toBe("");
    expect(anchorFramesSignature([a, b])).not.toBe(anchorFramesSignature([a]));
    expect(anchorFramesSignature([a, b])).not.toBe(anchorFramesSignature([a, { ...b, rect: { x: 0.6, y: 0.5, w: 0.2, h: 0.2 } }]));
    // Order matters: it decides which marking is drawn on top.
    expect(anchorFramesSignature([a, b])).not.toBe(anchorFramesSignature([b, a]));
  });
});

describe("toAnchorFrameHint", () => {
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };

  it("carries a region on a picture and drops one anywhere else", () => {
    // The core refuses to seal a rect on anything but an image; dropping a
    // stray one here keeps a foreign writer from drawing a rectangle over a
    // table.
    expect(toAnchorFrameHint({ kind: "image", rect })).toEqual({ kind: "image", row: undefined, column: undefined, rect });
    expect(toAnchorFrameHint({ kind: "diagram", rect })?.rect).toBeUndefined();
    expect(toAnchorFrameHint({ kind: "tableCell", row: 1, column: 0, rect })?.rect).toBeUndefined();
  });

  it("leaves a property without a frame - there is no range to draw around", () => {
    expect(toAnchorFrameHint({ kind: "property", key: "status" })).toBeUndefined();
    expect(toAnchorFrameHint(undefined)).toBeUndefined();
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

describe("insertion points in the editor (V3)", () => {
  it("draws only the widget for an empty range with a proposal, and nothing for an empty plain range", () => {
    const withProposal = apply(stateWith(), [{ commentId: "i1", from: 5, to: 5, suggestion: { replacement: "more" } }]);
    expect(markRanges(withProposal)).toEqual([{ from: 5, to: 5 }]);
    const plain = apply(stateWith(), [{ commentId: "c1", from: 5, to: 5 }]);
    expect(markRanges(plain)).toEqual([]);
  });
});

describe("the corner triangle on a commented cell (Tabellenzelle, V7)", () => {
  it("names the comment on mousedown even though the table owns its events", () => {
    const activated: string[] = [];
    const view = new EditorView({ state: EditorState.create({ doc: DOC, extensions: [anchorHighlightExtension((id) => activated.push(id))] }), parent: document.body });
    try {
      const cell = document.createElement("td");
      cell.textContent = "Palette";
      decorateAnchorTarget({
        view,
        host: cell,
        target: cell,
        range: { from: 0, to: 5 },
        display: { kind: "tableCell", row: 1, column: 1 },
        frame: { kind: "tableCell", row: 1, column: 1, commentId: "c1", active: false },
        corner: { label: "Open" },
      });
      const corner = cell.querySelector<HTMLButtonElement>(".cm-anchor-corner");
      expect(corner?.getAttribute("data-pv-comment")).toBe("c1");
      expect(cell.classList.contains("cm-anchor-cell")).toBe(true);
      // No outline class: the triangle stays inside the cell.
      expect(cell.classList.contains("cm-anchor-frame")).toBe(false);
      const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
      corner?.dispatchEvent(event);
      expect(activated).toEqual(["c1"]);
      // The caret must not land in the source behind the widget.
      expect(event.defaultPrevented).toBe(true);
    } finally {
      view.destroy();
    }
  });
});
