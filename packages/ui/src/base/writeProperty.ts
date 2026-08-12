import { parseMarkdownAst, extractFrontmatter, updateFrontmatterString } from "@plainva/core";
import { resolvePropertyWriteKey } from "./propertyModel";

/**
 * Writing ONE database column into a note's frontmatter.
 *
 * Lifted out of the table's cell editor (S18) rather than copied: the calendar
 * overlay writes the same date column by dragging an entry to another day, and
 * two implementations of "put this value in that column" would drift on the
 * casing rule below — the one place where the naive version is wrong.
 */
export interface PropertyWriteAdapter {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/**
 * Does this cell value mean "remove the property"?
 *
 * Both shells asked the question and answered it differently: the desktop
 * counted `""`, `undefined` and `[]`, mobile additionally `null` and a
 * whitespace-only string. Mobile's reading is what a user means when they clear
 * a cell — a property whose value is `null` or three spaces is not data, it is
 * a leftover key — so it is the shared one now.
 */
export function isEmptyPropertyValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

export async function writeNoteProperty(
  adapter: PropertyWriteAdapter,
  path: string,
  column: string,
  value: unknown
): Promise<void> {
  const text = await adapter.readTextFile(path);
  const ast = parseMarkdownAst(text);
  const parsed = extractFrontmatter(ast);
  const props: Record<string, unknown> = parsed.success && parsed.data ? (parsed.data as Record<string, unknown>) : {};
  // A note may carry the property under a different CASING than the column key
  // ("Frist" vs. column "frist" — the panel capitalizes bare keys for display,
  // so both spellings occur in the wild). Update the existing key in place
  // instead of adding a duplicate second one — and, just as important, DELETE
  // that same key when the cell is cleared: deleting the column key would miss
  // the differently-cased original and leave the old value on screen.
  const writeKey = resolvePropertyWriteKey(props, column);
  const next: Record<string, unknown> = { ...props, [writeKey]: value };
  if (isEmptyPropertyValue(value)) delete next[writeKey];
  await adapter.writeTextFile(path, updateFrontmatterString(text, next));
}
