import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { frontmatterStateField, frontmatterProtectPlugin } from "./LivePreviewPlugin";

const FM_DOC = "---\ntitle: Test\ntags: [a]\n---\nBody line\n";
// End of the protected range: just past the closing fence's trailing newline.
const FM_END = FM_DOC.indexOf("---\nBody") + 4;

function decoRanges(deco: DecorationSet): { from: number; to: number }[] {
  const out: { from: number; to: number }[] = [];
  const it = deco.iter();
  while (it.value) {
    out.push({ from: it.from, to: it.to });
    it.next();
  }
  return out;
}

describe("frontmatterStateField", () => {
  it("hides the whole frontmatter block (incl. trailing newline) in live mode", () => {
    const field = frontmatterStateField(true);
    const state = EditorState.create({ doc: FM_DOC, extensions: [field] });
    const ranges = decoRanges(state.field(field));
    expect(ranges).toEqual([{ from: 0, to: FM_END }]);
  });

  it("marks each frontmatter line with cm-frontmatter in source mode instead of hiding", () => {
    const field = frontmatterStateField(false);
    const state = EditorState.create({ doc: FM_DOC, extensions: [field] });
    const ranges = decoRanges(state.field(field));
    // One zero-length line decoration per frontmatter line (4 lines: ---, title, tags, ---)
    expect(ranges).toHaveLength(4);
    expect(ranges.every((r) => r.from === r.to)).toBe(true);
    expect(ranges[0].from).toBe(0);
  });

  it("produces no decorations without frontmatter", () => {
    const field = frontmatterStateField(true);
    const state = EditorState.create({ doc: "# Just a heading\n", extensions: [field] });
    expect(decoRanges(state.field(field))).toEqual([]);
  });

  it("produces no decorations for an unclosed frontmatter fence", () => {
    const field = frontmatterStateField(true);
    const state = EditorState.create({ doc: "---\ntitle: open\nBody", extensions: [field] });
    expect(decoRanges(state.field(field))).toEqual([]);
  });

  it("recomputes when the document changes (closing fence typed later)", () => {
    const field = frontmatterStateField(true);
    const state = EditorState.create({ doc: "---\ntitle: open\nBody", extensions: [field] });
    const tr = state.update({ changes: { from: 16, to: 16, insert: "---\n" } }); // -> "---\ntitle: open\n---\nBody"
    expect(decoRanges(tr.state.field(field))).toEqual([{ from: 0, to: 20 }]);
  });
});

describe("frontmatterProtectPlugin (live mode)", () => {
  const mkState = () => EditorState.create({ doc: FM_DOC, extensions: [frontmatterProtectPlugin(true)] });

  it("rejects typing inside the frontmatter", () => {
    const state = mkState();
    const tr = state.update({ changes: { from: 6, to: 6, insert: "x" }, userEvent: "input" });
    expect(tr.newDoc.toString()).toBe(FM_DOC);
  });

  it("rejects deletions inside the frontmatter", () => {
    const state = mkState();
    const tr = state.update({ changes: { from: 4, to: 9, insert: "" }, userEvent: "delete" });
    expect(tr.newDoc.toString()).toBe(FM_DOC);
  });

  it("allows typing in the body", () => {
    const state = mkState();
    const tr = state.update({ changes: { from: FM_DOC.length, to: FM_DOC.length, insert: "more" }, userEvent: "input" });
    expect(tr.newDoc.toString()).toBe(FM_DOC + "more");
  });

  it("allows programmatic frontmatter writes (Properties panel path)", () => {
    const state = mkState();
    // No userEvent: this is how applyFrontmatter dispatches — must not be blocked.
    const tr = state.update({ changes: { from: 4, to: 15, insert: "title: Neu" } });
    expect(tr.newDoc.toString()).toContain("title: Neu");
  });

  it("clamps selections out of the frontmatter", () => {
    const state = mkState();
    const tr = state.update({ selection: { anchor: 2 } });
    expect(tr.newSelection.main.anchor).toBe(FM_END);
    expect(tr.newSelection.main.head).toBe(FM_END);
  });

  it("does nothing for documents without frontmatter", () => {
    const state = EditorState.create({ doc: "plain body", extensions: [frontmatterProtectPlugin(true)] });
    const tr = state.update({ changes: { from: 0, to: 0, insert: "x" }, userEvent: "input" });
    expect(tr.newDoc.toString()).toBe("xplain body");
  });
});
