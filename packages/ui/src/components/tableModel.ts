// Pure helpers for GFM markdown tables. Kept free of DOM/React so the table
// logic stays unit-testable. (Parser/serializer for the live table widget will
// be added here in a later step.)

export interface BuiltTable {
  text: string;
  // Offsets (within `text`) selecting the first header-cell placeholder, so the
  // caller can drop the caret there and let the user overwrite it immediately.
  selFrom: number;
  selTo: number;
}

export type TableAlign = "left" | "center" | "right" | null;

export interface TableModel {
  headers: string[];
  aligns: TableAlign[];
  rows: string[][];
}

const DELIM_CELL = /^:?-+:?$/;

// Split a table line into trimmed cells, honoring escaped pipes (\|) and the
// optional leading/trailing pipes.
function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"));
}

function parseAlign(cell: string): TableAlign {
  const c = cell.trim();
  const left = c.startsWith(":");
  const right = c.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  if (left) return "left";
  return null;
}

/**
 * Parse a GFM table block (the source lines of one table) into a model, or null
 * if the text is not a valid table (needs a header + a delimiter row).
 */
export function parseMarkdownTable(src: string): TableModel | null {
  const lines = src.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim() !== "");
  if (lines.length < 2) return null;
  const delimCells = splitCells(lines[1]);
  if (delimCells.length === 0 || !delimCells.every((c) => DELIM_CELL.test(c))) return null;

  const headers = splitCells(lines[0]);
  const width = headers.length;
  const aligns: TableAlign[] = [];
  for (let i = 0; i < width; i++) aligns.push(parseAlign(delimCells[i] ?? ""));

  const norm = (cells: string[]) => {
    const a = cells.slice(0, width);
    while (a.length < width) a.push("");
    return a;
  };
  const rows = lines.slice(2).map((l) => norm(splitCells(l)));
  return { headers, aligns, rows };
}

const delimiterCell = (a: TableAlign) =>
  a === "center" ? ":-:" : a === "right" ? "--:" : a === "left" ? ":--" : "---";

/** Serialize a table model back to canonical GFM markdown. */
export function serializeTable(m: TableModel): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const row = (cells: string[]) => `| ${cells.map(esc).join(" | ")} |`;
  const header = row(m.headers);
  const delimiter = `| ${m.aligns.map(delimiterCell).join(" | ")} |`;
  const body = m.rows.map(row);
  return [header, delimiter, ...body].join("\n");
}

// --- Pure model mutations (used by the live table widget for inline editing
// and the row/column context menu). Each returns a NEW model; inputs are never
// mutated, so they stay easy to unit-test and safe to use in render code.

/** Replace one cell's text. `kind: "header"` ignores `rowIndex`. Cells are
 * single-line in GFM, so embedded newlines are flattened to spaces. */
export function setCell(
  model: TableModel,
  kind: "header" | "body",
  rowIndex: number,
  colIndex: number,
  value: string,
): TableModel {
  const v = value.replace(/\r?\n/g, " ");
  if (kind === "header") {
    if (colIndex < 0 || colIndex >= model.headers.length) return model;
    const headers = model.headers.slice();
    headers[colIndex] = v;
    return { ...model, headers };
  }
  if (rowIndex < 0 || rowIndex >= model.rows.length) return model;
  if (colIndex < 0 || colIndex >= model.rows[rowIndex].length) return model;
  const rows = model.rows.map((r) => r.slice());
  rows[rowIndex][colIndex] = v;
  return { ...model, rows };
}

const blankRow = (width: number) => Array.from({ length: width }, () => "");

/** Insert an empty body row at `index` (clamped to [0, rows.length]). */
export function insertRow(model: TableModel, index: number): TableModel {
  const i = Math.max(0, Math.min(index, model.rows.length));
  const rows = model.rows.map((r) => r.slice());
  rows.splice(i, 0, blankRow(model.headers.length));
  return { ...model, rows };
}

/** Delete the body row at `index` (no-op if out of range). */
export function deleteRow(model: TableModel, index: number): TableModel {
  if (index < 0 || index >= model.rows.length) return model;
  const rows = model.rows.map((r) => r.slice());
  rows.splice(index, 1);
  return { ...model, rows };
}

/** Insert an empty column at `index` (clamped). Header label is empty. */
export function insertColumn(model: TableModel, index: number): TableModel {
  const i = Math.max(0, Math.min(index, model.headers.length));
  const headers = model.headers.slice();
  headers.splice(i, 0, "");
  const aligns = model.aligns.slice();
  aligns.splice(i, 0, null);
  const rows = model.rows.map((r) => {
    const c = r.slice();
    c.splice(i, 0, "");
    return c;
  });
  return { headers, aligns, rows };
}

/** Delete the column at `index`. Keeps at least one column (GFM needs one). */
export function deleteColumn(model: TableModel, index: number): TableModel {
  if (model.headers.length <= 1) return model;
  if (index < 0 || index >= model.headers.length) return model;
  const headers = model.headers.slice();
  headers.splice(index, 1);
  const aligns = model.aligns.slice();
  aligns.splice(index, 1);
  const rows = model.rows.map((r) => {
    const c = r.slice();
    c.splice(index, 1);
    return c;
  });
  return { headers, aligns, rows };
}

/** Set a single column's alignment. */
export function setColumnAlign(model: TableModel, index: number, align: TableAlign): TableModel {
  if (index < 0 || index >= model.aligns.length) return model;
  const aligns = model.aligns.slice();
  aligns[index] = align;
  return { ...model, aligns };
}

const tableRow = (cells: string[]) => `| ${cells.join(" | ")} |`;

/**
 * Build a GFM table with `rows` total rows (the first is the header) and `cols`
 * columns. Header cells are placeholders like "Column 1"; body cells are empty.
 */
export function buildMarkdownTable(rows: number, cols: number, columnLabel = "Column"): BuiltTable {
  const r = Math.max(1, Math.floor(rows));
  const c = Math.max(1, Math.floor(cols));

  const headerCells = Array.from({ length: c }, (_, i) => `${columnLabel} ${i + 1}`);
  const header = tableRow(headerCells);
  const delimiter = tableRow(Array.from({ length: c }, () => "---"));
  const emptyRow = tableRow(Array.from({ length: c }, () => ""));
  const body = Array.from({ length: r - 1 }, () => emptyRow);

  const text = [header, delimiter, ...body].join("\n");
  const selFrom = 2; // skip the leading "| "
  const selTo = selFrom + headerCells[0].length;
  return { text, selFrom, selTo };
}

export interface PlannedTableInsertion {
  /** Full text to insert at the caret. */
  insert: string;
  /** Caret offset from the insertion point. Lands on the line AFTER the table
   * (never inside it) so the live widget renders immediately — cells are edited
   * by clicking them, not by editing the raw markdown. */
  caretOffset: number;
}

/**
 * Plan inserting a table at the caret so that (a) the table sits on its own
 * block with a blank line above and below — GFM only recognizes a table at a
 * block boundary — and (b) the caret lands just below the table, not inside it
 * (a caret inside the table would keep it shown as raw markdown).
 *
 * `prev`/`prevPrev` are the characters at caret-1 / caret-2 ("" before the
 * document start); `next`/`nextNext` are the characters at caret / caret+1 ("" at
 * or past the document end).
 */
export function planTableInsertion(
  tableText: string,
  prev: string,
  prevPrev: string,
  next: string,
  nextNext: string,
): PlannedTableInsertion {
  let prefix = "";
  if (prev !== "") {
    if (prev !== "\n") prefix = "\n\n"; // caret mid-line: close the line + blank line
    else if (prevPrev !== "\n" && prevPrev !== "") prefix = "\n"; // line start, previous line not blank
  }
  let suffix: string;
  if (next === "") suffix = "\n"; // document end: trailing line to land the caret on
  else if (next === "\n" && nextNext === "\n") suffix = ""; // already a blank line below
  else if (next === "\n") suffix = "\n"; // single newline below -> make it a blank line
  else suffix = "\n\n"; // text right after -> close the line + blank line
  const insert = prefix + tableText + suffix;
  const caretOffset = prefix.length + tableText.length + 1; // start of the line after the table
  return { insert, caretOffset };
}
