import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { Decoration } from "@codemirror/view";
import { overBudgetInlineRanges, prepareReaderSource } from "@plainva/core";
import { boundReaderMarkdown } from "@plainva/ui";
import { readAsText, readAsTextField, readAsTextTouches, withoutReadAsText } from "../../../../packages/ui/src/components/readAsText";

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
      const editor = EditorState.create({ doc: text, extensions: [readAsText()] }).field(readAsTextField);
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
    const [range] = state.field(readAsTextField);
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
    const [before] = state.field(readAsTextField);
    const after = state.update({ changes: { from: 0, insert: "xyz\n" } }).state.field(readAsTextField);
    expect(after[0].from).toBe(before.from + 4);
    expect(after[0].to).toBe(before.to + 4);
  });

  it("is in the editor of both shells, and so is the notice over the note", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    // The one editor session both shells build: the stretches are known to every drawing of it.
    expect(read("../../../../packages/ui/src/components/editorSession.ts")).toMatch(/\n\s+readAsText\(\),/);
    expect(read("./Editor.tsx")).toMatch(/<ReadAsTextNotice content=\{content\}/);
    expect(read("../../../mobile/src/EditorHost.tsx")).toMatch(/<ReadAsTextNotice content=\{noticeText\}/);
    // The reading view reads the note's stretches (the original and its preparation handed in), the editor's.
    expect(read("./MarkdownReader.tsx")).toMatch(/boundReaderMarkdown\(source\.text, \{ original: content, source \}\)/);
  });
});
