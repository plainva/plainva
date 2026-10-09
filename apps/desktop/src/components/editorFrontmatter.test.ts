import { afterEach, describe, expect, it, vi } from "vitest";
import { EditorState, Text, type TextIterator } from "@codemirror/state";
import { frontmatterSpan } from "@plainva/core";
import { frontmatterHidePlugin } from "@plainva/ui";
import { FRONTMATTER_FORMS } from "../../../../packages/core/test/fixtures/frontmatterForms";
import { frontmatterLines, frontmatterYamlOf } from "../../../../packages/ui/src/components/editorFrontmatter";

/**
 * The editor's reading of the properties block against the one definition
 * (finding 2026-10-09).
 *
 * `frontmatterSpan` reads a string; the editor holds lines and must not turn
 * them into a string on every transaction. So the rule is read a second time,
 * on the lines — and this is what keeps the two from drifting apart: the same
 * table the definition is held against the Markdown parser with, and a run
 * over generated notes.
 */

/** The document the editor holds for a note's text: split into lines, whatever the line endings were. */
const docOf = (text: string) => EditorState.create({ doc: text }).doc;
/** The number of the line that begins at `offset`, counted in the note as it is on disk. */
const lineNumberAt = (text: string, offset: number) => text.slice(0, offset).split("\n").length;

describe("frontmatterLines and the definition", () => {
  it.each(FRONTMATTER_FORMS.map((form) => [JSON.stringify(form), form] as const))("agrees on %s", (_label, form) => {
    const doc = docOf(form);
    const block = frontmatterLines(doc);
    // The note as it is on disk, with the line endings it has there.
    const span = frontmatterSpan(form);
    if (!span) {
      expect(block).toBeNull();
      return;
    }
    expect(block).not.toBeNull();
    expect(block!.closeLine).toBe(lineNumberAt(form, span.closeAt));
    expect(frontmatterYamlOf(doc, block!)).toBe(span.yaml.replace(/\r\n/g, "\n"));

    // And by its offsets, in the text the editor holds and writes back.
    const held = frontmatterSpan(doc.toString())!;
    expect(doc.lineAt(held.closeAt).number).toBe(block!.closeLine);
    expect(block!.closeTo).toBe(doc.line(block!.closeLine).to);
    expect(block!.end).toBe(held.end);
  });

  it("gives the definition's answer on 20 000 generated notes", () => {
    const LINES = ["---", "---", "---", "--- ", "---\t ", "----", " ---", "---x", "...", "", "", "a: 1", "b: [x, y]", "# Heading", "text --- text", "- item"];
    const MARK = String.fromCharCode(0xfeff);
    // mulberry32: the same notes on every machine and every run.
    let state = 20261009;
    const next = (below: number) => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) % below;
    };
    const seen = { none: 0, block: 0, empty: 0, blanks: 0, mark: 0, windows: 0 };

    for (let run = 0; run < 20_000; run++) {
      // Up to seven lines, each with its own line ending; the last may lack
      // one. Two notes in three open with a fence, one in eight with a mark.
      const count = next(8);
      let note = next(8) === 0 ? MARK : "";
      for (let i = 0; i < count; i++) {
        const last = i === count - 1;
        const text = i === 0 && next(3) > 0 ? "---" : LINES[next(LINES.length)];
        note += text + (last && next(2) === 0 ? "" : next(4) === 0 ? "\r\n" : "\n");
      }
      const doc = docOf(note);
      const block = frontmatterLines(doc);
      const held = doc.toString();
      const span = frontmatterSpan(held);
      // The note on disk and the text the editor holds have the same block.
      const onDisk = frontmatterSpan(note);
      expect(onDisk === null, JSON.stringify(note)).toBe(span === null);

      if (!span) {
        expect(block, JSON.stringify(note)).toBeNull();
        seen.none++;
        continue;
      }
      const closeLine = doc.lineAt(span.closeAt);
      expect(block, JSON.stringify(note)).toEqual({ closeLine: closeLine.number, closeTo: closeLine.to, end: span.end });
      expect(frontmatterYamlOf(doc, block!), JSON.stringify(note)).toBe(span.yaml);
      expect(lineNumberAt(note, onDisk!.closeAt), JSON.stringify(note)).toBe(block!.closeLine);

      seen.block++;
      if (block!.closeLine === 2) seen.empty++;
      if (doc.line(1).text.length > (note.startsWith(MARK) ? 4 : 3) || closeLine.text.length > 3) seen.blanks++;
      if (note.startsWith(MARK)) seen.mark++;
      if (note.includes("\r\n")) seen.windows++;
    }

    // The generator reaches every case, or the run proves nothing.
    expect(seen.none).toBeGreaterThan(1_000);
    expect(seen.block).toBeGreaterThan(5_000);
    expect(seen.empty).toBeGreaterThan(1_000);
    expect(seen.blanks).toBeGreaterThan(500);
    expect(seen.mark).toBeGreaterThan(500);
    expect(seen.windows).toBeGreaterThan(1_000);
  });
});

describe("frontmatterLines", () => {
  it("gives the block by its closing line and the two offsets behind it", () => {
    const doc = docOf("---\ntitle: X\ntags: [a]\n---\n# Body\n");
    expect(frontmatterLines(doc)).toEqual({ closeLine: 4, closeTo: 26, end: 27 });
    expect(frontmatterYamlOf(doc, frontmatterLines(doc)!)).toBe("title: X\ntags: [a]");
    expect(doc.sliceString(frontmatterLines(doc)!.end)).toBe("# Body\n");
  });

  it("ends a block that closes the document at the document's end", () => {
    const doc = docOf("---\na: 1\n---");
    expect(frontmatterLines(doc)).toEqual({ closeLine: 3, closeTo: 12, end: 12 });
  });

  it("takes `---` directly on `---` for a block without a line, and a blank line between them for an empty one", () => {
    const empty = docOf("---\n---\nText");
    expect(frontmatterLines(empty)).toEqual({ closeLine: 2, closeTo: 7, end: 8 });
    expect(frontmatterYamlOf(empty, frontmatterLines(empty)!)).toBe("");
    const blank = docOf("---\n\n\n---\nText");
    expect(frontmatterLines(blank)!.closeLine).toBe(4);
    expect(frontmatterYamlOf(blank, frontmatterLines(blank)!)).toBe("\n");
  });

  it("reads a carriage return of its own as the line break the editor made of it", () => {
    // The editor splits at a lone carriage return as well and writes a line
    // feed back, so this is the answer for the note as it will be saved. The
    // definition reads `\n` and `\r\n`: asked about the file as it still is,
    // it sees one long line.
    const classicMac = "---\ra: 1\r---\rBody";
    const doc = docOf(classicMac);
    expect(doc.toString()).toBe("---\na: 1\n---\nBody");
    expect(frontmatterLines(doc)!.end).toBe(frontmatterSpan(doc.toString())!.end);
    expect(frontmatterSpan(classicMac)).toBeNull();
  });
});

describe("what asking costs", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads a document once, however often it is asked about", () => {
    const scans = vi.spyOn(Text.prototype, "iterLines");
    const withBlock = docOf("---\na: 1\n---\nBody");
    const first = frontmatterLines(withBlock);
    expect(frontmatterLines(withBlock)).toBe(first);
    const without = docOf("---\na: 1\nBody");
    expect(frontmatterLines(without)).toBeNull();
    expect(frontmatterLines(without)).toBeNull();
    expect(scans).toHaveBeenCalledTimes(2);
  });

  it("scans nothing for a caret move, and once for an edit — also where the note opens with a fence and never closes", () => {
    // The worst case: no closing fence, so a scan runs to the last line. The
    // transaction filter asks on every transaction, the field on every edit.
    const text = "---\n" + "a line of text that is not a fence\n".repeat(5_000);
    const scans = vi.spyOn(Text.prototype, "iterLines");
    let state = EditorState.create({ doc: text, extensions: [frontmatterHidePlugin(true)] });
    expect(scans).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 100; i++) state = state.update({ selection: { anchor: 10 + i } }).state;
    expect(scans).toHaveBeenCalledTimes(1);

    for (let i = 0; i < 10; i++) state = state.update({ changes: { from: state.doc.length, insert: "x" }, userEvent: "input.type" }).state;
    expect(scans).toHaveBeenCalledTimes(11);
    expect(state.doc.length).toBe(text.length + 10);
  });

  it("reads a long note without a closing fence in one pass", () => {
    const lines = ["---"];
    for (let i = 0; i < 200_000; i++) lines.push("a line of text that is not a fence");
    const doc = Text.of(lines);
    const started = performance.now();
    expect(frontmatterLines(doc)).toBeNull();
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("stops at the closing fence, however long the note behind it is", () => {
    const block = ["---", "a: 1", "---"];
    const doc = Text.of([...block, ...Array.from({ length: 1_000 }, () => "text")]);
    // A cursor that hands out the block's lines and refuses to go on.
    let handed = 0;
    const cursor = {
      value: "",
      done: false,
      lineBreak: false,
      next() {
        if (handed === block.length) throw new Error("read past the closing fence");
        cursor.value = block[handed++];
        return cursor;
      },
    };
    vi.spyOn(doc, "iterLines").mockReturnValue(cursor as unknown as TextIterator);
    expect(frontmatterLines(doc)).toEqual({ closeLine: 3, closeTo: 12, end: 13 });
    expect(handed).toBe(3);
  });
});
