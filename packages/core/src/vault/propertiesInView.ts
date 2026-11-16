import { extractLinksAndTags } from "../ast-scanner.js";
import { frontmatterSpan } from "../frontmatter-block.js";
import { propertiesAsWritten } from "../frontmatter-surgical.js";
import { parseMarkdownAst } from "../markdown-parser.js";
import { extractFrontmatter } from "../metadata-extractor.js";
import { redactDeniedLinksIn } from "../ai/egressGate.js";
import { ReaderView } from "../ai/readerView.js";
import { decodeIndexedProperty, encodeIndexedProperty } from "./indexedProperty.js";

/**
 * A note's properties as a reader with a narrower view sees them (review of R19, wave 2): read from the text of its
 * properties block with the links that reader may not follow withheld — the very text the views of the note show it
 * (`redactDeniedLinksIn`) —, by the index's own reading of a note (`extractFrontmatter`, the tags the indexer takes).
 * No reading of the values the index holds stands between: a link in `tags` or `aliases`, a link as a key, one in a
 * block of text, one with a comment or a tab between its names is withheld in the text, and the values, the title
 * and the tags are what the index would hold had the note been written so. A filter, a sort, a count over them sees
 * what the reader is shown.
 */
export interface PropertiesView {
  /** The values the index would hold of the view, decoded as the index decodes them; null where nothing is withheld. */
  data: Record<string, unknown> | null;
  /** The note's title in the view (its `title` property); null where it has none or nothing is withheld. */
  title: string | null;
  /** The tags the indexer would take of the view, as it writes them; null where nothing is withheld. */
  tags: ReadonlySet<string> | null;
  /** The block as the reader sees it, with its fences; null where nothing is withheld. */
  seen: string | null;
  /** The values as written in the view's block (`propertiesAsWritten`): a link without quotes is its text. Read when asked. */
  written(): Map<string, unknown> | null;
}

/** Link syntax of any kind the views withhold: none, and nothing of a block can be withheld. */
const MAY_HOLD_A_LINK = /\[\[|\]\(|\]:/;

/** The indexer reads no note with a line this long (`VaultIndexer`): neither does its view. */
const LONGEST_LINE = 10_000;

/** A note's properties block with its fences, where it has one that holds link syntax; null otherwise. */
export function propertiesBlockOf(content: string): string | null {
  const span = frontmatterSpan(content);
  if (!span) return null;
  const block = content.slice(0, span.end);
  return MAY_HOLD_A_LINK.test(block) ? block : null;
}

/** Every link target of a block, as the views read them (`redactDeniedLinksIn`). */
export function linkTargetsOfBlock(block: string): string[] {
  const targets: string[] = [];
  redactDeniedLinksIn(ReaderView.of(block), (target) => {
    targets.push(target);
    return false;
  });
  return targets;
}

/**
 * `PropertiesView` of one note's properties block (`propertiesBlockOf`, with its fences); `isDenied` answers for the
 * reader. The tags are those of the block; the note's text behind it adds its own (`tagsInView`).
 */
export function propertiesInView(block: string, isDenied: (target: string) => boolean): PropertiesView {
  const { view, redacted } = redactDeniedLinksIn(ReaderView.of(block), isDenied);
  if (redacted === 0) return propertiesAsSeen(block);
  const seen = view.text;
  const read = extractFrontmatter(parseMarkdownAst(seen, { preserveObsidianSyntax: true }));
  const data: Record<string, unknown> = {};
  if (read.success && read.data) {
    for (const [key, value] of Object.entries(read.data)) {
      const held = encodeIndexedProperty(value);
      data[key] = decodeIndexedProperty(held.type, held.value);
    }
  }
  const title = read.success && read.data && typeof read.data.title === "string" && read.data.title ? read.data.title : null;
  const tags = new Set(read.success && Array.isArray(read.data?.tags) ? read.data.tags.map(String) : []);
  return { data, title, tags, seen, written: once(() => propertiesAsWritten(seen)) };
}

/** `PropertiesView` of a block that withholds nothing from the reader: the index's values, those YAML read otherwise as written. */
export function propertiesAsSeen(block: string): PropertiesView {
  return { data: null, title: null, tags: null, seen: null, written: once(() => propertiesAsWritten(block)) };
}

/**
 * The tags the indexer takes of a note whose properties block is seen as `view.seen`: those of the block and those of
 * its text (`body`, all of the note behind the block). A note with a line too long for the indexer has none, and no
 * values either — as the index holds it.
 */
export function tagsInView(view: PropertiesView, body: string): void {
  if (view.seen === null) return;
  const note = view.seen + body;
  if (note.split("\n").some((line) => line.length > LONGEST_LINE)) {
    view.data = {};
    view.title = null;
    view.tags = new Set();
    return;
  }
  view.tags = new Set(extractLinksAndTags(parseMarkdownAst(note, { preserveObsidianSyntax: true })).tags.map((tag) => tag.name));
}

function once<T>(read: () => T): () => T {
  let done: { value: T } | null = null;
  return () => (done ??= { value: read() }).value;
}

/**
 * Values as the index holds them, those that YAML read differently from their text taken as written instead
 * (`propertiesAsWritten`, review of R19, wave 2): a wiki link without quotes is a list in a list, a list of two names
 * or a map to YAML — always a collection inside a collection, or a map, which the index holds as its JSON text. A map
 * stays the JSON text of its values as written. `own` picks the keys this may change.
 */
export function withValuesAsWritten(values: Record<string, unknown>, writtenOf: () => Map<string, unknown> | null, own: (key: string) => boolean = () => true): void {
  let written: Map<string, unknown> | null = null;
  let lower: Map<string, unknown> | null = null;
  for (const key of Object.keys(values)) {
    const value = values[key];
    if (!own(key) || !nested(value)) continue;
    if (!written) {
      written = writtenOf();
      if (!written) return;
      lower = new Map([...written].map(([name, item]) => [name.toLowerCase(), item]));
    }
    const as = written.has(key) ? written.get(key) : lower!.get(key.toLowerCase());
    if (as === undefined) continue;
    values[key] = typeof value === "string" && as !== null && typeof as === "object" && !Array.isArray(as) ? JSON.stringify(as) : as;
  }
}

function nested(value: unknown): boolean {
  if (typeof value === "string") return value.startsWith("{") && value.includes("[");
  if (value === null || typeof value !== "object") return false;
  return (Array.isArray(value) ? value : Object.values(value)).some((item) => item !== null && typeof item === "object");
}
