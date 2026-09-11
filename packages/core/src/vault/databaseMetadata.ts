/** File tags are native Bases data. Colour and icon live in Plainva's existing
 * frontmatter namespace; neither is a new note property or a file.* invention. */
export const DATABASE_METADATA = {
  color: "note.plainva.header_color",
  icon: "note.plainva.icon",
  tags: "file.tags",
} as const;

export function normalizeDatabaseColor(value: unknown): string {
  if (typeof value !== "string") return "";
  const color = value.trim().toLowerCase();
  if (/^#[\da-f]{3,4}$/.test(color)) return `#${[...color.slice(1)].map((c) => c + c).join("")}`;
  return color;
}

/** Decode the indexed object once per result row; preserve unrecognized data. */
export function normalizeDatabaseMetadata(row: Record<string, unknown>): void {
  let metadata = row.plainva;
  if (typeof metadata === "string") {
    try { metadata = JSON.parse(metadata); } catch { return; }
  }
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return;
  const object = metadata as Record<string, unknown>;
  row.plainva = { ...object, header_color: normalizeDatabaseColor(object.header_color) };
}

export function databaseFilterValue(row: Record<string, unknown>, column: string): unknown {
  if (column in row) return row[column];
  if (column === DATABASE_METADATA.color || column === DATABASE_METADATA.icon) {
    let metadata = row.plainva;
    if (typeof metadata === "string") {
      try { metadata = JSON.parse(metadata); } catch { return undefined; }
    }
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
    const value = (metadata as Record<string, unknown>)[column === DATABASE_METADATA.color ? "header_color" : "icon"];
    return column === DATABASE_METADATA.color ? normalizeDatabaseColor(value) : typeof value === "string" ? value : undefined;
  }
  return column.startsWith("note.") ? row[column.slice(5)] : undefined;
}

export function normalizeDatabaseFilterValue(column: string, value: string): string {
  if (column === DATABASE_METADATA.color) return normalizeDatabaseColor(value);
  if (column === DATABASE_METADATA.tags) return value ? `#${value.replace(/^#/, "")}` : "";
  return value;
}
