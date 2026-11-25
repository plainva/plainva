// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { overBudgetInlineRanges, prepareReaderSource, readAsTextParts } from "@plainva/core";
import { boundReaderMarkdown } from "@plainva/ui";
import { readAsText, readAsTextField, readAsTextTouches, withoutReadAsText, type ReadAsTextState } from "../../../../packages/ui/src/components/readAsText";
import { EditorView } from "@codemirror/view";

/**
 * The editor and the reading view decide alike what of a note is read as text
 * (L14, Gesamtplan Leistung § 3a.2): the editor's field holds the stretches of
 * the parse budget, the live preview draws nothing there, and the reading view
 * reads the same stretches as written. Both shells build their editor from the
 * one session (`createEditorSession`), and both show the notice
 * (`ReadAsTextNotice`); the guards at the end hold that.
 */

const around = (stretch: string) => `---\ntitle: T\n---\n\n# Title\n\nBefore [[Kept]] and *em*.\n\n${stretch}\n\n## After\n\nThe end.\n`;
const NOTES: Record<string, string> = {
  // The note's budget: a list of 20 000 linked tasks (B1).
  list: around(Array.from({ length: 20_000 }, (_, i) => `- [ ] item ${i} [[Note ${i}]]`).join("\n")),
  // A paragraph's budget, a table's budget.
  longLine: around("]".repeat(100_000)),
  table: around(["| a | b |", "|---|---|", ...Array.from({ length: 6_000 }, (_, i) => `| row ${i} | [[n${i}]] |`)].join("\n")),
  // Under every budget.
  small: around(Array.from({ length: 300 }, (_, i) => `- [ ] item ${i} [[Note ${i}]]`).join("\n")),
};

describe("what of a note is read as text (L14)", () => {
  for (const [name, text] of Object.entries(NOTES)) {
    it(`${name}: the editor and the reading view read the same stretches as text`, () => {
      const editor = EditorState.create({ doc: text, extensions: [readAsText()] }).field(readAsTextField).ranges;
      expect(editor).toEqual(overBudgetInlineRanges(text));
      if (name === "small") expect(editor).toEqual([]);
      else expect(editor.length).toBeGreaterThan(0);
      // The reading view gets the note prepared (its properties block aside); every stretch of the editor's is one of its own there.
      const source = prepareReaderSource(text);
      const reader = boundReaderMarkdown(source.text, { original: text, source }).ranges;
      for (const range of editor) {
        const from = source.toRendered(range.from);
        const to = source.toRendered(range.to, "end");
        expect(reader.some((own) => own.from <= from && to <= own.to), `${name}: ${range.from}..${range.to}`).toBe(true);
      }
    });
  }

  it("draws nothing in a stretch read as text, everything outside it", () => {
    const text = NOTES.list;
    const state = EditorState.create({ doc: text, extensions: [readAsText()] });
    const [range] = state.field(readAsTextField).ranges;
    const kept = text.indexOf("[[Kept]]");
    const inside = text.indexOf("[[Note 7]]");
    expect(readAsTextTouches(state, inside, inside + 10)).toBe(true);
    expect(readAsTextTouches(state, kept, kept + 8)).toBe(false);
    const mark = Decoration.mark({ class: "x" });
    const set = Decoration.set([mark.range(kept, kept + 8), mark.range(inside, inside + 10), mark.range(range.to - 5, range.to + 3)]);
    const drawn: number[] = [];
    withoutReadAsText(state, set).between(0, text.length, (from) => {
      drawn.push(from);
    });
    expect(drawn).toEqual([kept]);
  });

  it("moves its stretches with an edit until the note is scanned again", () => {
    const state = EditorState.create({ doc: NOTES.list, extensions: [readAsText()] });
    const [before] = state.field(readAsTextField).ranges;
    const after = state.update({ changes: { from: 0, insert: "xyz\n" } }).state.field(readAsTextField).ranges;
    expect(after[0].from).toBe(before.from + 4);
    expect(after[0].to).toBe(before.to + 4);
  });

  it("holds its blocks while it is typed in: one keystroke at the threshold turns none back and forth", async () => {
    expect.hasAssertions();
    // A list at the threshold: one more item, and it is read as text (the review of 2026-11-19, c2).
    const list = (n: number) => `# T\n\n${Array.from({ length: n }, (_, i) => `- item a${i} [[Note ${i}]]`).join("\n")}\n`;
    let n = 1_000;
    while (!readAsTextParts(list(n)).ranges.some((range) => range.block)) n = Math.ceil(n * 1.1);
    let lo = Math.floor(n / 1.1);
    while (n - lo > 1) {
      const mid = (lo + n) >> 1;
      if (readAsTextParts(list(mid)).ranges.some((range) => range.block)) n = mid;
      else lo = mid;
    }
    const over = list(n);
    const heard: ReadAsTextState[] = [];
    const view = new EditorView({ state: EditorState.create({ doc: over, extensions: [readAsText((found) => heard.push(found))] }) });
    try {
      expect(view.state.field(readAsTextField).ranges.some((range) => range.block)).toBe(true);
      // Delete the last item: the note is under its budget now, by a hair — the editor keeps the block as text.
      const lastItem = over.lastIndexOf("\n- item");
      view.dispatch({ changes: { from: lastItem, to: over.length - 1 } });
      expect(readAsTextParts(view.state.doc.toString()).ranges.some((range) => range.block)).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(view.state.field(readAsTextField).ranges.some((range) => range.block)).toBe(true);
      // Far under it, the block is formatted again; the notice heard every decision.
      view.dispatch({ changes: { from: Math.floor(view.state.doc.length / 2), to: view.state.doc.length - 1 } });
      await new Promise((resolve) => setTimeout(resolve, 600));
      expect(view.state.field(readAsTextField).ranges).toEqual([]);
      expect(heard[0].ranges.length).toBeGreaterThan(0);
      expect(heard[heard.length - 1].ranges).toEqual([]);
    } finally {
      view.destroy();
    }
  }, 60_000);

  it("keeps among two blocks of about one weight the one it reads as text, whichever is typed in", () => {
    expect.hasAssertions();
    const items = (n: number, tag: string) => Array.from({ length: n }, (_, i) => `- item ${tag}${i} [[Note ${i}]]`).join("\n");
    let n = 500;
    while (!readAsTextParts(`# T\n\n${items(n, "a")}\n\n${items(n, "b")}\n`).ranges.some((range) => range.block)) n += 100;
    const two = (extra: string) => `# T\n\n${items(n, "a")}\n\n${items(n, "b").replace("- item b7 ", `- item b7 ${extra}`)}\n`;
    const chosen = (text: string, previous?: ReturnType<typeof readAsTextParts>["ranges"]) =>
      readAsTextParts(text, undefined, previous).ranges.filter((range) => range.block).map((range) => text.slice(range.from, range.from + 9));
    const first = readAsTextParts(two(""));
    const typed = two("[[x]] [[y]] [[z]] ");
    // From the text alone, the heavier block is read as text; held, the one read so far stays it.
    expect(chosen(typed)).not.toEqual(chosen(two("")));
    const shift = typed.length - two("").length;
    const moved = first.ranges.map((range) => (range.from > typed.indexOf("- item b7") ? { ...range, from: range.from + shift, to: range.to + shift } : range));
    expect(chosen(typed, moved)).toEqual(chosen(two("")));
  });

  it("reads the note's blocks as text in the reading view where the editor and the notice do, the original's decision alone", () => {
    expect.hasAssertions();
    // Wiki links are Markdown links in the shown text: weighed again there, the reading view chose more (c1).
    const list = (n: number) => `# T\n\n${Array.from({ length: n }, (_, i) => `- item a${i} [[Note ${i}]]`).join("\n")}\n`;
    let n = 1_000;
    while (!readAsTextParts(list(n)).ranges.some((range) => range.block)) n += 200;
    for (const text of [list(n - 200), list(n), list(Math.round(n * 0.9))]) {
      const source = prepareReaderSource(text);
      const blocks = boundReaderMarkdown(source.text, { original: text, source }).ranges.filter((range) => range.block);
      const theirs = overBudgetInlineRanges(text).filter((range) => range.block);
      expect(blocks.length).toBe(theirs.length);
    }
  });

  it("is in the editor of both shells, and so is the notice over the note", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    // The one editor session both shells build: the stretches are known to every drawing of it.
    expect(read("../../../../packages/ui/src/components/editorSession.ts")).toMatch(/\n\s+readAsText\(\(found\) => deps\.current\.onReadAsText\?\.\(found\)\),/);
    // The notice reads the editor's own decision in the editor, the text as the reading view reads it in read mode.
    expect(read("./Editor.tsx")).toMatch(/<ReadAsTextNotice state=\{isReadMode \? undefined : readAsTextState\} content=\{isReadMode \? content : undefined\}/);
    expect(read("./Editor.tsx")).toMatch(/onReadAsText: setReadAsTextState,/);
    expect(read("../../../mobile/src/EditorHost.tsx")).toMatch(/<ReadAsTextNotice state=\{readAsTextState\}/);
    // One note budget a shell, set at its start: the phone's calibrated on 128 MB, the desktop's on 512 MB — an
    // asymmetry with its entry in the parity catalog.
    expect(read("../main.tsx")).toMatch(/setPlatformServices\(\{\n(?:\s*\/\/[^\n]*\n)*\s*noteBudget: DESKTOP_NOTE_BUDGET,/);
    expect(read("../../../mobile/src/main.tsx")).toMatch(/setPlatformServices\(\{\n(?:\s*\/\/[^\n]*\n)*\s*noteBudget: NOTE_BUDGET,/);
    expect(read("../../../../packages/ui/src/lib/featureParity.ts")).toMatch(/id: "note-read-formatted-up-to",/);
    // The reading view reads the note's stretches (the original and its preparation handed in), the editor's.
    expect(read("./MarkdownReader.tsx")).toMatch(/boundReaderMarkdown\(source\.text, \{ original: content, source \}\)/);
  });
});
