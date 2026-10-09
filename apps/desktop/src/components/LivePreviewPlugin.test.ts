import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import type { DecorationSet } from "@codemirror/view";
import { frontmatterStateField, frontmatterProtectPlugin } from "@plainva/ui";

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

/**
 * The editor reads the block as the one definition does (finding 2026-10-09).
 *
 * Its own scans wanted a line that is exactly `---`. A fence with blanks
 * behind it was a block for the index, the properties panel and every writer
 * and text for the editor: the lines stood in the note as a rule and a
 * heading, open to typing, while the panel beside them showed their
 * properties. An editor holds a note without its byte order mark; where a
 * document starts with one all the same, the block behind it is the block and
 * the mark goes with it.
 */
describe("every form of the block the definition reads", () => {
  const MARK = String.fromCharCode(0xfeff);
  const BODY = "Body line\n";
  const HEADS: [name: string, head: string][] = [
    ["blanks behind either fence", "--- \ntitle: Test\n---\t\n"],
    ["the empty block", "---\n---\n"],
    ["a blank line between the fences", "---\n\n---\n"],
    ["a byte order mark in front of the opening fence", `${MARK}---\ntitle: Test\n---\n`],
    ["a byte order mark in front of an empty block with blanks", `${MARK}---  \n--- \n`],
  ];

  it.each(HEADS)("is hidden in live mode, up to the note's text: %s", (_name, head) => {
    const field = frontmatterStateField(true);
    const state = EditorState.create({ doc: head + BODY, extensions: [field] });
    expect(decoRanges(state.field(field))).toEqual([{ from: 0, to: head.length }]);
  });

  it.each(HEADS)("is marked line by line in source mode: %s", (_name, head) => {
    const field = frontmatterStateField(false);
    const state = EditorState.create({ doc: head + BODY, extensions: [field] });
    const lineStarts = head.split("\n").slice(0, -1).map((_line, index, lines) => lines.slice(0, index).join("\n").length + (index > 0 ? 1 : 0));
    expect(decoRanges(state.field(field))).toEqual(lineStarts.map((at) => ({ from: at, to: at })));
  });

  it.each(HEADS)("is closed to typing and to the caret in live mode: %s", (_name, head) => {
    const doc = head + BODY;
    const state = EditorState.create({ doc, extensions: [frontmatterProtectPlugin(true)] });
    // At the very start, inside, and at the end of the closing fence.
    for (const at of [0, 2, head.length - 1]) {
      const typed = state.update({ changes: { from: at, insert: "x" }, userEvent: "input.type" });
      expect(typed.newDoc.toString(), `typing at ${at}`).toBe(doc);
    }
    // The first character cannot be deleted: a byte order mark stays where it is.
    expect(state.update({ changes: { from: 0, to: 1 }, userEvent: "delete.backward" }).newDoc.toString()).toBe(doc);
    // The note's text is open, from its first character on.
    const typed = state.update({ changes: { from: head.length, insert: "x" }, userEvent: "input.type" });
    expect(typed.newDoc.toString()).toBe(`${head}x${BODY}`);
    // A caret set into the block lands at the start of the text.
    const moved = state.update({ selection: { anchor: 1 } });
    expect(moved.newSelection.main.anchor).toBe(head.length);
    expect(moved.newSelection.main.head).toBe(head.length);
    // A write that is not the user's typing still gets through (the properties panel).
    expect(state.update({ changes: { from: 0, to: head.length, insert: "---\ntitle: Neu\n---\n" } }).newDoc.toString()).toBe(`---\ntitle: Neu\n---\n${BODY}`);
  });

  it("closes on the first fence: a rule further down stays in the note's text", () => {
    const doc = "---\n---\n\ntext\n\n---\n\nmore\n";
    const field = frontmatterStateField(true);
    const state = EditorState.create({ doc, extensions: [field, frontmatterProtectPlugin(true)] });
    expect(decoRanges(state.field(field))).toEqual([{ from: 0, to: 8 }]);
    const at = doc.indexOf("more");
    expect(state.update({ changes: { from: at, insert: "x" }, userEvent: "input.type" }).newDoc.toString()).toBe(doc.replace("more", "xmore"));
  });

  it("is no block where a line only looks like a fence", () => {
    const field = frontmatterStateField(true);
    for (const doc of [
      "----\ntitle: x\n----\nBody", // four dashes
      " ---\ntitle: x\n---\nBody", // indented
      "--- x\ntitle: x\n---\nBody", // text behind the dashes
      "---\ntitle: x\n ---\nBody", // the closing line is indented
      "---\ntitle: x\n...\nBody", // the YAML document end closes nothing
      `---\ntitle: x\n${MARK}---\nBody`, // a mark belongs in front of the first line only
      "---", // a rule
      "---\n", // a rule
      "\n---\ntitle: x\n---\nBody", // not on the first line
    ]) {
      const state = EditorState.create({ doc, extensions: [field, frontmatterProtectPlugin(true)] });
      expect(decoRanges(state.field(field)), JSON.stringify(doc)).toEqual([]);
      expect(state.update({ changes: { from: 0, insert: "x" }, userEvent: "input.type" }).newDoc.toString(), JSON.stringify(doc)).toBe(`x${doc}`);
    }
  });

  it("follows the fences as they are typed", () => {
    const field = frontmatterStateField(true);
    let state = EditorState.create({ doc: "--- \ntitle: open\nBody", extensions: [field] });
    expect(decoRanges(state.field(field))).toEqual([]);
    // The closing fence arrives, with a blank behind it.
    state = state.update({ changes: { from: 17, insert: "--- \n" } }).state;
    expect(state.doc.toString()).toBe("--- \ntitle: open\n--- \nBody");
    expect(decoRanges(state.field(field))).toEqual([{ from: 0, to: 22 }]);
    // Text behind the opening dashes: no fence, no block.
    state = state.update({ changes: { from: 4, insert: "x" } }).state;
    expect(decoRanges(state.field(field))).toEqual([]);
  });
});
