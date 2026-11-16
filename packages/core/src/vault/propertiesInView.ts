import { extractLinksAndTags } from "../ast-scanner.js";
import { frontmatterSpan } from "../frontmatter-block.js";
import { propertiesAsWritten } from "../frontmatter-surgical.js";
import { parseMarkdownAst } from "../markdown-parser.js";
import { extractFrontmatter } from "../metadata-extractor.js";
import { redactDeniedLinksIn } from "../ai/egressGate.js";
import { ReaderView } from "../ai/readerView.js";
import { findInlineTags } from "../tagRule.js";
import { decodeIndexedProperty, encodeIndexedProperty } from "./indexedProperty.js";

/**
 * A note's properties as a reader with a narrower view sees them (review of R19, wave 2): read from the text of its
 * properties block with the links that reader may not follow withheld — the very text the views of the note show it
 * (`redactDeniedLinksIn`) —, by the index's own reading of a note (`extractFrontmatter`), and every text that reading
 * gives — a key, a value, an entry of a list — withheld once more as it reads: a link YAML builds from escapes
 * (`"[[Aa\x72on]]"`) is a link like one written out. No reading of the values the index holds stands between: a link
 * in `tags` or `aliases`, a link as a key, one in a block of text, one with a comment or a tab between its names is
 * withheld, and the values, the title and the tags are what the index would hold had the note been written so. A
 * filter, a sort, a count, a tag source, a list that names the note by its title sees what the reader is shown.
 *
 * The one place each of these is read for such a reader (`VaultQueryService.notesAsSeen`, `queryDatabaseFiles`).
 * A view is formed once per text of a block and the links of it withheld, and kept (`VIEWS`): a query over many notes
 * that hold the same withheld link reads each block once, never the text behind it.
 */
export interface PropertiesView {
  /** The values the index would hold of the view, decoded as the index decodes them; null where nothing is withheld. */
  data: Record<string, unknown> | null;
  /** The note's title in the view (its `title` property); null where it has none or nothing is withheld. */
  title: string | null;
  /**
   * The tags the indexer would take of the note in the view (`tagsInView`); null where nothing is withheld or where
   * they were not asked for.
   */
  tags: ReadonlySet<string> | null;
  /** The tags of the view's block, as the index writes them; null where nothing is withheld. */
  blockTags: readonly string[] | null;
  /** Tags the note's own block gives that its view does not; empty where nothing is withheld. */
  goneTags: ReadonlySet<string>;
  /** The block as the reader sees it, with its fences; null where nothing is withheld. */
  seen: string | null;
  /** The values as written in the view's block (`propertiesAsWritten`): a link without quotes is its text. Read when asked. */
  written(): Map<string, unknown> | null;
}

/** Link syntax of any kind the views withhold, a bracket a value may hold, or an escape YAML builds one from. */
const MAY_HOLD_A_LINK = /[[\]\\]/;

/** How many blocks and views are kept: enough for a vault's notes, small enough to forget. */
const KEPT = 8192;

/** A small store that forgets the oldest first. */
class Kept<V> {
  private readonly items = new Map<string, V>();
  get(key: string): V | undefined {
    const value = this.items.get(key);
    if (value !== undefined) {
      this.items.delete(key);
      this.items.set(key, value);
    }
    return value;
  }
  set(key: string, value: V): V {
    this.items.set(key, value);
    if (this.items.size > KEPT) this.items.delete(this.items.keys().next().value!);
    return value;
  }
}

/** What a block says, read once per text: the link targets in its text and in the texts its reading gives, its tags. */
interface BlockReading {
  targets: readonly string[];
  tags: readonly string[];
}
const READINGS = new Kept<BlockReading>();

/** A view of a block for one set of withheld links, without what each caller fills in. */
interface ViewCore {
  data: Record<string, unknown>;
  title: string | null;
  blockTags: readonly string[];
  goneTags: ReadonlySet<string>;
  seen: string;
  written: () => Map<string, unknown> | null;
}
const VIEWS = new Kept<ViewCore>();

/** A note's properties block with its fences, where it has one that could hold a link; null otherwise. */
export function propertiesBlockOf(content: string): string | null {
  const span = frontmatterSpan(content);
  if (!span) return null;
  const block = content.slice(0, span.end);
  return MAY_HOLD_A_LINK.test(block) ? block : null;
}

/** The index's reading of a block: its values and the tags it gives (`extractLinksAndTags`), as the indexer takes them. */
function readingOf(block: string): { data: Record<string, unknown>; tags: string[] } {
  const ast = parseMarkdownAst(block, { preserveObsidianSyntax: true });
  const read = extractFrontmatter(ast);
  const data = read.success && read.data ? (read.data as Record<string, unknown>) : {};
  return { data, tags: tagsOfValues(data) };
}

/** The tags the scanner takes of a block's values (`extractLinksAndTags`, its first step), as text. */
function tagsOfValues(data: Record<string, unknown>): string[] {
  // The reading gives `tags` as a list of texts always (`extractFrontmatter`, its list fields).
  const tags = data.tags;
  return Array.isArray(tags) ? tags.map(String) : [];
}

/** Every text of a value, at any depth of lists and maps, keys included. */
function textsIn(value: unknown, out: string[], depth = 0): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (depth > 64 || value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) textsIn(item, out, depth + 1);
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    out.push(key);
    textsIn(item, out, depth + 1);
  }
}

/** The link targets of a text as the views read them (`redactDeniedLinksIn`). */
function targetsIn(text: string, into: string[]): void {
  redactDeniedLinksIn(ReaderView.of(text), (target) => {
    into.push(target);
    return false;
  });
}

function readingOfBlock(block: string): BlockReading {
  const known = READINGS.get(block);
  if (known) return known;
  const targets: string[] = [];
  targetsIn(block, targets);
  const { data, tags } = readingOf(block);
  const texts: string[] = [];
  textsIn(data, texts);
  for (const text of texts) if (MAY_HOLD_A_LINK.test(text)) targetsIn(text, targets);
  return READINGS.set(block, { targets: [...new Set(targets)], tags });
}

/** Every link target of a block: in its text, and in every text its reading gives (`"[[Aa\x72on]]"` is `[[Aaron]]`). */
export function linkTargetsOfBlock(block: string): readonly string[] {
  return readingOfBlock(block).targets;
}

/** A text with the links `isDenied` names withheld, as the views withhold them. */
function withheldText(text: string, isDenied: (target: string) => boolean): string {
  return MAY_HOLD_A_LINK.test(text) ? redactDeniedLinksIn(ReaderView.of(text), isDenied).view.text : text;
}

/** A value with every text in it withheld (`withheldText`), keys included. */
function withheldValue(value: unknown, isDenied: (target: string) => boolean, depth = 0): unknown {
  if (typeof value === "string") return withheldText(value, isDenied);
  if (depth > 64 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => withheldValue(item, isDenied, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) out[withheldText(key, isDenied)] = withheldValue(item, isDenied, depth + 1);
  return out;
}

/**
 * `PropertiesView` of one note's properties block (`propertiesBlockOf`, with its fences); `isDenied` answers for the
 * reader. The tags are those of the block; the note's text behind it adds its own (`tagsInView`).
 */
export function propertiesInView(block: string, isDenied: (target: string) => boolean): PropertiesView {
  const reading = readingOfBlock(block);
  const denied = reading.targets.filter((target) => isDenied(target));
  if (denied.length === 0) return propertiesAsSeen(block);
  const key = `${block}\u0000${[...denied].sort().join("\u0000")}`;
  const core = VIEWS.get(key) ?? VIEWS.set(key, viewOf(block, reading, new Set(denied)));
  return { data: { ...core.data }, title: core.title, tags: null, blockTags: core.blockTags, goneTags: core.goneTags, seen: core.seen, written: core.written };
}

function viewOf(block: string, reading: BlockReading, denied: ReadonlySet<string>): ViewCore {
  const isDenied = (target: string) => denied.has(target);
  const seen = redactDeniedLinksIn(ReaderView.of(block), isDenied).view.text;
  const read = readingOf(seen).data;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(read)) {
    const held = encodeIndexedProperty(withheldValue(value, isDenied));
    data[withheldText(key, isDenied)] = decodeIndexedProperty(held.type, held.value);
  }
  const title = typeof data.title === "string" && data.title ? data.title : null;
  const blockTags = tagsOfValues(data);
  const kept = new Set(blockTags);
  const goneTags = new Set(reading.tags.filter((tag) => !kept.has(tag)));
  return { data, title, blockTags, goneTags, seen, written: once(() => withheldWritten(propertiesAsWritten(seen), isDenied)) };
}

function withheldWritten(written: Map<string, unknown> | null, isDenied: (target: string) => boolean): Map<string, unknown> | null {
  if (!written) return written;
  return new Map([...written].map(([key, value]) => [withheldText(key, isDenied), withheldValue(value, isDenied)]));
}

/** `PropertiesView` of a block that withholds nothing from the reader: the index's values, those YAML read otherwise as written. */
export function propertiesAsSeen(block: string): PropertiesView {
  return { data: null, title: null, tags: null, blockTags: null, goneTags: new Set(), seen: null, written: once(() => propertiesAsWritten(block)) };
}

/**
 * Whether the text behind a note's block must be read for its tags in the view: only where a tag the view takes away
 * could also stand in that text as an inline tag (`#name`) — the index holds a tag once, wherever it stands.
 */
export function tagsNeedTheText(view: PropertiesView): boolean {
  for (const tag of view.goneTags) if (findInlineTags(`#${tag}`).some((found) => found.name === tag)) return true;
  return false;
}

/**
 * The tags the indexer takes of a note whose properties block is seen as `view.seen`: the tags the index holds of the
 * note (`indexTags`), less those only its own block gave, and those of the view's block. `body`, the text behind the
 * block, is asked only where a tag the view takes away could stand in it as well (`tagsNeedTheText`).
 */
export function tagsInView(view: PropertiesView, indexTags: Iterable<string>, body?: string): void {
  if (view.seen === null || view.blockTags === null) return;
  const inline = body !== undefined && view.goneTags.size ? new Set(extractLinksAndTags(parseMarkdownAst(body, { preserveObsidianSyntax: true })).tags.map((tag) => String(tag.name))) : null;
  const tags = new Set<string>();
  for (const tag of indexTags) if (!view.goneTags.has(tag) || inline?.has(tag)) tags.add(tag);
  for (const tag of view.blockTags) tags.add(tag);
  view.tags = tags;
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
