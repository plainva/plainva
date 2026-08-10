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
  // instead of adding a duplicate second one.
  const writeKey = resolvePropertyWriteKey(props, column);
  const next: Record<string, unknown> = { ...props, [writeKey]: value };
  if (value === "" || value === undefined || (Array.isArray(value) && value.length === 0)) delete next[writeKey];
  await adapter.writeTextFile(path, updateFrontmatterString(text, next));
}
