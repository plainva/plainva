import {
  parseMarkdownAst,
  extractFrontmatter,
  propertiesBlockRefused,
  updateFrontmatterString,
  updateVaultText,
  FrontmatterSurgicalError,
  type ExtractedFrontmatterResult,
  type TextUpdateFiles,
} from "@plainva/core";
import { resolvePropertyWriteKey } from "./propertyModel";

/**
 * Writing ONE database column into a note's frontmatter.
 *
 * Lifted out of the table's cell editor (S18) rather than copied: the calendar
 * overlay writes the same date column by dragging an entry to another day, and
 * two implementations of "put this value in that column" would drift on the
 * casing rule below — the one place where the naive version is wrong.
 *
 * The files are a vault's chain, or a storage with nothing above it. The note
 * is read, changed and written back in one step (`updateVaultText`): on a
 * chain that is its entry for exactly this, which starts from the note as it
 * lies there (finding 2026-10-12).
 */
export type PropertyWriteAdapter = TextUpdateFiles;

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

/**
 * The properties a write starts from.
 *
 * The writers that go through `updateFrontmatterString` work on the WHOLE set:
 * they read the note's properties, change one and hand all of them back, and
 * a key the new set no longer names is removed from the note. So "could not
 * be read" must never pass for "has none" (finding 2026-10-09): a block the
 * reader cannot read is refused here, like a block that is no YAML map
 * (ADR 0009) — and the refusal carries nothing of the note's text, because the
 * YAML parser's own message quotes the line it failed on. `errorText` says
 * both refusals in the user's language.
 *
 * The reader refuses no value any more (ADR 0009, addendum 2026-10-22): an
 * empty `tags:` or a year among the tags made it refuse the whole block, and
 * this function refused the write with the name of the property. What it still
 * refuses is YAML that cannot be parsed, and a block that is a list.
 */
export function writableProperties(text: string): Record<string, unknown> {
  const parsed = extractFrontmatter(parseMarkdownAst(text));
  if (parsed.success) return parsed.data ? { ...(parsed.data as Record<string, unknown>) } : {};
  if (parsed.error instanceof FrontmatterSurgicalError) throw parsed.error;
  throw new FrontmatterSurgicalError("Frontmatter is not parseable YAML");
}

/**
 * Whether the block at the top of a note cannot be read as properties — what
 * the desktop's panel and the phone's sheet say instead of "No properties"
 * (ADR 0009, addendum 2026-10-22). The reader refuses it (`read`: YAML that
 * does not parse, a list, a reference that leads nowhere), or the writers do:
 * a line of prose or a number between the two rules, which the reader reads
 * as a block without properties and every write is refused for.
 */
export function unreadablePropertiesBlock(text: string, read: ExtractedFrontmatterResult): boolean {
  return !read.success || propertiesBlockRefused(text);
}

export async function writeNoteProperty(
  adapter: PropertyWriteAdapter,
  path: string,
  column: string,
  value: unknown
): Promise<void> {
  await updateVaultText(adapter, path, (text) => withNoteProperty(text, column, value));
}

/** A note's text with one column set — or, for an empty value, removed. */
export function withNoteProperty(text: string, column: string, value: unknown): string {
  const props = writableProperties(text);
  // A note may carry the property under a different CASING than the column key
  // ("Frist" vs. column "frist" — the panel capitalizes bare keys for display,
  // so both spellings occur in the wild). Update the existing key in place
  // instead of adding a duplicate second one — and, just as important, DELETE
  // that same key when the cell is cleared: deleting the column key would miss
  // the differently-cased original and leave the old value on screen.
  const writeKey = resolvePropertyWriteKey(props, column);
  const next: Record<string, unknown> = { ...props, [writeKey]: value };
  if (isEmptyPropertyValue(value)) delete next[writeKey];
  return updateFrontmatterString(text, next);
}
