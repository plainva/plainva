import { extractLinksAndTags } from "../ast-scanner.js";
import { frontmatterSpan } from "../frontmatter-block.js";
import { propertiesAsWritten, propertiesBlockOfKeys } from "../frontmatter-surgical.js";
import { parseMarkdownAst } from "../markdown-parser.js";
import { extractFrontmatter } from "../metadata-extractor.js";
import { linkTargetsOfPlainBlock, mayHoldAWithheldLink, redactDeniedLinksIn } from "../withholding/links.js";
import { ReaderView } from "../withholding/readerView.js";
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
 * What a block says and its views are kept with the note (`BlockMemo`), for as long as the index holds the same text
 * of it: a query reads a block once per text of the note, and a view once per text and withheld links, never the
 * text behind the block — however many notes a vault holds.
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
  /** Keeps the tags of the view with the note, where its view is kept (`tagsInView`, `BlockMemo`). */
  keepTags?(tags: ReadonlySet<string>): void;
}

/**
 * What every link the views withhold is written with (`mayHoldAWithheldLink`: `[[…]]`, also over lines, `[…](…)`, a
 * reference `[…]: …`), or an escape YAML builds one from in a quoted text (`"\x5b\x5bAaron]]"`, a line joined with
 * `\`). A bracket alone is none of them: `tags: [a, b]` is read as it is, at no cost.
 */
const MAY_HOLD_A_LINK = { test: mayHoldAWithheldLink };

/** How many readings and views of one note are kept: a block cut to the keys a rollup reads is one more. */
const FEW = 4;

/** A store of a few, that forgets the oldest first. */
class Few<V> {
  private readonly items = new Map<string, V>();
  get(key: string): V | undefined {
    return this.items.get(key);
  }
  set(key: string, value: V): V {
    this.items.set(key, value);
    if (this.items.size > FEW) this.items.delete(this.items.keys().next().value!);
    return value;
  }
}

/**
 * What is kept of one note's properties block, with the note, for as long as the index holds the same text of it
 * (`VaultQueryService`, keyed by the note's path and the hash of its text): every reading of it as YAML — what it
 * says, its views for the links withheld from it, its values as written, the block cut to some keys — and its link
 * targets. One per note, so there is no number of notes past which a query reads a block anew; and no reading of a
 * block as YAML happens anywhere but here, counted (`BLOCK_READS`).
 */
export class BlockMemo {
  /** @internal The link targets of a block, by its text (`linkTargetsOfBlock`). */
  readonly targets = new Few<readonly string[]>();
  /** @internal */
  readonly readings = new Few<BlockReading>();
  /** @internal By the text of a block, then by the links withheld from it. */
  readonly views = new Few<Few<ViewCore>>();
  /** @internal A block cut to the keys a rollup reads, by those keys (`cutToKeys`). */
  readonly cuts = new Few<string | null>();
}

/**
 * How many times a block has been read as YAML (its reading, its values as written, a cut to some keys), for the
 * budget tests: a query that finds its notes kept reads none, and a block that can withhold nothing from its reader
 * is never read so (`plainBlock`).
 */
export const BLOCK_READS = { count: 0 };

/** What a block says, read once per text: the link targets in its text and in the texts its reading gives, its tags. */
interface BlockReading {
  targets: readonly string[];
  tags: readonly string[];
}

/** A view of a block for one set of withheld links, without what each caller fills in. */
interface ViewCore {
  data: Record<string, unknown>;
  title: string | null;
  blockTags: readonly string[];
  goneTags: ReadonlySet<string>;
  seen: string;
  written: () => Map<string, unknown> | null;
  /** The tags of the view, once a query has read them (`tagsInView`). */
  tags: ReadonlySet<string> | null;
}

/** A note's properties block with its fences, where it has one that could hold a link; null otherwise. */
export function propertiesBlockOf(content: string): string | null {
  const span = frontmatterSpan(content);
  if (!span) return null;
  const block = content.slice(0, span.end);
  return MAY_HOLD_A_LINK.test(block) ? block : null;
}

/**
 * Whether every text YAML reads from a block stands on one line of it as it is written, so that the links the views
 * read in the block's own text (`redactDeniedLinksIn`) are all the links any reading of it holds (round 10 of the
 * review of R19, wave 2). It is so where each line is a key, an entry of a list or a comment, each with a value that
 * ends on its line — plain, quoted or a flow collection closed there —, and nothing in the block makes YAML build a
 * text from something else: no escape or doubled quote, no tab or other line break, no anchor, alias, tag, block of
 * text or key of its own kind, no link left open at the end of a line, no reference definition. Any other block is
 * read as YAML, where it can hold a link withheld from its reader.
 */
export function plainBlock(block: string): boolean {
  if (/[\\\t\r\u0085\u2028\u2029]|''|\]:/.test(block)) return false;
  const span = frontmatterSpan(block);
  if (!span) return false;
  for (const line of span.yaml.split("\n")) if (!plainLine(line)) return false;
  return true;
}

/** A complete wiki link on one line, as the views read one (`egressGate`, `WIKI_LINK`). */
const WHOLE_WIKI_LINK = /!?\[\[[^[\]\n]+\]\]/g;

function plainLine(line: string): boolean {
  // A link left open at the end of its line, which YAML or the views could read on into the next.
  if (line.includes("[[") || line.includes("]]")) {
    const rest = line.replace(WHOLE_WIKI_LINK, "");
    if (rest.includes("[[") || rest.includes("]]")) return false;
  }
  const inline = line.indexOf("](");
  if (inline >= 0 && line.indexOf(")", inline) < 0) return false;
  let text = line.replace(/^ +/, "");
  if (text === "" || text.startsWith("#")) return true;
  let listed = false;
  while (text === "-" || text.startsWith("- ")) {
    listed = true;
    text = text.slice(1).replace(/^ +/, "");
  }
  if (text === "" || text.startsWith("#")) return true;
  const key = /^("[^"\n]*"|'[^'\n]*'|[^\s#"'&*!|>%@`?{}[\],:-][^:]*?|-[^\s:][^:]*?):(?: +|$)/.exec(text);
  if (!key && !listed) return false;
  const value = key ? text.slice(key[0].length) : text;
  return plainValue(value);
}

/** A value that ends on its line: plain, quoted, or a flow collection closed there; a comment may follow. */
function plainValue(value: string): boolean {
  if (value === "" || value.startsWith("#")) return true;
  const first = value[0]!;
  if ("|>&*!%@`?".includes(first)) return false;
  if (first === '"' || first === "'") return new RegExp(`^${first}[^${first}]*${first} *(?:#.*)?$`).test(value);
  if (first !== "[" && first !== "{") return true;
  let depth = 0;
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === '"' || c === "'") {
      const close = value.indexOf(c, i + 1);
      if (close < 0) return false;
      i = close;
    } else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") {
      depth--;
      if (depth < 0) return false;
      if (depth === 0) return /^ *(?:#.*)?$/.test(value.slice(i + 1));
    }
  }
  return false;
}

/** The index's reading of a block: its values and the tags it gives (`extractLinksAndTags`), as the indexer takes them. */
function readingOf(block: string): { data: Record<string, unknown>; tags: string[] } {
  BLOCK_READS.count++;
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

function readingOfBlock(block: string, memo?: BlockMemo): BlockReading {
  const known = memo?.readings.get(block);
  if (known) return known;
  const targets: string[] = [];
  targetsIn(block, targets);
  const { data, tags } = readingOf(block);
  const texts: string[] = [];
  textsIn(data, texts);
  for (const text of texts) if (MAY_HOLD_A_LINK.test(text)) targetsIn(text, targets);
  const reading = { targets: [...new Set(targets)], tags };
  return memo ? memo.readings.set(block, reading) : reading;
}

/**
 * Every link target of a block: in its text, and in every text its reading gives (`"[[Aa\x72on]]"` is `[[Aaron]]`).
 * A block whose every text stands in it as written (`plainBlock`) holds no link its text does not show: it is not
 * read as YAML for them. `memo`: what is kept of the note (`BlockMemo`).
 */
export function linkTargetsOfBlock(block: string, memo?: BlockMemo): readonly string[] {
  const known = memo?.targets.get(block);
  if (known) return known;
  let targets: readonly string[];
  if (plainBlock(block)) targets = [...new Set(linkTargetsOfPlainBlock(block))].map(standingAlone);
  else targets = readingOfBlock(block, memo).targets.map(standingAlone);
  return memo ? memo.targets.set(block, targets) : targets;
}

/**
 * A text of its own: a piece read out of a note's text would keep the whole text with it for as long as it is kept
 * (a target kept with a note whose block is let go, `BlockEntry`).
 */
function standingAlone(text: string): string {
  return ` ${text}`.slice(1);
}

/**
 * A block cut to the keys a rollup reads (`propertiesBlockOfKeys`), with its fences, where it could hold a link; null
 * where it holds none; the block itself where it cannot be cut. Read once per text and keys (`BlockMemo`).
 */
export function cutToKeys(block: string, keys: ReadonlySet<string>, memo?: BlockMemo): string | null {
  const key = [...keys].sort().join("\u0000");
  const known = memo?.cuts.get(`${block.length}:${key}`);
  if (known !== undefined) return known;
  BLOCK_READS.count++;
  const cut = propertiesBlockOf(propertiesBlockOfKeys(block, keys) ?? block);
  return memo ? memo.cuts.set(`${block.length}:${key}`, cut) : cut;
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
 * reader. The tags are those of the block; the note's text behind it adds its own (`tagsInView`). A block none of
 * whose links is withheld is the index's (`PROPERTIES_AS_HELD`), read as nothing more than its links.
 */
export function propertiesInView(block: string, isDenied: (target: string) => boolean, memo?: BlockMemo): PropertiesView {
  const denied = linkTargetsOfBlock(block, memo).filter((target) => isDenied(target));
  if (denied.length === 0) return PROPERTIES_AS_HELD;
  const reading = readingOfBlock(block, memo);
  const key = [...new Set(denied)].sort().join("\u0000");
  const ofBlock = memo ? (memo.views.get(block) ?? memo.views.set(block, new Few<ViewCore>())) : null;
  const known = ofBlock?.get(key);
  const core = known ?? viewOf(block, reading, new Set(denied));
  if (!known) ofBlock?.set(key, core);
  return {
    data: { ...core.data },
    title: core.title,
    tags: core.tags,
    blockTags: core.blockTags,
    goneTags: core.goneTags,
    seen: core.seen,
    written: core.written,
    keepTags: (tags) => {
      core.tags = tags;
    },
  };
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
  const written = once(() => {
    BLOCK_READS.count++;
    return withheldWritten(propertiesAsWritten(seen), isDenied);
  });
  return { data, title, blockTags, goneTags, seen, written, tags: null };
}

function withheldWritten(written: Map<string, unknown> | null, isDenied: (target: string) => boolean): Map<string, unknown> | null {
  if (!written) return written;
  return new Map([...written].map(([key, value]) => [withheldText(key, isDenied), withheldValue(value, isDenied)]));
}

/**
 * `PropertiesView` of a block that withholds nothing from the reader: the note as the index holds it, as any other
 * reader is shown it — nothing of it is read again.
 */
export const PROPERTIES_AS_HELD: PropertiesView = Object.freeze({ data: null, title: null, tags: null, blockTags: null, goneTags: new Set<string>(), seen: null, written: () => null });

/**
 * The view of a note none could be formed of for its reader — its block was not to be had when the query looked again
 * (round 11 of the review of R19, wave 2): every value, its title and its tags withheld. A note without a view is never
 * one that withholds nothing.
 */
export const PROPERTIES_WITHHELD: PropertiesView = Object.freeze({ data: Object.freeze({}) as Record<string, unknown>, title: null, tags: new Set<string>() as ReadonlySet<string>, blockTags: Object.freeze([]) as readonly string[], goneTags: new Set<string>() as ReadonlySet<string>, seen: "", written: () => new Map<string, unknown>() });

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
  view.keepTags?.(tags);
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
