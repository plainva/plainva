import { parseDocument, isAlias, isMap, isScalar, isSeq, type Document, type YAMLMap } from "yaml";
import { FrontmatterSurgicalError, yamlLinesOf } from "./frontmatter-block.js";
import { MarkdownAst, MarkdownYamlNode } from "./markdown-ast.js";
import { READ_LIST_FIELDS, READ_TEXT_FIELDS, readableFrontmatterSchema, ReadableFrontmatter } from "./metadata.js";

export type ExtractedFrontmatterResult =
  | { success: true; data: ReadableFrontmatter | null }
  | { success: false; error: Error };

/**
 * A note's properties as the index, the properties panel and the phone's
 * sheet read them.
 *
 * Every YAML map is read — field by field (ADR 0009, addendum 2026-10-22).
 * Until then a schema stood here that refused the WHOLE block when one value
 * did not fit the form of its field: an empty `tags:`, a year among the tags,
 * a number as `title`, a `timestamp` that is a date without a time. The index
 * then held no property, no tag and no title of such a note, the panel showed
 * none, and writers that took "could not be read" for "has none" lost what the
 * note said (finding 2026-10-09).
 *
 * Now the fields Plainva gives a meaning have a reading, and one sentence
 * carries every case: a value that is not of its field's kind is the text it
 * is written with.
 *
 *  - `tags`, `aliases`: a list of texts. An empty key is an empty list, a text
 *    with commas its parts (as before), and every other value — a number, a
 *    truth value, a list or a map standing as an entry — the text it is
 *    written with: `- 2024` is the tag `2024`, `- 1.10` stays `1.10` (read as
 *    a number it would be `1.1`, and fall together with another tag), and
 *    `- {{title}}` in a template, a map to YAML, is `{{title}}`. An empty
 *    entry is no entry.
 *  - `title`, `description`, `type`, `okf_version`: a text, or null where the
 *    key stands empty. A number is the text it is written with (`title: 007`,
 *    `title: 2024.10`), and so is a list or a map: nothing the note holds is
 *    hidden.
 *  - Every other key holds what YAML says — but a value the index, the panel
 *    and a cell cannot hold (`.inf`, `.nan`, `!!binary`, `!!set`, a reference
 *    to itself) is the text it is written with, too.
 *
 * For every block the schema took, the answer is the same as before, value for
 * value and in the same order (`metadata-extractor.test.ts` holds the old
 * schema against it); only a number under `okf_version` is now the text it is
 * written with (`1.0`, not `1`).
 *
 * Not read, as before: YAML that cannot be parsed, a reference that leads
 * nowhere (`title: *Draft*`), and a block that is a list. A block that holds
 * no entry, only a text or a number, or a set, an ordered map or a date at its
 * top (`!!set`, `!!omap`, `!!timestamp`), reads as one without properties;
 * the writers refuse all of them but the empty block and the set, and the
 * panel and the phone's sheet say so (`propertiesBlockRefused`).
 */
export function extractFrontmatter(ast: MarkdownAst): ExtractedFrontmatterResult {
  const yamlNode = ast.children.find((node): node is MarkdownYamlNode => node.type === "yaml");

  if (!yamlNode) {
    return { success: true, data: null };
  }

  // The block's lines as the writers read them (`yamlLinesOf`): the parser
  // ends a line at a carriage return of its own, the YAML library does not.
  const yaml = yamlLinesOf(yamlNode.value);
  let doc: Document;
  let said: unknown;
  try {
    // `logLevel: "error"`: what the library would print as a warning — a key
    // that is a map, `{{title}}:` in a template — is no failure of the
    // block, and the index reads every note on every full pass.
    doc = parseDocument(yaml, { logLevel: "error" });
    if (doc.errors.length > 0) throw doc.errors[0];
    said = doc.toJS();
  } catch (e) {
    return { success: false, error: e instanceof Error ? e : new Error(String(e)) };
  }

  if (typeof said !== "object" || said === null) {
    return { success: true, data: {} };
  }
  if (Array.isArray(said)) {
    return { success: false, error: new FrontmatterSurgicalError("Frontmatter is not a YAML map") };
  }
  const map = doc.contents;
  // A set, an ordered map or a date at the top of the block (`!!set`,
  // `!!omap`, `!!timestamp`) names no property, as before.
  if (!isMap(map) || !plainRecord(said)) {
    return { success: true, data: {} };
  }

  const read = said;
  // The value under each name the answer gives a key — the last of two, as
  // the answer holds it; a key that is an alias by the name it stands for.
  const named = valuesByName(map, doc);
  for (const key of READ_TEXT_FIELDS) {
    if (!has(read, key)) continue;
    const node = named.get(key);
    read[key] = node !== undefined ? textOf(node, doc, yaml) : textOfValue(read[key]);
  }
  for (const key of READ_LIST_FIELDS) {
    if (!has(read, key)) continue;
    const node = named.get(key);
    read[key] = node !== undefined ? textsOf(node, doc, yaml) : textsOfValue(read[key]);
  }
  for (const key of Object.keys(read)) {
    read[key] = holdable(read[key]) ? withoutProto(read[key]) : writtenOrNothing(named.get(key), doc, yaml);
  }

  // The fields with a meaning first, in the order the panel has always shown
  // them in (the old schema's), then the note's other keys in its own order.
  // `__proto__` was never handed out, at no depth; it is no key a property can be.
  const data: Record<string, unknown> = {};
  for (const key of FIELD_ORDER) if (has(read, key)) data[key] = read[key];
  for (const key of Object.keys(read)) {
    if (key !== "__proto__" && !has(data, key)) data[key] = read[key];
  }
  return { success: true, data: data as ReadableFrontmatter };
}

const has = (record: object, key: string): boolean => Object.prototype.hasOwnProperty.call(record, key);

/** A plain object — not a set, a map or a date. */
function plainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

const FIELD_ORDER = Object.keys(readableFrontmatterSchema.shape);

/** A node, an alias followed to the value it stands for. */
function resolved(node: unknown, doc: Document): unknown {
  return isAlias(node) ? (node.resolve(doc) ?? node) : node;
}

/** The text a value is written with, on one line: its lines trimmed and joined by a blank. */
function writtenText(node: unknown, yaml: string): string {
  const range = (node as { range?: [number, number, number] } | null)?.range;
  if (!range) return "";
  return yaml
    .slice(range[0], range[1])
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .join(" ");
}

/** A scalar as text: a text as it is, null for an empty value, any other value as it is written. */
function scalarText(node: { value: unknown; source?: string }): string | null {
  const { value } = node;
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return null;
  return typeof node.source === "string" && node.source !== "" ? node.source : String(value);
}

/** One text field: a text, null where the key stands empty, and anything else as it is written. */
function textOf(node: unknown, doc: Document, yaml: string): string | null {
  const value = resolved(node, doc);
  if (value === null || value === undefined) return null;
  return isScalar(value) ? scalarText(value) : writtenText(value, yaml);
}

/** One list-of-texts field: every entry as a text, the empty ones left out. */
function textsOf(node: unknown, doc: Document, yaml: string): string[] {
  const value = resolved(node, doc);
  if (value === null || value === undefined) return [];
  if (isScalar(value)) {
    // A text is the legacy form of a list: its parts, split at the commas.
    if (typeof value.value === "string") return value.value.split(",").map((part) => part.trim()).filter(Boolean);
    const text = scalarText(value);
    return text === null ? [] : [text];
  }
  if (!isSeq(value)) {
    const text = writtenText(value, yaml);
    return text ? [text] : [];
  }
  const texts: string[] = [];
  for (const entry of value.items) {
    const item = resolved(entry, doc);
    const text = item === null || item === undefined ? null : isScalar(item) ? scalarText(item) : writtenText(item, yaml);
    if (text !== null && text.trim() !== "") texts.push(text);
  }
  return texts;
}

/** Whether the index, the panel and a cell can hold a value as it is: plain data, no cycle. */
function holdable(value: unknown, path: Set<unknown> = new Set()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object") return false;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  if (path.has(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return false;
  path.add(value);
  const plain = (Array.isArray(value) ? value : Object.values(value)).every((item) => holdable(item, path));
  path.delete(value);
  return plain;
}

/**
 * The value node under each key, by the name the answer gives the key: `1:` is
 * "1", `true:` is "true", `~:` is "", a key that is an alias (`*k :`) the name
 * of what it stands for. Where two keys have one name, the answer holds the
 * last one's value, and so does this. A key that is itself a list or a map is
 * not named here.
 */
function valuesByName(map: YAMLMap, doc: Document): Map<string, unknown> {
  const named = new Map<string, unknown>();
  for (const pair of map.items) {
    const key = resolved(pair.key, doc);
    if (key === null || key === undefined) {
      named.set("", pair.value);
      continue;
    }
    if (!isScalar(key)) continue;
    const name = key.value;
    if (name === null || name === undefined) named.set("", pair.value);
    else if (typeof name !== "object") named.set(String(name), pair.value);
  }
  return named;
}

/**
 * One text field read from its value alone, for a key the names above do not
 * find (none that the tests know of): a text or a single value as text, and
 * nothing for a list or a map — printed from the value, it would not be what
 * the note says.
 */
function textOfValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return null;
}

/** One list-of-texts field read from its value alone, as `textOfValue`. */
function textsOfValue(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  if (typeof value === "string") return value.split(",").map((part) => part.trim()).filter(Boolean);
  const items = Array.isArray(value) ? value : [value];
  return items.map(textOfValue).filter((text): text is string => text !== null && text.trim() !== "");
}

/**
 * A value without a key `__proto__` at any depth — what the schema handed out
 * before, which never named one. The same value where it holds none.
 */
function withoutProto(value: unknown): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const items = value.map((item) => {
      const next = withoutProto(item);
      if (next !== item) changed = true;
      return next;
    });
    return changed ? items : value;
  }
  if (!plainRecord(value)) return value;
  let changed = has(value, "__proto__");
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (key === "__proto__") continue;
    const next = withoutProto(value[key]);
    if (next !== value[key]) changed = true;
    out[key] = next;
  }
  return changed ? out : value;
}

/** A value the answer cannot hold as it is: the text it is written with, or null where none is to be found. */
function writtenOrNothing(node: unknown, doc: Document, yaml: string): string | null {
  const value = resolved(node, doc);
  if (value === null || value === undefined) return null;
  return writtenText(value, yaml) || null;
}
