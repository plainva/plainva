import { describe, it, expect } from "vitest";
import {
  buildMarkdownTable,
  planTableInsertion,
  parseMarkdownTable,
  serializeTable,
  setCell,
  insertRow,
  deleteRow,
  insertColumn,
  deleteColumn,
  setColumnAlign,
} from "./tableModel";

const sample = () =>
  parseMarkdownTable("| H1 | H2 |\n| :-- | --: |\n| a | b |\n| c | d |")!;

describe("buildMarkdownTable", () => {
  it("builds a header row, delimiter and (rows-1) body rows", () => {
    const { text } = buildMarkdownTable(3, 2, "Spalte");
    const lines = text.split("\n");
    expect(lines[0]).toBe("| Spalte 1 | Spalte 2 |");
    expect(lines[1]).toBe("| --- | --- |");
    expect(lines.length).toBe(4); // header + delimiter + 2 body rows
    expect(lines.slice(2).every((l) => l === "|  |  |")).toBe(true);
  });

  it("selects the first header-cell placeholder", () => {
    const { text, selFrom, selTo } = buildMarkdownTable(2, 3, "Col");
    expect(text.slice(selFrom, selTo)).toBe("Col 1");
  });

  it("clamps to at least one row and column", () => {
    expect(buildMarkdownTable(0, 0, "C").text).toBe("| C 1 |\n| --- |");
  });

  it("uses the given column label and column count", () => {
    const { text } = buildMarkdownTable(1, 3, "Column");
    expect(text.split("\n")[0]).toBe("| Column 1 | Column 2 | Column 3 |");
  });
});

describe("parseMarkdownTable / serializeTable", () => {
  it("parses headers, alignments and rows", () => {
    const src = "| H1 | H2 | H3 |\n| :-- | :-: | --: |\n| a | b | c |\n| d | e | f |";
    expect(parseMarkdownTable(src)).toEqual({
      headers: ["H1", "H2", "H3"],
      aligns: ["left", "center", "right"],
      rows: [["a", "b", "c"], ["d", "e", "f"]],
    });
  });

  it("round-trips through serializeTable", () => {
    const src = "| H1 | H2 | H3 |\n| :-- | :-: | --: |\n| a | b | c |\n| d | e | f |";
    const model = parseMarkdownTable(src)!;
    expect(serializeTable(model)).toBe(src);
  });

  it("normalizes ragged rows to the header width", () => {
    const m = parseMarkdownTable("| A | B | C |\n| --- | --- | --- |\n| 1 |\n| 1 | 2 | 3 | 4 |")!;
    expect(m.rows).toEqual([["1", "", ""], ["1", "2", "3"]]);
  });

  it("preserves escaped pipes inside cells", () => {
    const m = parseMarkdownTable("| A |\n| --- |\n| x \\| y |")!;
    expect(m.rows[0][0]).toBe("x | y");
    expect(serializeTable(m)).toBe("| A |\n| --- |\n| x \\| y |");
  });

  it("returns null when the second line is not a delimiter", () => {
    expect(parseMarkdownTable("| not | a |\n| table | here |")).toBeNull();
    expect(parseMarkdownTable("just text")).toBeNull();
  });
});

describe("planTableInsertion", () => {
  const T = "| H |\n| --- |\n|  |"; // stand-in table text

  // The caret must land on a line that is NOT part of the table, so the live
  // widget renders immediately instead of staying raw markdown.
  const caretLineIsOutsideTable = (doc: string, pos: number) => {
    const prev = pos >= 1 ? doc[pos - 1] : "";
    const prevPrev = pos >= 2 ? doc[pos - 2] : "";
    const next = pos < doc.length ? doc[pos] : "";
    const nextNext = pos + 1 < doc.length ? doc[pos + 1] : "";
    const { insert, caretOffset } = planTableInsertion(T, prev, prevPrev, next, nextNext);
    const after = doc.slice(0, pos) + insert + doc.slice(pos);
    const caret = pos + caretOffset;
    // The line containing the caret must not contain a table pipe row.
    const lineStart = after.lastIndexOf("\n", caret - 1) + 1;
    let lineEnd = after.indexOf("\n", caret);
    if (lineEnd === -1) lineEnd = after.length;
    return { after, caretLine: after.slice(lineStart, lineEnd) };
  };

  it("caret on an empty line with a blank line above (the /table-on-empty-line case): no extra padding, caret below table", () => {
    const doc = "text\n\n";
    const pos = doc.length;
    const { insert, caretOffset } = planTableInsertion(T, "\n", "\n", "", "");
    expect(insert).toBe(T + "\n"); // no prefix, single trailing line
    expect(caretOffset).toBe(T.length + 1);
    expect(caretLineIsOutsideTable(doc, pos).caretLine).not.toContain("|");
  });

  it("caret at end of a text line: inserts a blank line BEFORE the table (GFM block boundary)", () => {
    const { insert } = planTableInsertion(T, "!", "o", "", "");
    expect(insert.startsWith("\n\n")).toBe(true); // blank line before
    expect(caretLineIsOutsideTable("vault!", 6).caretLine).not.toContain("|");
  });

  it("caret at document start: no leading padding", () => {
    const { insert } = planTableInsertion(T, "", "", "x", "y");
    expect(insert.startsWith("\n")).toBe(false);
  });

  it("caret between two text lines: blank lines both sides, caret outside table", () => {
    const doc = "above\nbelow";
    const pos = 6; // start of "below"
    const { insert } = planTableInsertion(T, "\n", "e", "b", "e");
    expect(insert.startsWith("\n")).toBe(true); // blank line above (prev line not blank)
    expect(insert.endsWith("\n\n")).toBe(true); // blank line below
    expect(caretLineIsOutsideTable(doc, pos).caretLine).not.toContain("|");
  });

  it("never lands the caret on a table row across caret positions", () => {
    const doc = "# Title\n\nsome text\n\n\nmore";
    for (let pos = 0; pos <= doc.length; pos++) {
      expect(caretLineIsOutsideTable(doc, pos).caretLine).not.toContain("|");
    }
  });
});

describe("table model mutations", () => {
  it("setCell replaces a body cell without touching the input", () => {
    const m = sample();
    const next = setCell(m, "body", 0, 1, "X");
    expect(next.rows[0]).toEqual(["a", "X"]);
    expect(m.rows[0]).toEqual(["a", "b"]); // original untouched
  });

  it("setCell replaces a header cell and flattens newlines", () => {
    const m = sample();
    const next = setCell(m, "header", 0, 0, "new\nline");
    expect(next.headers[0]).toBe("new line");
  });

  it("setCell is a no-op for out-of-range indices", () => {
    const m = sample();
    expect(setCell(m, "body", 9, 0, "x")).toBe(m);
    expect(setCell(m, "header", 0, 5, "x")).toBe(m); // colIndex out of range
  });

  it("insertRow adds a blank body row at the given index", () => {
    const next = insertRow(sample(), 1);
    expect(next.rows).toEqual([["a", "b"], ["", ""], ["c", "d"]]);
  });

  it("insertRow clamps the index into range", () => {
    expect(insertRow(sample(), 99).rows).toHaveLength(3);
    expect(insertRow(sample(), -5).rows[0]).toEqual(["", ""]);
  });

  it("deleteRow removes the body row", () => {
    expect(deleteRow(sample(), 0).rows).toEqual([["c", "d"]]);
    expect(deleteRow(sample(), 9)).toEqual(sample()); // out of range = no-op
  });

  it("insertColumn adds an empty column (header, align, every row)", () => {
    const next = insertColumn(sample(), 1);
    expect(next.headers).toEqual(["H1", "", "H2"]);
    expect(next.aligns).toEqual(["left", null, "right"]);
    expect(next.rows).toEqual([["a", "", "b"], ["c", "", "d"]]);
  });

  it("deleteColumn removes the column but keeps at least one", () => {
    const next = deleteColumn(sample(), 0);
    expect(next.headers).toEqual(["H2"]);
    expect(next.aligns).toEqual(["right"]);
    expect(next.rows).toEqual([["b"], ["d"]]);
    const single = parseMarkdownTable("| only |\n| --- |\n| x |")!;
    expect(deleteColumn(single, 0)).toBe(single); // refuses to drop the last column
  });

  it("setColumnAlign updates one column's alignment", () => {
    expect(setColumnAlign(sample(), 0, "center").aligns).toEqual(["center", "right"]);
  });

  it("mutations round-trip back to valid GFM markdown", () => {
    const next = setColumnAlign(insertColumn(setCell(sample(), "body", 0, 0, "z"), 0), 0, "center");
    expect(serializeTable(next)).toBe("|  | H1 | H2 |\n| :-: | :-- | --: |\n|  | z | b |\n|  | c | d |");
  });
});
