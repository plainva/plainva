import { parseMarkdownAst, extractFrontmatter, updateFrontmatterString, FrontmatterSurgicalError } from "@plainva/core";
import { UNREADABLE_PROPERTY_VALUE } from "../lib/errorText";
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

/**
 * The properties a write starts from.
 *
 * The writers that go through `updateFrontmatterString` work on the WHOLE set:
 * they read the note's properties, change one and hand all of them back, and
 * what the new set no longer names is removed from the note. So "could not be
 * read" must never pass for "has none" (finding 2026-10-09). It did: a block
 * that is a proper YAML map but holds a value the reader's schema rejects — an
 * empty `tags:`, a year among the tags, a number as `title` — came back as no
 * properties at all, and writing one property removed every other one.
 *
 * Such a note is refused, like a block that is no YAML map (ADR 0009). The
 * refusal names the property the reader stumbled over and nothing of the
 * note's text: the YAML parser's own message quotes the line it failed on.
 * `errorText` says all three refusals in the user's language.
 */
export function writableProperties(text: string): Record<string, unknown> {
  const parsed = extractFrontmatter(parseMarkdownAst(text));
  if (parsed.success) return parsed.data ? { ...(parsed.data as Record<string, unknown>) } : {};
  // The schema's refusal carries where it failed; the YAML parser's has no such list.
  const issues = (parsed.error as unknown as { issues?: { path?: unknown[] }[] }).issues;
  if (!Array.isArray(issues)) throw new FrontmatterSurgicalError("Frontmatter is not parseable YAML");
  const key = issues[0]?.path?.[0];
  if (typeof key !== "string") throw new FrontmatterSurgicalError("Frontmatter is not a YAML map");
  throw new FrontmatterSurgicalError(`${UNREADABLE_PROPERTY_VALUE}${key}`);
}

export async function writeNoteProperty(
  adapter: PropertyWriteAdapter,
  path: string,
  column: string,
  value: unknown
): Promise<void> {
  const text = await adapter.readTextFile(path);
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
  await adapter.writeTextFile(path, updateFrontmatterString(text, next));
}
