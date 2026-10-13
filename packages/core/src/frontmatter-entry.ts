import { Document, Scalar, isAlias, isMap, isNode, isScalar, isSeq, parse, type CST, type Pair, type YAMLMap, type YAMLSeq } from "yaml";
import { FrontmatterSurgicalError, composeNote, frontmatterSpan, splitDocument, type SplitDocument } from "./frontmatter-block.js";

/**
 * One entry of a properties block, changed where it stands (finding
 * 2026-10-11).
 *
 * Every writer of a property used to end in one function that wrote the WHOLE
 * block through the YAML library: read the block as a document, change one
 * node, print the document. What came back was the library's idea of the
 * block. A value it had read as a number was printed from the number —
 * `plz: 01067` came back as `1067`, `phone: +4915112345678` without its plus,
 * `id: 12345678901234567890` without its last digits, `.5` as `0.5`, `1e3` as
 * `1e+3`, `0x1F` as `0x1f` —, a long line was folded at 80 characters (a
 * quoted address got a backslash at the line end, inside the value), `[a, b]`
 * became `[ a, b ]`, a list was indented, several blank lines became one. And
 * it ran over notes nobody had opened: a tag renamed vault-wide, a column
 * removed from a database, the OKF conversion.
 *
 * Here the block stays TEXT. The library reads it and says where a key and a
 * value stand (`keepSourceTokens`); what is written is a list of changes to
 * that text:
 *
 *  - a value is replaced by replacing its characters — a scalar in the quotes
 *    it has, with the comment behind it left alone;
 *  - a new key is a new line behind the last entry of its map;
 *  - an entry is removed by removing its lines — the lines from its key
 *    through its value, and no line above or below them;
 *  - a key is renamed by replacing the characters of the key;
 *  - a list changes item by item: the items that stay keep their characters
 *    (one that only moves, too), one that goes takes its line, a new one gets
 *    a line in the list's own form (indented as the others are, between the
 *    brackets where the list is written in brackets);
 *  - a map changes entry by entry in the same way.
 *
 * Written anew — from the value, in the library's form — is only an entry
 * whose value changes its SHAPE (a text that becomes a list, a list that
 * becomes empty), and of that entry only what stands behind its colon.
 *
 * Nothing is taken on trust: before a note is handed back, the block is read
 * again and has to say exactly what the change was meant to make it say —
 * the value as it was handed, every other entry as before, the text behind
 * the block untouched. Where the change, made in its place, does not leave
 * that block, it is made with what is new between double quotes, which say a
 * text the library's form cannot say at that place; then the entry at the
 * end of the path is written anew behind its colon, and only then the whole
 * entry at the top of the path (`setEntry` has the order). Where none of
 * these gives the expected block, the note is refused
 * (`FrontmatterSurgicalError`) and stays as it is. A note is never handed
 * back in a form nobody checked.
 *
 * What a properties block is, and what becomes of one that loses its last
 * entry, is decided in `frontmatter-block.ts`.
 */

/** A change to the block's text: the stretch from `from` to `to` becomes `text`. */
interface Edit {
  from: number;
  to: number;
  text: string;
}

/** The block of a note, as text and as the YAML library reads it. */
interface Place {
  /** The note. */
  content: string;
  /** The block's lines as they stand in the note, each with its line break. */
  text: string;
  /** Where those lines begin in the note. */
  at: number;
  /** The note's text behind the block. */
  body: string;
  /** The block as the library reads it: every node with the token it was read from. */
  doc: Document;
  /** The line end a line gets that is new to the block. */
  eol: string;
}

type Data = Record<string, unknown>;

/**
 * The two refusals of this module. Both begin the way the refusal of a block
 * that is no map begins: that beginning is what `errorText` in the UI package
 * knows and says in the user's language — "the block cannot be read as
 * properties, correct it in the note's text". The name of the entry follows
 * for the diagnostics; nothing of the note's text does.
 */
const notInPlace = (key: string) => new FrontmatterSurgicalError(`Frontmatter is not a YAML map whose entry '${key}' can be changed where it stands`);
const noMapUnder = (key: string) => new FrontmatterSurgicalError(`Frontmatter is not a YAML map under '${key}'`);

// ── What is written ────────────────────────────────────────────────────────

/** A line is never folded: a value stays on the line it is written on. */
const WRITE = { lineWidth: 0 } as const;
const WRITE_IN_BRACKETS = { ...WRITE, flowCollectionPadding: false } as const;
/**
 * Every text between double quotes, on one line, with its line ends written
 * out (backslash, n): the form that says any text at any place of a block.
 * The keys stay as they are.
 */
const WRITE_QUOTED = { ...WRITE, defaultStringType: "QUOTE_DOUBLE", defaultKeyType: "PLAIN", doubleQuotedAsJSON: true } as const;
const WRITE_QUOTED_IN_BRACKETS = { ...WRITE_QUOTED, flowCollectionPadding: false } as const;

/**
 * YAML for a value that is NEW to a note — the one place where the YAML of a
 * note comes from the library. It is never handed a document that was read
 * (`yamlWriters.test.ts` holds that line).
 */
function written(value: unknown, options: object = WRITE): string {
  // Two equal objects in a value are two values, not one with a reference to it.
  return new Document(value, { aliasDuplicateObjects: false }).toString(options);
}

/** For nodes that are built by hand before they are written. */
const scratch = new Document(null, { aliasDuplicateObjects: false });

const linesOf = (yaml: string): string[] => yaml.replace(/\n$/, "").split("\n");

/** Lines as they go into the block: indented, each with the note's line end. */
const asLines = (lines: readonly string[], indent: string, eol: string): string => lines.map((line) => (line ? indent + line : line) + eol).join("");

/** `key: value` as the lines of a new entry, from column 0. */
function entryLines(key: string, data: unknown, options: object = WRITE): string[] {
  return linesOf(written({ [key]: data }, options));
}

/** `- value` as the lines of a new item, from column 0. */
function itemLines(data: unknown, options: object = WRITE): string[] {
  return linesOf(written([data], options));
}

/** A scalar with the value `data`, in the style of the one it takes the place of. */
function scalarLike(data: unknown, like: Scalar | null): Scalar {
  const scalar = new Scalar(data);
  if (like?.type) scalar.type = like.type;
  return scalar;
}

/**
 * A scalar as the value of an entry: its first line, then the lines that
 * continue it — indented for an entry at column 0. Null where the library
 * does not write it behind a key.
 */
function scalarLines(data: unknown, like: Scalar | null, options: object = WRITE): string[] | null {
  // In the library's own form a scalar takes the style of the one it replaces; in another form it takes that form.
  const lines = linesOf(written({ k: options === WRITE ? scalarLike(data, like) : data }, options));
  if (!lines[0].startsWith("k: ")) return null;
  return [lines[0].slice(3), ...lines.slice(1)];
}

/** What stands between the brackets `open` and `close` of what the library wrote, where that is one line. */
function onOneLine(out: string, open: string, close: string): string | null {
  if (!out.startsWith(open) || !out.endsWith(`${close}\n`)) return null;
  const text = out.slice(1, -2);
  return text.includes("\n") ? null : text;
}

/**
 * A value as it stands between brackets, on one line; null where it does not
 * fit on one. A text of several lines does, between double quotes.
 */
function inBrackets(data: unknown, like: Scalar | null = null): string | null {
  const item = like && isScalarData(data) ? scalarLike(data, like) : data;
  return (
    onOneLine(written(scratch.createNode([item], { flow: true }), WRITE_IN_BRACKETS), "[", "]") ??
    onOneLine(written(scratch.createNode([data], { flow: true }), WRITE_QUOTED_IN_BRACKETS), "[", "]")
  );
}

/** `key: value` as it stands between braces, on one line; null where it does not fit on one. */
function inBraces(key: string, data: unknown): string | null {
  return (
    onOneLine(written(scratch.createNode({ [key]: data }, { flow: true }), WRITE_IN_BRACKETS), "{", "}") ??
    onOneLine(written(scratch.createNode({ [key]: data }, { flow: true }), WRITE_QUOTED_IN_BRACKETS), "{", "}")
  );
}

/** A key as the library writes one: plain where it can be, in quotes where it has to be. */
function keyText(key: string, inFlow: boolean): string {
  if (inFlow) {
    const pair = inBraces(key, 0);
    if (pair?.endsWith(": 0")) return pair.slice(0, -3);
  } else {
    const lines = entryLines(key, 0);
    if (lines.length === 1 && lines[0].endsWith(": 0")) return lines[0].slice(0, -3);
  }
  throw notInPlace(key);
}

// ── What a block says ──────────────────────────────────────────────────────

const isRecord = (value: unknown): value is Data => typeof value === "object" && value !== null && !Array.isArray(value);
const isScalarData = (value: unknown): boolean => value === null || typeof value !== "object";
const has = (data: Data, key: string): boolean => Object.prototype.hasOwnProperty.call(data, key);
/** `data[key] = value` for any key — also one an object would take for something of its own. */
const put = (data: Data, key: string, value: unknown): void => {
  Object.defineProperty(data, key, { value, enumerable: true, writable: true, configurable: true });
};

/** An object that is nothing but its keys: `{}` or one without a prototype. */
function isPlainObject(value: unknown): value is Data {
  if (!isRecord(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * A value as the block has to say it once it is written — the measure a write
 * is read back against.
 *
 * A text, a number and a boolean are themselves: whatever the library does to
 * write one, it has to be read back as exactly that, or the note is refused.
 * (Until the review of 2026-10-13 every text of several lines was measured by
 * writing it and reading it back, at the root of a document — where the
 * library reads a text that begins with a blank differently from how it wrote
 * it, and drops a byte order mark in front. The damaged value became the
 * measure, and was written.) `undefined` is nothing; a list and a plain object
 * are their items and entries, an entry without a value left out as the
 * library leaves it out. Only what is none of these — a date, an object of a
 * class — is what the library reads back from what it writes for it, under a
 * key, the way it will stand in a note.
 */
export function dataOf(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  // A place of a list that holds nothing is written as nothing, like one that holds `undefined`.
  if (Array.isArray(value)) return Array.from(value, dataOf);
  if (isPlainObject(value)) {
    const data: Data = {};
    for (const key of Object.keys(value)) if (value[key] !== undefined) put(data, key, dataOf(value[key]));
    return data;
  }
  return (parse(written({ v: value })) as { v: unknown }).v;
}

/** Whether two values are the same data. The order of a map's keys says nothing. */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Number.isNaN(a) && Number.isNaN(b);
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  // A date under `!!timestamp` is read as a date: two of them are the same where they are the same moment.
  if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    // By index, not with `every`: that one passes over a place that holds nothing.
    for (let i = 0; i < a.length; i++) if (!sameData(a[i], b[i])) return false;
    return true;
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => has(b as Data, key) && sameData((a as Data)[key], (b as Data)[key]));
}

/**
 * What the block says, as data: its entries by the names the index gives them.
 *
 * Refuses a block that cannot say it: a reference in it leads nowhere
 * (`title: *Draft*` is a reference for YAML, not emphasis), or leads back to
 * itself too often. The index reads no property from such a block either; a
 * write to it could not be read back, so there is none.
 */
export function dataOfBlock(doc: Document): Data {
  let data: unknown;
  try {
    data = doc.toJS();
  } catch {
    throw new FrontmatterSurgicalError("Frontmatter is not a YAML map that can be read: a reference in it leads nowhere");
  }
  return isRecord(data) ? data : {};
}

/** Stands for "nothing stands there" where a value is looked up by its path. */
const ABSENT = Symbol("absent");

/** What the data holds at a path, or `ABSENT`. */
function dataAt(data: Data, path: readonly string[]): unknown {
  let at: unknown = data;
  for (const key of path) {
    if (!isRecord(at) || !has(at, key)) return ABSENT;
    at = at[key];
  }
  return at;
}

const jsOf = (place: Place, node: unknown): unknown => (isNode(node) ? node.toJS(place.doc) : null);

/** `{ a: { b: data } }` for the path a, b. */
function nested(path: readonly string[], data: unknown): unknown {
  let value = data;
  for (let i = path.length - 1; i >= 0; i--) {
    const outer: Data = {};
    put(outer, path[i], value);
    value = outer;
  }
  return value;
}

/** The block's data with `data` at the path. A key on the way that holds something other than a map is refused. */
function withPath(before: Data, path: readonly string[], data: unknown): Data {
  const root: Data = { ...before };
  let at = root;
  for (const key of path.slice(0, -1)) {
    const child = has(at, key) ? at[key] : null;
    if (child !== null && !isRecord(child)) throw noMapUnder(key);
    const copy: Data = child === null ? {} : { ...child };
    put(at, key, copy);
    at = copy;
  }
  put(at, path[path.length - 1], data);
  return root;
}

/** The block's data without what stands at the path. */
function withoutPath(before: Data, path: readonly string[]): Data {
  const root: Data = { ...before };
  let at = root;
  for (const key of path.slice(0, -1)) {
    const copy: Data = { ...(at[key] as Data) };
    put(at, key, copy);
    at = copy;
  }
  delete at[path[path.length - 1]];
  return root;
}

/**
 * The name the index gives a key. It reads the block as data, where every key
 * is a text: `2024:` is listed as "2024", `true:` as "true", a key without a
 * name (`~:`) as "". Null for a key that is no scalar.
 */
function nameOf(pair: Pair): string | null {
  if (!isScalar(pair.key)) return null;
  const name = pair.key.value;
  return typeof name === "string" ? name : name === null || name === undefined ? "" : String(name);
}

/**
 * The entry under a key, by the name the index gives the key. Asked for by
 * the key's own text alone, `2024:` was not found, and a write put a second
 * entry `"2024":` beside it.
 *
 * Where two keys have one name (`"2024":` and `2024:`), it is the LAST of
 * them: that is the one whose value the block says under the name.
 */
function pairOf(map: YAMLMap, key: string): Pair | null {
  for (let i = map.items.length - 1; i >= 0; i--) {
    if (nameOf(map.items[i]) === key) return map.items[i];
  }
  return null;
}

// ── Where things stand ─────────────────────────────────────────────────────

const isBreak = (char: string | undefined): boolean => char === "\n" || char === "\r";
const onlyBlanks = (text: string): boolean => text.trim() === "";

/** Where the line begins that `at` lies on. */
function lineStart(text: string, at: number): number {
  let i = at;
  while (i > 0 && !isBreak(text[i - 1])) i--;
  return i;
}

/** Where the line ends that `at` lies on: at its line break, or at the end of the text. */
function lineEnd(text: string, at: number): number {
  let i = at;
  while (i < text.length && !isBreak(text[i])) i++;
  return i;
}

/**
 * A line of an entry ends in `\n`, in `\r\n`, in a `\r` of its own — or in
 * `\r\r\n`, which is what a file from Windows has after its line ends were
 * converted twice. The Markdown parser reads that last one as a line end and
 * an empty line; for an entry it is the end of ONE line, as it has always
 * been for an editor. Taken apart, a line that is new to such a block would
 * stand between the `\r` and the `\r\n` of the line above it.
 */
function behindBreak(text: string, at: number): number {
  if (at >= text.length) return text.length;
  if (text[at] === "\n") return at + 1;
  if (text[at + 1] === "\n") return at + 2;
  return text[at + 1] === "\r" && text[at + 2] === "\n" ? at + 3 : at + 1;
}

/** Where the line break begins that ends in front of `at`. */
function breakStart(text: string, at: number): number {
  if (text[at - 1] !== "\n") return at - 1;
  if (text[at - 2] !== "\r") return at - 1;
  return text[at - 3] === "\r" ? at - 3 : at - 2;
}

const rangeOf = (node: unknown): readonly [number, number, number] | null => (isNode(node) && node.range ? node.range : null);

/** The lines of an entry or of an item. */
interface Stretch {
  /** Where its first line begins. */
  from: number;
  /** Where it begins on that line, behind the blanks. */
  head: number;
  /** The blanks in front of it. */
  indent: string;
  /** Where the line break of its last line begins. */
  lastBreak: number;
  /** Behind its last line. */
  to: number;
}

interface PairPlace extends Stretch {
  /** Behind the colon between key and value; null for an entry without one. */
  colonEnd: number | null;
}

/**
 * The lines from the one that begins at `from` through the one `end` lies on.
 * A block scalar and a collection end behind a line break of their own; there
 * `end` is already where the next line begins.
 */
function linesThrough(text: string, from: number, end: number): { lastBreak: number; to: number } {
  if (end > from && isBreak(text[end - 1])) {
    // Where the library took the `\r` of a `\r\r\n` for the whole line end, the rest of it is still to come.
    const to = text[end - 1] === "\r" && text.startsWith("\r\n", end) ? end + 2 : end;
    return { lastBreak: breakStart(text, to), to };
  }
  const lastBreak = lineEnd(text, end);
  return { lastBreak, to: behindBreak(text, lastBreak) };
}

const isTrivia = (token: CST.SourceToken): boolean => token.type === "space" || token.type === "comment" || token.type === "newline";

/** Behind the colon between a key and its value; null for an entry without one. */
function colonEndOf(pair: Pair): number | null {
  const colon = (pair as { srcToken?: CST.CollectionItem }).srcToken?.sep?.find((t) => t.type === "map-value-ind");
  return colon ? colon.offset + colon.source.length : null;
}

/** Behind the dash of each item of a list written line by line; null where the list is not read from such lines. */
function dashesOf(seq: YAMLSeq): CST.SourceToken[] | null {
  const token = (seq as { srcToken?: CST.Token }).srcToken;
  if (!token || token.type !== "block-seq") return null;
  const dashes = token.items.flatMap((item) => item.start.filter((t) => t.type === "seq-item-ind"));
  return dashes.length === seq.items.length ? dashes : null;
}

/**
 * Where a value ends: behind the last character of it that says something.
 *
 * For a map or a list written line by line that is NOT where the library says
 * it ends. A last entry without a value (`icon:`) or a last item without one
 * (`-`) is given every empty line and comment that follows, down to the next
 * entry, and the collection is said to end behind them. Taken at its word, the
 * lines of an entry ran over a comment that stands above the NEXT entry — and
 * went with it when the entry was removed (review 2026-10-13). So the end is
 * looked for in the last entry or item itself: its value where it has one,
 * its colon or dash where it has none.
 */
function contentEnd(node: unknown): number {
  if (isMap(node) && !node.flow && node.items.length > 0) {
    const last = node.items[node.items.length - 1];
    return Math.max(rangeOf(last.key)?.[1] ?? 0, colonEndOf(last) ?? 0, contentEnd(last.value));
  }
  if (isSeq(node) && !node.flow && node.items.length > 0) {
    const dashes = dashesOf(node);
    const dash = dashes ? dashes[dashes.length - 1] : null;
    return Math.max(dash ? dash.offset + 1 : 0, contentEnd(node.items[node.items.length - 1]));
  }
  return rangeOf(node)?.[1] ?? 0;
}

/**
 * Where an entry of a map stands that is written line by line. Null where it
 * does not begin its line — `- a: 1` under a list item —: such an entry has no
 * lines of its own.
 */
function pairPlace(text: string, pair: Pair): PairPlace | null {
  const token = (pair as { srcToken?: CST.CollectionItem }).srcToken;
  if (!token) return null;
  const head = token.start.find((t) => !isTrivia(t))?.offset ?? token.key?.offset ?? token.sep?.[0]?.offset;
  if (head === undefined) return null;
  const from = lineStart(text, head);
  const indent = text.slice(from, head);
  if (!/^ *$/.test(indent)) return null;
  const colonEnd = colonEndOf(pair);
  const end = Math.max(rangeOf(pair.key)?.[1] ?? head, colonEnd ?? 0, contentEnd(pair.value));
  return { from, head, indent, colonEnd, ...linesThrough(text, from, end) };
}

/** Where the items of a list stand that is written line by line; null where one of them does not begin its line. */
function itemPlaces(text: string, seq: YAMLSeq): Stretch[] | null {
  const dashes = dashesOf(seq);
  if (!dashes) return null;
  const places: Stretch[] = [];
  for (const [i, dash] of dashes.entries()) {
    const from = lineStart(text, dash.offset);
    const indent = text.slice(from, dash.offset);
    if (!/^ *$/.test(indent) || (places.length > 0 && from < places[places.length - 1].to)) return null;
    const end = Math.max(dash.offset + 1, contentEnd(seq.items[i]));
    places.push({ from, head: dash.offset, indent, ...linesThrough(text, from, end) });
  }
  return places;
}

/** A stretch of the text between brackets: an item of a list, or an entry of a map. */
interface Span {
  from: number;
  to: number;
}

/** Between two items in brackets stands a comma and nothing else that says something. */
const isSeparator = (text: string): boolean => /^\s*,\s*$/.test(text);

/**
 * The stretches between a pair of brackets — or null where something stands
 * between them that is not theirs: a comment, a comma behind the last one.
 */
function spansInBrackets(text: string, bounds: readonly [number, number, number] | null, open: string, close: string, spans: Array<Span | null>): Span[] | null {
  if (!bounds || text[bounds[0]] !== open || text[bounds[1] - 1] !== close) return null;
  let at = bounds[0] + 1;
  for (const [i, span] of spans.entries()) {
    if (!span || span.to <= span.from || span.from < at) return null;
    const between = text.slice(at, span.from);
    if (i === 0 ? !onlyBlanks(between) : !isSeparator(between)) return null;
    at = span.to;
  }
  return onlyBlanks(text.slice(at, bounds[1] - 1)) ? (spans as Span[]) : null;
}

/** The items of a list in brackets. */
function itemSpans(text: string, seq: YAMLSeq): Span[] | null {
  return spansInBrackets(text, rangeOf(seq), "[", "]", seq.items.map((item) => {
    const range = rangeOf(item);
    return range ? { from: range[0], to: range[1] } : null;
  }));
}

/** The entries of a map in braces. */
function pairSpans(text: string, map: YAMLMap): Span[] | null {
  return spansInBrackets(text, rangeOf(map), "{", "}", map.items.map((pair) => {
    const key = rangeOf(pair.key);
    const value = rangeOf(pair.value);
    if (!key || key[1] <= key[0]) return null;
    return { from: key[0], to: Math.max(key[1], colonEndOf(pair) ?? 0, value && value[1] > value[0] ? value[1] : 0) };
  }));
}

// ── The changes ────────────────────────────────────────────────────────────

/** How a list becomes another, item by item, in the order of the new one. */
interface Step {
  kind: "keep" | "replace" | "remove" | "add";
  /** The item of the old list (keep, replace, remove). */
  old: number;
  /** The item of the new list (keep, replace, add). */
  next: number;
}

/** Beyond this many pairs of items, two lists are no longer searched for what they share. */
const SEARCH_LIMIT = 250_000;

/** The items two lists share, in the order they have in both — one longest run of them —, as pairs of their indices. */
function sharedItems(old: readonly unknown[], next: readonly unknown[]): Array<[number, number]> {
  if (old.length === 0 || next.length === 0 || old.length * next.length > SEARCH_LIMIT) return [];
  const width = next.length + 1;
  const length = new Uint32Array((old.length + 1) * width);
  for (let i = old.length - 1; i >= 0; i--) {
    for (let j = next.length - 1; j >= 0; j--) {
      length[i * width + j] = sameData(old[i], next[j]) ? length[(i + 1) * width + j + 1] + 1 : Math.max(length[(i + 1) * width + j], length[i * width + j + 1]);
    }
  }
  const shared: Array<[number, number]> = [];
  for (let i = 0, j = 0; i < old.length && j < next.length; ) {
    if (sameData(old[i], next[j])) shared.push([i++, j++]);
    else if (length[(i + 1) * width + j] >= length[i * width + j + 1]) i++;
    else j++;
  }
  return shared;
}

/**
 * What stays, what goes and what is new between two lists. The items in front
 * and behind that both lists have are passed over first, so a long list with
 * one change costs one walk.
 */
function alignment(old: readonly unknown[], next: readonly unknown[]): Step[] {
  let head = 0;
  while (head < old.length && head < next.length && sameData(old[head], next[head])) head++;
  let tail = 0;
  while (tail < old.length - head && tail < next.length - head && sameData(old[old.length - 1 - tail], next[next.length - 1 - tail])) tail++;

  const steps: Step[] = [];
  for (let i = 0; i < head; i++) steps.push({ kind: "keep", old: i, next: i });
  let i = head;
  let j = head;
  // Between two items that stay: the old ones become the new ones one for one, the rest goes or is new.
  const between = (untilOld: number, untilNext: number) => {
    while (i < untilOld && j < untilNext) steps.push({ kind: "replace", old: i++, next: j++ });
    while (i < untilOld) steps.push({ kind: "remove", old: i++, next: -1 });
    while (j < untilNext) steps.push({ kind: "add", old: -1, next: j++ });
  };
  for (const [a, b] of sharedItems(old.slice(head, old.length - tail), next.slice(head, next.length - tail))) {
    between(head + a, head + b);
    steps.push({ kind: "keep", old: i++, next: j++ });
  }
  between(old.length - tail, next.length - tail);
  for (let k = 0; k < tail; k++) steps.push({ kind: "keep", old: i++, next: j++ });
  return steps;
}

/** A text that is the same for values that are the same data (`sameData`). */
function keyOfData(data: unknown): string {
  if (Array.isArray(data)) return `[${data.map(keyOfData).join(",")}]`;
  if (data instanceof Date) return `date:${data.getTime()}`;
  if (isRecord(data)) return `{${Object.keys(data).sort().map((key) => `${key.length}:${key}=${keyOfData(data[key])}`).join(",")}}`;
  return `${typeof data}:${String(data)}`;
}

/**
 * For an item that is written into a list: the text of an item of the same
 * value the list already holds. An item that only moved keeps its characters.
 * Without this, a list put in another order — or one too long to be searched
 * for what stays in it (`SEARCH_LIMIT`) — was written from its values, `00017`
 * as `17` (review 2026-10-13).
 */
function heldTexts(values: readonly unknown[], textOf: (index: number) => string): (data: unknown) => string | null {
  let byKey: Map<string, number[]> | null = null;
  return (data) => {
    if (!byKey) {
      byKey = new Map();
      for (const [i, value] of values.entries()) {
        const key = keyOfData(value);
        const held = byKey.get(key);
        if (held) held.push(i);
        else byKey.set(key, [i]);
      }
    }
    const index = byKey.get(keyOfData(data))?.find((i) => sameData(values[i], data));
    return index === undefined ? null : textOf(index);
  };
}

/**
 * A scalar that takes the place of another: its characters, in the quotes the
 * old one has. `indent` is what the lines of its entry are indented by; null
 * for a scalar between brackets.
 */
function scalarEdit(place: Place, node: unknown, data: unknown, indent: string | null, options: object = WRITE): Edit[] | null {
  if (!isScalar(node) && !isAlias(node)) return null;
  const range = rangeOf(node);
  if (!range || range[1] <= range[0]) return null;
  const like = isScalar(node) ? node : null;
  if (indent === null) {
    const text = inBrackets(data, like);
    return text === null ? null : [{ from: range[0], to: range[1], text }];
  }
  const lines = scalarLines(data, like, options);
  if (!lines) return null;
  const { text } = place;
  let to = range[1];
  if (like?.type === Scalar.BLOCK_LITERAL || like?.type === Scalar.BLOCK_FOLDED) {
    // A block scalar ends behind its last line break; that one stays where it is.
    if (isBreak(text[to - 1])) to = breakStart(text, to);
    // A comment behind its sign (`text: | # why`) is part of what the library reads as the scalar. It stays
    // behind the sign of the new one — or, where the new value is written without a sign, the entry is written anew.
    const comment = /^[|>][-+0-9]*([ \t]+#.*)$/.exec(text.slice(range[0], lineEnd(text, range[0])));
    if (comment) {
      if (!/^[|>][-+0-9]*$/.test(lines[0])) return null;
      lines[0] += comment[1];
    }
  }
  // A scalar of several lines takes its line to the end: a comment behind the old one would end up inside it.
  if (lines.length > 1 && !onlyBlanks(text.slice(to, lineEnd(text, to)))) return null;
  return [{ from: range[0], to, text: lines[0] + lines.slice(1).map((line) => place.eol + (line ? indent + line : line)).join("") }];
}

/** A list written line by line that becomes another one: item by item. */
function blockSeqEdits(place: Place, seq: YAMLSeq, data: readonly unknown[], options: object = WRITE): Edit[] | null {
  const places = itemPlaces(place.text, seq);
  if (!places || places.length === 0) return null;
  const edits: Edit[] = [];
  const old = seq.items.map((item) => jsOf(place, item));
  const held = heldTexts(old, (i) => place.text.slice(places[i].from, places[i].to));
  // Where a new item goes: behind the last old one that was passed.
  let behind = places[0].from;
  for (const step of alignment(old, data)) {
    if (step.kind === "add") {
      edits.push({ from: behind, to: behind, text: held(data[step.next]) ?? asLines(itemLines(data[step.next], options), places[0].indent, place.eol) });
      continue;
    }
    const at = places[step.old];
    behind = at.to;
    if (step.kind === "remove") edits.push({ from: at.from, to: at.to, text: "" });
    if (step.kind !== "replace" || sameData(old[step.old], data[step.next])) continue;
    const lines = held(data[step.next]);
    if (lines !== null) {
      edits.push({ from: at.from, to: at.to, text: lines });
      continue;
    }
    const inPlace = isScalarData(data[step.next]) ? scalarEdit(place, seq.items[step.old], data[step.next], at.indent, options) : null;
    edits.push(...(inPlace ?? [{ from: at.from, to: at.to, text: asLines(itemLines(data[step.next], options), at.indent, place.eol) }]));
  }
  return edits;
}

/**
 * A list in brackets that becomes another one: what stands between its first
 * and its last item is put together again from the items that stay, as they
 * are written, and the new ones — with what stood between the first two.
 */
function flowSeqEdits(place: Place, seq: YAMLSeq, data: readonly unknown[]): Edit[] | null {
  const spans = itemSpans(place.text, seq);
  if (!spans) return null;
  if (spans.length === 0) {
    const items = data.map((item) => inBrackets(item));
    const bounds = rangeOf(seq)!;
    return items.includes(null) ? null : [{ from: bounds[0] + 1, to: bounds[1] - 1, text: items.join(", ") }];
  }
  const separator = spans.length > 1 ? place.text.slice(spans[0].to, spans[1].from) : ", ";
  const old = seq.items.map((item) => jsOf(place, item));
  const textOf = (i: number): string => place.text.slice(spans[i].from, spans[i].to);
  const held = heldTexts(old, textOf);
  const items: Array<string | null> = [];
  for (const step of alignment(old, data)) {
    if (step.kind === "keep") items.push(textOf(step.old));
    else if (step.kind === "add") items.push(held(data[step.next]) ?? inBrackets(data[step.next]));
    else if (step.kind === "replace") items.push(held(data[step.next]) ?? inBrackets(data[step.next], isScalar(seq.items[step.old]) ? (seq.items[step.old] as Scalar) : null));
  }
  if (items.length === 0 || items.includes(null)) return null;
  return [{ from: spans[0].from, to: spans[spans.length - 1].to, text: items.join(separator) }];
}

/**
 * A map in braces that becomes another one: put together again like a list in
 * brackets, from the entries that stay, as they are written, and the ones that
 * are new or say something else.
 */
function flowMapEdits(place: Place, map: YAMLMap, data: Data): Edit[] | null {
  const spans = pairSpans(place.text, map);
  if (!spans || spans.length === 0) return null;
  const separator = spans.length > 1 ? place.text.slice(spans[0].to, spans[1].from) : ", ";
  const entries: Array<string | null> = [];
  const held = new Set<string>();
  for (const [i, pair] of map.items.entries()) {
    const name = nameOf(pair);
    if (name === null || held.has(name)) return null;
    held.add(name);
    if (!has(data, name)) continue;
    entries.push(sameData(jsOf(place, pair.value), data[name]) ? place.text.slice(spans[i].from, spans[i].to) : inBraces(name, data[name]));
  }
  for (const key of Object.keys(data)) if (!held.has(key)) entries.push(inBraces(key, data[key]));
  if (entries.length === 0 || entries.includes(null)) return null;
  return [{ from: spans[0].from, to: spans[spans.length - 1].to, text: entries.join(separator) }];
}

/** A map written line by line that becomes another one: entry by entry. */
function blockMapEdits(place: Place, map: YAMLMap, data: Data, options: object = WRITE): Edit[] | null {
  const edits: Edit[] = [];
  const held = new Set<string>();
  for (const pair of map.items) {
    const name = nameOf(pair);
    if (name === null || held.has(name)) return null;
    held.add(name);
    const inner = has(data, name) ? pairEdits(place, map, pair, data[name], options) : removal(place, map, pair);
    if (!inner) return null;
    edits.push(...inner);
  }
  for (const key of Object.keys(data)) {
    if (held.has(key)) continue;
    const added = newEntry(place, map, key, data[key], options);
    if (!added) return null;
    edits.push(...added);
  }
  return edits;
}

/**
 * The changes that make a value say `data`, or null where that cannot be done
 * in its place — then whatever holds the value writes it anew. `indent` is
 * what the lines of the entry are indented by; null between brackets.
 */
function valueEdits(place: Place, node: unknown, data: unknown, indent: string | null, options: object = WRITE): Edit[] | null {
  if (sameData(jsOf(place, node), data)) return [];
  if (isScalarData(data)) return scalarEdit(place, node, data, indent, options);
  if (Array.isArray(data)) {
    if (!isSeq(node) || data.length === 0) return null;
    if (node.flow) return flowSeqEdits(place, node, data);
    return indent === null ? null : blockSeqEdits(place, node, data, options);
  }
  if (!isMap(node) || !isRecord(data) || Object.keys(data).length === 0) return null;
  if (node.flow) return flowMapEdits(place, node, data);
  return indent === null ? null : blockMapEdits(place, node, data, options);
}

/**
 * An entry's value written anew, from its colon on: what stood behind the
 * colon goes — a comment on that line with it —, the key and whatever stands
 * above the entry stay.
 */
function anew(place: Place, at: PairPlace, data: unknown, options: object = WRITE): Edit[] | null {
  if (at.colonEnd === null) return null;
  const lines = entryLines("k", data, options);
  if (!lines[0].startsWith("k:")) return null;
  return [{ from: at.colonEnd, to: at.lastBreak, text: lines[0].slice(2) + lines.slice(1).map((line) => place.eol + (line ? at.indent + line : line)).join("") }];
}

/** The changes that make the value of an entry say `data`. */
function pairEdits(place: Place, map: YAMLMap, pair: Pair, data: unknown, options: object = WRITE): Edit[] | null {
  const range = rangeOf(pair.value);
  const hasValue = range !== null && range[1] > range[0];
  if (map.flow) {
    if (!hasValue) return null;
    const inPlace = valueEdits(place, pair.value, data, null, options);
    if (inPlace) return inPlace;
    const text = inBrackets(data);
    return text === null ? null : [{ from: range[0], to: range[1], text }];
  }
  const at = pairPlace(place.text, pair);
  if (!at) return null;
  if (hasValue) {
    const inPlace = valueEdits(place, pair.value, data, at.indent, options);
    if (inPlace) return inPlace;
  } else if (sameData(jsOf(place, pair.value), data)) {
    return [];
  } else if (isScalarData(data) && at.colonEnd !== null) {
    // `key:` with nothing behind it: the value goes behind the colon, in front of whatever follows on the line.
    const lines = scalarLines(data, null, options);
    if (lines?.length === 1) return [{ from: at.colonEnd, to: at.colonEnd, text: ` ${lines[0]}` }];
  }
  return anew(place, at, data, options);
}

/** A new entry: a line behind the last entry of its map, indented as the others are. */
function newEntry(place: Place, map: YAMLMap, key: string, data: unknown, options: object = WRITE): Edit[] | null {
  if (map.flow) {
    const text = inBraces(key, data);
    const spans = pairSpans(place.text, map);
    if (text === null || !spans) return null;
    if (spans.length === 0) {
      const bounds = rangeOf(map)!;
      return [{ from: bounds[0] + 1, to: bounds[1] - 1, text }];
    }
    const end = spans[spans.length - 1].to;
    return [{ from: end, to: end, text: (spans.length > 1 ? place.text.slice(spans[0].to, spans[1].from) : ", ") + text }];
  }
  if (map.items.length === 0) return null;
  const first = pairPlace(place.text, map.items[0]);
  const last = pairPlace(place.text, map.items[map.items.length - 1]);
  if (!first || !last) return null;
  return [{ from: last.to, to: last.to, text: asLines(entryLines(key, data, options), first.indent, place.eol) }];
}

/**
 * An entry that goes: its lines — from the line its key stands on through the
 * last line of its value. No line above or below goes with it: a comment that
 * stands over an entry may as well be a line somebody commented out.
 */
function removal(place: Place, map: YAMLMap, pair: Pair): Edit[] | null {
  if (!map.flow) {
    const at = pairPlace(place.text, pair);
    return at ? [{ from: at.from, to: at.to, text: "" }] : null;
  }
  const spans = pairSpans(place.text, map);
  const i = map.items.indexOf(pair);
  if (!spans || i < 0) return null;
  // Between braces an entry goes with the comma that set it apart: the one behind it, or the one in front of the last.
  if (i < spans.length - 1) return [{ from: spans[i].from, to: spans[i + 1].from, text: "" }];
  return [{ from: i > 0 ? spans[i - 1].to : spans[i].from, to: spans[i].to, text: "" }];
}

/** The changes that put `data` at the path. */
function setEdits(place: Place, path: readonly string[], data: unknown, options: object = WRITE): Edit[] | null {
  const root = place.doc.contents;
  // A block without an entry: the first one goes behind whatever lines it holds.
  if (!isMap(root)) return [{ from: place.text.length, to: place.text.length, text: asLines(entryLines(path[0], nested(path.slice(1), data), options), "", place.eol) }];
  let map = root;
  for (let depth = 0; ; depth++) {
    /** What the entry at this depth has to say. */
    const below = nested(path.slice(depth + 1), data);
    const pair = pairOf(map, path[depth]);
    if (!pair) return newEntry(place, map, path[depth], below, options);
    // The last key of the path — or one on the way that holds no map yet (`plainva:` with nothing behind it).
    if (depth === path.length - 1 || !isMap(pair.value)) return pairEdits(place, map, pair, below, options);
    map = pair.value;
  }
}

/** The entry at the top of a path, written anew to say `data` — for a change that could not be made in its place. */
function topAnew(place: Place, key: string, data: unknown): Edit[] | null {
  const root = place.doc.contents;
  const pair = isMap(root) ? pairOf(root, key) : null;
  if (!isMap(root) || !pair) return null;
  if (root.flow) {
    const range = rangeOf(pair.value);
    const text = inBrackets(data);
    return range && range[1] > range[0] && text !== null ? [{ from: range[0], to: range[1], text }] : null;
  }
  const at = pairPlace(place.text, pair);
  return at ? anew(place, at, data) : null;
}

/**
 * The entry at the END of a path written anew behind its colon — or, where
 * none stands there yet, a new one — and nothing else of the entry at the top
 * of the path. For a change that was made where the value stands and did not
 * leave the block saying what it should: the entries beside it, under the
 * same key at the top, keep their characters.
 */
function endAnew(place: Place, path: readonly string[], data: unknown, options: object): Edit[] | null {
  const root = place.doc.contents;
  if (!isMap(root)) return null;
  let map: YAMLMap = root;
  for (let depth = 0; ; depth++) {
    if (map.flow) return null;
    const below = nested(path.slice(depth + 1), data);
    const pair = pairOf(map, path[depth]);
    if (!pair) return newEntry(place, map, path[depth], below, options);
    if (depth === path.length - 1 || !isMap(pair.value)) {
      const at = pairPlace(place.text, pair);
      return at ? anew(place, at, below, options) : null;
    }
    map = pair.value;
  }
}

/**
 * The entry at the top of a path with every text of its value between double
 * quotes: an entry that is there written anew behind its colon, one that is
 * new as a line behind the last. For a text the library's own form cannot say
 * where the entry stands — one that ends in empty lines, as the last entry of
 * the block: the block's last line end is not the text's.
 */
function topQuoted(place: Place, key: string, data: unknown): Edit[] | null {
  const root = place.doc.contents;
  if (!isMap(root)) return [{ from: place.text.length, to: place.text.length, text: asLines(entryLines(key, data, WRITE_QUOTED), "", place.eol) }];
  if (root.flow) return null;
  const pair = pairOf(root, key);
  if (!pair) return newEntry(place, root, key, data, WRITE_QUOTED);
  const at = pairPlace(place.text, pair);
  return at ? anew(place, at, data, WRITE_QUOTED) : null;
}

// ── From a note to a note ──────────────────────────────────────────────────

function placeOf(split: SplitDocument): Place | null {
  const { span, content } = split;
  if (!span) return null;
  return { content, text: content.slice(span.yamlStart, span.closeAt), at: span.yamlStart, body: split.body, doc: split.doc, eol: split.eol };
}

/** The text with the changes made, or null where two of them meet. */
function withEdits(text: string, edits: readonly Edit[]): string | null {
  // Stable: two lines that go to the same place stay in the order they were asked for.
  const ordered = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  const pieces: string[] = [];
  let at = 0;
  for (const edit of ordered) {
    if (edit.from < at || edit.to < edit.from || edit.to > text.length) return null;
    pieces.push(text.slice(at, edit.from), edit.text);
    at = edit.to;
  }
  pieces.push(text.slice(at));
  return pieces.join("");
}

/**
 * The note with the changes made — where its block then says exactly `after`
 * and the text behind it has not moved. Null otherwise: nothing is handed
 * back that was not read again.
 */
function made(place: Place, edits: Edit[] | null, after: Data): string | null {
  const text = edits && withEdits(place.text, edits);
  if (text === null) return null;
  const next = place.content.slice(0, place.at) + text + place.content.slice(place.at + place.text.length);
  try {
    // Reading can fail in two places: the YAML no longer parses, or a reference in it leads nowhere any more.
    const read = splitDocument(next);
    return read.span && read.span.yamlStart === place.at && read.body === place.body && sameData(dataOfBlock(read.doc), after) ? next : null;
  } catch {
    return null;
  }
}

/** The first of the ways that leaves the block saying `after`; the note is refused where none does. */
function firstMade(place: Place, after: Data, key: string, ways: ReadonlyArray<() => Edit[] | null>): string {
  for (const way of ways) {
    const next = made(place, way(), after);
    if (next !== null) return next;
  }
  throw notInPlace(key);
}

/**
 * A block that holds nothing any more goes, fences included (`composeNote`) —
 * set and removed again, a property leaves the note as it was. A block that
 * still holds a line that says something — a comment — stays.
 */
function withoutEmptyBlock(split: SplitDocument, next: string): string {
  const span = frontmatterSpan(next);
  if (!span) return next;
  const left = next.slice(span.yamlStart, span.closeAt).trim();
  if (left !== "" && left !== "{}") return next;
  return composeNote({ byteOrderMark: split.byteOrderMark, yaml: "", body: next.slice(span.end), eol: split.eol });
}

/**
 * A note without a block gets one, with the given entries. What it says is
 * read back like any other write; a text the library's own form does not say
 * as the last entry of a block is said between double quotes.
 */
function withNewBlock(split: SplitDocument, entries: ReadonlyArray<readonly [string, unknown]>): string {
  const data: Data = {};
  for (const [key, value] of entries) put(data, key, value);
  /** Every entry the usual way; the last one between quotes; all of them. */
  const forms: Array<(index: number) => object> = [() => WRITE, (index) => (index === entries.length - 1 ? WRITE_QUOTED : WRITE), () => WRITE_QUOTED];
  const body = split.body || split.eol;
  for (const form of forms) {
    const yaml = entries.flatMap(([key, value], index) => entryLines(key, value, form(index))).join(split.eol);
    const next = composeNote({ byteOrderMark: split.byteOrderMark, yaml, body, eol: split.eol });
    try {
      const read = splitDocument(next);
      if (read.span && read.body === body && sameData(dataOfBlock(read.doc), data)) return next;
    } catch {
      // Not readable: the next form.
    }
  }
  throw notInPlace(entries[0][0]);
}

/**
 * Sets several keys at the top of the block, each as `setEntry` sets one. A
 * note without a block gets all of them in one go: nothing is there that a
 * line could be set beside, and an import that sets thirty keys on each of
 * ten thousand new notes does not read each of them thirty times.
 */
export function setEntries(content: string, entries: ReadonlyArray<readonly [string, unknown]>): string {
  // Refused before anything is written, also where there is nothing to write.
  const split = splitDocument(content);
  if (entries.length === 0) return content;
  if (!split.span) return withNewBlock(split, entries.map(([key, value]) => [key, dataOf(value)] as const));
  let next = content;
  for (const [key, value] of entries) next = setEntry(next, [key], value);
  return next;
}

/**
 * Sets the value at a path — `["status"]`, `["plainva", "icon"]` — and changes
 * nothing else in the note. Maps on the way are made as needed; a note
 * without a block gets one. A value that already stands there leaves the note
 * untouched.
 */
export function setEntry(content: string, path: readonly string[], value: unknown): string {
  if (path.length === 0) throw new FrontmatterSurgicalError("Path must not be empty");
  const data = dataOf(value);
  const split = splitDocument(content, { sourceTokens: true });
  const place = placeOf(split);
  if (!place) return withNewBlock(split, [[path[0], nested(path.slice(1), data)]]);
  const before = dataOfBlock(place.doc);
  // The value that stands there, as it was handed: also one that data has no
  // word for and YAML has — a date under `!!timestamp`, which would be written
  // as its text.
  if (sameData(value, dataAt(before, path))) return content;
  const after = withPath(before, path, data);
  if (sameData(before, after)) return content;
  return firstMade(place, after, path[0], [
    // Where the value stands; what is new to the block in the library's own form.
    () => setEdits(place, path, data),
    // The same with what is new between double quotes, which say a text at
    // any place. The library's own form cannot where a text ends in empty
    // lines and stands last in the block or in front of an empty line.
    () => setEdits(place, path, data, WRITE_QUOTED),
    // The entry at the end of the path written anew behind its colon, both
    // ways. Behind the two above: where the path ends at a list or a map,
    // that is the whole of it, written from its values.
    () => endAnew(place, path, data, WRITE),
    () => endAnew(place, path, data, WRITE_QUOTED),
    // And only then the whole entry at the top of the path, both ways.
    () => topAnew(place, path[0], after[path[0]]),
    () => topQuoted(place, path[0], after[path[0]]),
  ]);
}

/**
 * Removes the entry at a path, and nothing else in the note: its lines go.
 * A map this leaves without an entry goes with it (an empty `plainva:` should
 * not linger), and so does the block once nothing is left in it. Where the
 * path leads nowhere, the note comes back untouched.
 */
export function removeEntry(content: string, path: readonly string[]): string {
  if (path.length === 0) throw new FrontmatterSurgicalError("Path must not be empty");
  const split = splitDocument(content, { sourceTokens: true });
  const place = placeOf(split);
  const root = split.doc.contents;
  if (!place || !isMap(root)) return content;

  /** The entries on the way, each in its map. */
  const way: Array<{ map: YAMLMap; pair: Pair; name: string }> = [];
  let map = root;
  for (const [depth, key] of path.entries()) {
    const pair = pairOf(map, key);
    const name = pair && nameOf(pair);
    if (!pair || name === null) return content;
    way.push({ map, pair, name });
    if (depth === path.length - 1) break;
    if (!isMap(pair.value)) return content;
    map = pair.value;
  }
  // The highest entry that goes: a map that this leaves empty goes instead of its last entry.
  let depth = way.length - 1;
  while (depth > 0 && way[depth].map.items.length === 1) depth--;

  const names = way.slice(0, depth + 1).map((step) => step.name);
  const after = withoutPath(dataOfBlock(place.doc), names);
  const lines = () => removal(place, way[depth].map, way[depth].pair);
  const next = firstMade(place, after, path[0], [
    lines,
    // A block scalar that keeps its trailing lines (`|+`) counts the empty
    // lines behind it as its own. An entry taken out from behind one must not
    // hand it more of them, or fewer: the empty lines behind the entry go
    // with it, or one stays in its place.
    () => withEmptyLines(place, way[depth].map, lines(), "taken"),
    () => withEmptyLines(place, way[depth].map, lines(), "left"),
    () => (depth > 0 ? topAnew(place, way[0].name, after[way[0].name]) : null),
  ]);
  return Object.keys(after).length === 0 ? withoutEmptyBlock(split, next) : next;
}

/**
 * The removal of an entry's lines, with the empty lines directly behind them
 * taken along — or with one empty line left in their place.
 */
function withEmptyLines(place: Place, map: YAMLMap, edits: Edit[] | null, how: "taken" | "left"): Edit[] | null {
  if (map.flow || !edits || edits.length !== 1) return null;
  const [{ from, to }] = edits;
  if (how === "left") return [{ from, to, text: place.eol }];
  let end = to;
  while (end < place.text.length) {
    const lineBreak = lineEnd(place.text, end);
    if (lineBreak === place.text.length || !onlyBlanks(place.text.slice(end, lineBreak))) break;
    end = behindBreak(place.text, lineBreak);
  }
  return end > to ? [{ from, to: end, text: "" }] : null;
}

/**
 * Renames a key at the top of the block: the characters of the key change,
 * the entry stays where it is with its value and its comments. Untouched where
 * the key is absent; refused where the new key already exists.
 */
export function renameEntryKey(content: string, from: string, to: string): string {
  const split = splitDocument(content, { sourceTokens: true });
  const place = placeOf(split);
  const root = split.doc.contents;
  if (!place || !isMap(root)) return content;
  const pair = pairOf(root, from);
  const name = pair && nameOf(pair);
  if (!pair || name === null) return content;
  if (pairOf(root, to)) throw new FrontmatterSurgicalError(`Cannot rename '${from}' to '${to}': target key already exists`);

  const before = dataOfBlock(place.doc);
  const after: Data = {};
  for (const key of Object.keys(before)) put(after, key === name ? to : key, before[key]);
  const range = rangeOf(pair.key);
  return firstMade(place, after, from, [() => (range && range[1] > range[0] ? [{ from: range[0], to: range[1], text: keyText(to, root.flow === true) }] : null)]);
}

/**
 * Changes scalars where they stand: under each of the given keys at the top of
 * the block, the value itself or the items of its list. `change` is handed the
 * value of one and the text it is written with, and answers its new value —
 * or the value it was handed, to leave it. Nothing else in the note moves;
 * `changed` counts the scalars that were written.
 */
export function changeScalars(
  content: string,
  keys: readonly string[],
  change: (value: unknown, written: string | null) => unknown,
  /** The note's block, where the caller has read it already — with its source tokens. */
  split: SplitDocument = splitDocument(content, { sourceTokens: true })
): { content: string; changed: number } {
  const place = placeOf(split);
  const root = split.doc.contents;
  if (!place || !isMap(root)) return { content, changed: 0 };

  let before: Data;
  try {
    before = dataOfBlock(place.doc);
  } catch {
    // A block that cannot say what it holds: nothing in it is changed. This runs over every note of a vault.
    return { content, changed: 0 };
  }
  const after: Data = { ...before };
  /** The entries that change, each with what it has to say. */
  const entries: Array<{ pair: Pair; key: string; data: unknown }> = [];
  let changed = 0;
  const changedScalar = (node: unknown): unknown => {
    const old = jsOf(place, node);
    if (!isScalar(node)) return old;
    const next = dataOf(change(node.value, typeof node.source === "string" ? node.source : null));
    if (sameData(next, old)) return old;
    changed++;
    return next;
  };
  for (const key of keys) {
    const pair = root.items.find((item) => isScalar(item.key) && item.key.value === key);
    if (!pair) continue;
    const before = changed;
    const data = isSeq(pair.value) ? pair.value.items.map(changedScalar) : changedScalar(pair.value);
    if (changed === before) continue;
    put(after, key, data);
    entries.push({ pair, key, data });
  }
  if (entries.length === 0) return { content, changed: 0 };

  const each = (edits: (entry: (typeof entries)[number]) => Edit[] | null) => (): Edit[] | null => {
    const all: Edit[] = [];
    for (const entry of entries) {
      const one = edits(entry);
      if (!one) return null;
      all.push(...one);
    }
    return all;
  };
  // Each scalar where it stands — and where one cannot be changed there, its entry written anew.
  const next = firstMade(place, after, entries[0].key, [
    each((entry) => pairEdits(place, root, entry.pair, entry.data)),
    each((entry) => topAnew(place, entry.key, entry.data)),
  ]);
  return { content: next, changed };
}
