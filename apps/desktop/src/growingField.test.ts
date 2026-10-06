import { describe, expect, it } from "vitest";
import { asSingleLineValue, editTextToTableCell, tableCellToEditText } from "@plainva/ui";
import { parseMarkdownTable, serializeTable, setCell } from "../../../packages/ui/src/components/tableModel";

/** The two text rules behind the cell editors that grow with their text (issue 118). */
describe("a database cell stays one value", () => {
  it("turns a pasted line break into a space and swallows the indentation around it", () => {
    expect(asSingleLineValue("first line\nsecond line")).toBe("first line second line");
    expect(asSingleLineValue("a  \r\n   b\n\nc")).toBe("a b c");
  });

  it("leaves text without a line break exactly as it is", () => {
    const text = "  spaced   out, with a | pipe and a \\ backslash  ";
    expect(asSingleLineValue(text)).toBe(text);
  });
});

describe("a Markdown table cell carries its line breaks as <br>", () => {
  it("opens every spelling of the break as a real line", () => {
    expect(tableCellToEditText("one<br>two<br/>three<BR />four")).toBe("one\ntwo\nthree\nfour");
  });

  it("writes every line break back as <br>", () => {
    expect(editTextToTableCell("one\ntwo\r\nthree")).toBe("one<br>two<br>three");
  });

  it("round-trips a cell through the table source, pipes and backslashes included", () => {
    const table = parseMarkdownTable("| A | B |\n| --- | --- |\n| x | y |")!;
    const edited = "a \\| pipe\nand a \\ backslash";
    const next = setCell(table, "body", 0, 1, editTextToTableCell(edited));
    const source = serializeTable(next);
    // One source line per table row: the break never reaches the Markdown as a newline.
    expect(source.split("\n")).toHaveLength(3);
    expect(source).toContain("<br>");
    const reread = parseMarkdownTable(source)!;
    expect(tableCellToEditText(reread.rows[0][1])).toBe(tableCellToEditText(next.rows[0][1]));
  });

  it("does not turn a break-free cell into anything else", () => {
    const cell = "**bold** and `code` and [[Link]]";
    expect(editTextToTableCell(tableCellToEditText(cell))).toBe(cell);
  });
});
