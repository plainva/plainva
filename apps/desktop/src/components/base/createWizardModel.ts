// Pure model of the .base creation wizard (plan W3/P1-P2): collect the
// property union of the matching notes and build the initial config. Kept free
// of React/IO so the wizard's outcome is unit-testable.

export interface WizardColumn {
  name: string;
  /** In how many matching notes the property is set. */
  coverage: number;
  selected: boolean;
}

export interface WizardNewColumn {
  name: string;
  /** Plainva input type; "text" adds no schema entry (plain frontmatter string). */
  input: string;
}

/** Property union of the query rows with per-property coverage, sorted by
 * coverage (most complete first) then name. file.* built-ins are excluded. */
export function collectWizardColumns(rows: Record<string, any>[], previous: WizardColumn[] = []): WizardColumn[] {
  const counts: Record<string, number> = {};
  rows.forEach((row) => Object.keys(row).forEach((k) => {
    if (!k.startsWith("file.")) counts[k] = (counts[k] || 0) + 1;
  }));
  const previousSelection = new Map(previous.map((c) => [c.name, c.selected]));
  return Object.entries(counts)
    .sort(([na, ca], [nb, cb]) => cb - ca || na.localeCompare(nb))
    .map(([name, coverage]) => ({ name, coverage, selected: previousSelection.get(name) ?? true }));
}

/** Build the initial in-memory `.base` config the wizard writes to disk.
 * `viewName` becomes the name of the initial table view — Obsidian requires
 * every view to be named (serializeBaseConfig falls back to "Table" if omitted). */
export function buildWizardConfig(
  sourceClauses: string[],
  columns: WizardColumn[],
  newColumns: WizardNewColumn[],
  viewName?: string,
): any {
  const schema: Record<string, any> = {};
  for (const col of newColumns) {
    if (col.input && col.input !== "text") schema[col.name] = { input: col.input };
  }
  const order = [
    "file.name",
    ...columns.filter((c) => c.selected).map((c) => c.name),
    ...newColumns.map((c) => c.name).filter((n) => !columns.some((c) => c.name === n)),
  ];
  return {
    filters: { and: [...sourceClauses] },
    columns: schema,
    views: [{ type: "table", name: viewName || "Table", order }],
  };
}
