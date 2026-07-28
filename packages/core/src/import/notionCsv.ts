/**
 * Reads the CSV half of a Notion file export.
 *
 * A ZIP export carries every database twice: once as `Database.csv` with the
 * values, and once as a folder of one Markdown page per row — with the values
 * missing. Plainva used to import the pages and write an EMPTY `.base` beside
 * them, so a database arrived as a heap of notes with no columns and no view.
 *
 * The CSV is the only place the schema survives, so it is read for two things:
 * the columns of the `.base`, and the frontmatter the row pages never had. The
 * two halves are matched by title, which is all the export gives us — the API
 * path is the one that carries real ids, and stays the recommended route.
 */

/** One database as the export describes it. */
export interface CsvTable {
  header: string[];
  rows: string[][];
}

export type CsvColumnType = 'text' | 'number' | 'date' | 'checkbox' | 'select' | 'multi_select';

export interface CsvColumn {
  name: string;
  type: CsvColumnType;
  /** Present for select/multi_select, in first-seen order. */
  options?: string[];
}

/**
 * Splits CSV text into rows, honouring quoted fields.
 *
 * Written out rather than pulled in: a Notion cell legitimately contains
 * commas, newlines and doubled quotes, and a `split(',')` turns exactly those
 * rows into garbage — quietly, in the middle of somebody's database.
 */
export function parseCsvTable(text: string): CsvTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let i = 0;
  // A BOM in front of the first header name would make that column unmatchable.
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    // A trailing newline must not produce a phantom row.
    if (row.length > 1 || row[0] !== '') rows.push(row);
    row = [];
  };

  while (i < src.length) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      endField();
      i += 1;
      continue;
    }
    if (ch === '\r') {
      i += 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (field !== '' || row.length > 0) endRow();

  const header = rows.shift() ?? [];
  return { header: header.map((h) => h.trim()), rows };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;
const YES_NO = new Set(['yes', 'no', 'true', 'false']);
/** Above this a column is somebody's free text, not a set of choices. */
const MAX_SELECT_OPTIONS = 12;

function isNumeric(value: string): boolean {
  if (!value) return false;
  return Number.isFinite(Number(value.replace(',', '.')));
}

/**
 * Decides what each column is, from the values alone.
 *
 * Deliberately cautious: a wrong guess writes a type into the user's `.base`
 * that then refuses their next entry. Anything the values do not clearly
 * support stays text, which accepts everything.
 */
export function inferCsvColumns(table: CsvTable): CsvColumn[] {
  return table.header.map((name, col) => {
    const values = table.rows.map((r) => (r[col] ?? '').trim()).filter((v) => v !== '');
    if (values.length === 0) return { name, type: 'text' as const };

    if (values.every((v) => YES_NO.has(v.toLowerCase()))) return { name, type: 'checkbox' as const };
    if (values.every(isNumeric)) return { name, type: 'number' as const };
    if (values.every((v) => ISO_DATE.test(v))) return { name, type: 'date' as const };

    const distinct = new Map<string, true>();
    for (const v of values) distinct.set(v, true);

    // A comma-separated column whose parts repeat is Notion's multi-select.
    if (values.some((v) => v.includes(','))) {
      const parts = new Map<string, true>();
      for (const v of values) {
        for (const p of v.split(',').map((s) => s.trim())) {
          if (p) parts.set(p, true);
        }
      }
      // Tags are drawn from a pool, so their number does not grow with the
      // rows. "Smith, John" and "Doe, Jane" produce four parts across two rows
      // and stay text, which is what they are.
      if (parts.size <= MAX_SELECT_OPTIONS && parts.size <= values.length) {
        return { name, type: 'multi_select' as const, options: [...parts.keys()] };
      }
      return { name, type: 'text' as const };
    }

    // Repetition is what separates a set of choices from free text: five
    // distinct values across five rows is a text column, not a select.
    if (distinct.size <= MAX_SELECT_OPTIONS && distinct.size < values.length) {
      return { name, type: 'select' as const, options: [...distinct.keys()] };
    }

    return { name, type: 'text' as const };
  });
}

/** The frontmatter value for one cell, in the shape its column type implies. */
export function csvCellValue(column: CsvColumn, raw: string): unknown {
  const value = (raw ?? '').trim();
  if (!value) return undefined;

  switch (column.type) {
    case 'checkbox':
      return value.toLowerCase() === 'yes' || value.toLowerCase() === 'true';
    case 'number': {
      const n = Number(value.replace(',', '.'));
      return Number.isFinite(n) ? n : value;
    }
    case 'multi_select':
      return value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    default:
      return value;
  }
}

/**
 * The frontmatter for one row, keyed by column name.
 *
 * The first column is the title — it is the note's name, and repeating it as a
 * property would show up as a duplicate in every view.
 */
export function csvRowFrontmatter(columns: CsvColumn[], row: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 1; i < columns.length; i += 1) {
    const value = csvCellValue(columns[i], row[i] ?? '');
    if (value !== undefined) out[columns[i].name] = value;
  }
  return out;
}

/** The `.base` columns config for an inferred schema. */
export function csvColumnsConfig(columns: CsvColumn[]): Record<string, { input: string; options?: string[] }> {
  const out: Record<string, { input: string; options?: string[] }> = {};
  for (let i = 1; i < columns.length; i += 1) {
    const c = columns[i];
    out[c.name] = c.options ? { input: c.type, options: c.options } : { input: c.type };
  }
  return out;
}
