import { CST, Scalar, isAlias, isMap, isScalar, isSeq, type YAMLMap } from "yaml";
import { frontmatterSpan, splitDocument, type SplitDocument } from "./frontmatter-block.js";
import { changeScalars, removeEntry, renameEntryKey, setEntries, setEntry } from "./frontmatter-entry.js";

/**
 * Surgical frontmatter edits: these helpers change the entry they are asked
 * to change, where it stands, and nothing else in the note. Every other entry
 * keeps its place, its form and its comments, byte for byte, and so does the
 * text behind the block. This is the only write path allowed for operations
 * over files the user never opened (a tag renamed vault-wide, a column removed
 * from a database, the OKF conversion), where silent reformatting would be
 * unacceptable.
 *
 * How an entry is changed where it stands is `frontmatter-entry.ts`; what a
 * properties block is, and what becomes of one that loses its last entry, is
 * decided in `frontmatter-block.ts` — for these helpers and for
 * updateFrontmatterString alike.
 */

export { FrontmatterSurgicalError, frontmatterSpan, noteBodyOf, noteWithoutProperties, type FrontmatterSpan } from "./frontmatter-block.js";

const RESERVED_PROPERTY_NAMES = ["__proto__", "prototype", "constructor", "type", "okf_version", "generated", "verified", "sources"];

/**
 * Names nobody adds a property under: Plainva's own namespace, the virtual
 * columns of a database (`file.…`, `formula.…`), the note's type and format
 * marker, the trust fields that are trust fields by their name, and the names
 * that reach into an object's prototype once the properties are read. One
 * answer for everyone who adds a property — both shells' "add a property",
 * and a value an assistant proposes.
 */
export function isReservedPropertyName(name: string): boolean {
  return /^(?:file\.|formula\.|plainva(?:$|[.:]))/i.test(name) || RESERVED_PROPERTY_NAMES.includes(name.toLowerCase());
}

/**
 * Whether the property writers refuse the block at the top of a note: YAML
 * that does not parse, or YAML that is no map — a list, a line of prose, a
 * number (`parseBlockYaml`). The index's reader reads a block of prose or a
 * number as one without properties (ADR 0009, addendum 2026-10-22); the
 * properties panel and the phone's sheet ask here as well, and say what a
 * write would say.
 */
export function propertiesBlockRefused(content: string): boolean {
  try {
    splitDocument(content);
    return false;
  } catch {
    return true;
  }
}

/**
 * Sets the given top-level keys (nested plain objects/arrays allowed as
 * values), leaving every other key untouched. Creates a frontmatter block at
 * the top when none exists.
 */
export function upsertFrontmatterKeys(
  content: string,
  updates: Record<string, unknown>
): string {
  return setEntries(content, Object.entries(updates));
}

/**
 * Sets a nested value, e.g. setFrontmatterPath(content, ["plainva", "icon"], "🚀").
 * Intermediate maps are created as needed; sibling keys stay untouched.
 */
export function setFrontmatterPath(
  content: string,
  path: readonly string[],
  value: unknown
): string {
  return setEntry(content, path, value);
}

/**
 * Reads the value at a nested frontmatter path (e.g. ["plainva", "tasks"]).
 * Read-only and total: returns undefined when the content has no parseable
 * frontmatter, the path is empty, or the key is absent — it never throws, so
 * hot read paths (task/graph aggregation) can call it per note safely.
 *
 * Collections come back as PLAIN JS values, not yaml AST nodes: `getIn` returns
 * the node for a list/map, so a caller reading e.g. `plainva.blocks` would get
 * a YAMLSeq and `Array.isArray` would quietly say false. Scalars were already
 * plain values, so this only ever widens what callers can read.
 */
/**
 * The top-level frontmatter keys, in document order; `[]` when the note has no
 * frontmatter or its YAML cannot be parsed.
 *
 * The read-only counterpart to the surgical writers, and deliberately cheap: a
 * property comment (plan Stufe E, E2) has to ask "does the key I was written
 * against still exist?" on every keystroke, which rules out the route the
 * properties panel takes (parse the whole markdown AST, then extract the
 * frontmatter). Unparseable YAML answers `[]` rather than throwing - a
 * half-typed document must never make a comment card disappear.
 */
export function frontmatterKeys(content: string): string[] {
  let split: SplitDocument;
  try {
    split = splitDocument(content);
  } catch {
    return [];
  }
  if (!split.hadFrontmatter || !isMap(split.doc.contents)) return [];
  const keys: string[] = [];
  for (const item of split.doc.contents.items) {
    const key = item.key;
    if (isScalar(key) && typeof key.value === "string" && key.value) keys.push(key.value);
  }
  return keys;
}

export function readFrontmatterPath(content: string, path: readonly string[]): unknown {
  if (path.length === 0) return undefined;
  let split: SplitDocument;
  try {
    split = splitDocument(content);
  } catch {
    return undefined;
  }
  if (!split.hadFrontmatter || split.doc.contents === null) return undefined;
  const value = split.doc.getIn(path);
  return isNode(value) ? value.toJSON() : value;
}

/** A yaml AST node (list/map) as opposed to an already-plain scalar value. */
function isNode(value: unknown): value is { toJSON: () => unknown } {
  return !!value && typeof value === "object" && typeof (value as { toJSON?: unknown }).toJSON === "function";
}

/**
 * What becomes of one entry of the tags when `old` is renamed to `next`: the
 * tag itself and its children (`old/sub` -> `next/sub`). Handed the value as
 * the YAML reads it, the text it is written with and whether it is an item of
 * a list; answers the value it was handed where no tag in it is renamed.
 *
 * A tag is found by the text the index's reader reads it as
 * (`metadata-extractor.ts`), or the index would list a tag the rename cannot
 * find: a number among the tags (`- 2024`) is the tag `2024`, as it is
 * written (`- 1.10` is `1.10`); a text with commas directly under the key
 * (`tags: a, b`) is its parts, and a part is renamed where it stands in it.
 * Such a text over several lines is written anew, on one line, and a new name
 * YAML would read as a number (`2025`) stands between quotes: the index reads
 * either as the same tags.
 */
function renamedTag(value: unknown, written: string | null, inList: boolean, old: string, next: string): unknown {
  const renamed = (tag: string): string | null => {
    if (tag === old) return next;
    return tag.startsWith(old + "/") ? next + tag.slice(old.length) : null;
  };
  if (typeof value === "string") {
    if (inList) return renamed(value) ?? value;
    let changed = false;
    const parts = value.split(",").map((part) => {
      const tag = part.trim();
      const to = tag ? renamed(tag) : null;
      if (to === null) return part;
      changed = true;
      const at = part.indexOf(tag);
      return part.slice(0, at) + to + part.slice(at + tag.length);
    });
    return changed ? parts.join(",") : value;
  }
  if (value === null || value === undefined || typeof value === "object") return value;
  return renamed(written || String(value)) ?? value;
}

/**
 * The same under `tag`, which the index does not read as tags: a text that is
 * the tag or one of its children, compared whole, as before 2026-10-22.
 */
function renamedTagText(value: unknown, old: string, next: string): unknown {
  if (typeof value !== "string") return value;
  if (value === old) return next;
  return value.startsWith(old + "/") ? next + value.slice(old.length) : value;
}

/**
 * Renames a tag value inside the `tags`/`tag` frontmatter key — the exact tag and
 * its children (`old/sub` -> `new/sub`) — where it stands: the characters of the
 * tag change, in the quotes it has, and nothing else in the note does (a text
 * of several tags over several lines is written anew, see `renamedTag`). Returns
 * the content unchanged (and changed=false) when there is no parseable
 * frontmatter or no matching tag. The inline `#tag` rewrite in the body is the
 * caller's job.
 */
export function renameFrontmatterTag(
  content: string,
  oldTag: string,
  newTag: string
): { content: string; changed: boolean } {
  const o = oldTag.replace(/^#/, "");
  const n = newTag.replace(/^#/, "");
  if (!o || !n || o === n) return { content, changed: false };
  let split: SplitDocument;
  try {
    split = splitDocument(content, { sourceTokens: true });
  } catch {
    return { content, changed: false };
  }
  const result = changeScalars(
    content,
    ["tags", "tag"],
    (value, written, inList, key) => (key === "tags" ? renamedTag(value, written, inList, o, n) : renamedTagText(value, o, n)),
    split
  );
  return result.changed > 0 ? { content: result.content, changed: true } : { content, changed: false };
}

/**
 * Deletes a nested key: the lines of its entry go, and no other line of the
 * note. Parent maps that become empty through this deletion are removed as
 * well (an empty `plainva:` namespace should not linger) — and so is the block
 * itself once nothing is left in it: a property set and removed again leaves
 * the note as it was.
 * Returns the content unchanged if the path does not exist.
 */
export function deleteFrontmatterPath(content: string, path: readonly string[]): string {
  return removeEntry(content, path);
}

/**
 * Renames a top-level key in place: the characters of the key change;
 * position, value and comments stay. No-op when oldKey is absent; throws when
 * newKey already exists.
 */
export function renameFrontmatterKey(
  content: string,
  oldKey: string,
  newKey: string
): string {
  return renameEntryKey(content, oldKey, newKey);
}

export interface FrontmatterLinkRename {
  /** Frontmatter key to inspect (from links.property_key). */
  key: string;
  /** Anchor-free link base to replace, as stored in links.target_path. */
  oldTarget: string;
  newTarget: string;
}

const WHOLE_WIKILINK_RE = /^\s*\[\[([^[\]]+)\]\]\s*$/;

/** Split a wiki-link inner text into base, anchor (leading #/^) and alias (leading |). */
function splitWikiInner(inner: string): { base: string; anchor: string; alias: string } {
  const pipeIdx = inner.indexOf("|");
  const targetRaw = pipeIdx === -1 ? inner : inner.slice(0, pipeIdx);
  const alias = pipeIdx === -1 ? "" : inner.slice(pipeIdx);
  const trimmed = targetRaw.trim();
  const hashIdx = trimmed.indexOf("#");
  const caretIdx = trimmed.indexOf("^");
  let anchorIdx = -1;
  if (hashIdx !== -1 && caretIdx !== -1) anchorIdx = Math.min(hashIdx, caretIdx);
  else if (hashIdx !== -1) anchorIdx = hashIdx;
  else if (caretIdx !== -1) anchorIdx = caretIdx;
  if (anchorIdx !== -1) {
    return { base: trimmed.slice(0, anchorIdx).trim(), anchor: trimmed.slice(anchorIdx).trim(), alias };
  }
  return { base: trimmed, anchor: "", alias };
}

/**
 * Whether a link in the properties can name this file as the name is written:
 * the block reads a whole value as a link only without a bracket inside it
 * (the index reads it so too, `ast-scanner.ts`), up to the first `#`, `^` or
 * `|` (finding 2026-10-21).
 */
const propertiesCanName = (name: string): boolean => WHOLE_WIKILINK_RE.test(`[[${name}]]`) && splitWikiInner(name).base === name;

/** A text as it stands between double quotes in YAML, for the two characters that need a backslash there. */
const inDoubleQuotes = (text: string): string => text.replace(/[\\"]/g, "\\$&");
/** A text as it stands between single quotes in YAML. */
const inSingleQuotes = (text: string): string => text.replace(/'/g, "''");

/** A change to a scalar as it is written in the YAML: the stretch from `from` to `to` of it becomes `text`. */
interface ScalarEdit {
  from: number;
  to: number;
  text: string;
}

/**
 * What has to change in one scalar, as it is written in the YAML, for the
 * `base` that begins at `at` of its value to become `next` — or null where
 * that cannot be done without guessing.
 *
 * The value is one link, so `[[` stands in the scalar once, and the target
 * follows it the way the value says: as it is in a block scalar, and between
 * quotes but for the characters the quote style escapes. Where the scalar
 * spells it so, the target's characters are the whole change — whatever the
 * rest of the scalar looks like: an alias folded onto a second line stays
 * folded, and a line end inside the scalar stays the one the note has.
 * A quoted scalar that spells the target itself another way — an escape the
 * quotes do not need (`[`), a fold inside the name — is written anew by
 * the YAML library in the quotes it has; nothing outside the scalar moves then
 * either.
 */
function targetInScalar(written: string, node: Scalar, value: string, at: number, base: string, next: string): ScalarEdit | null {
  const quoted = node.type === Scalar.QUOTE_DOUBLE || node.type === Scalar.QUOTE_SINGLE;
  const quote = node.type === Scalar.QUOTE_DOUBLE ? inDoubleQuotes : node.type === Scalar.QUOTE_SINGLE ? inSingleQuotes : (text: string) => text;
  const open = written.indexOf("[[");
  // The blanks between `[[` and the target, then the target.
  const lead = value.slice(value.indexOf("[[") + 2, at);
  if (open >= 0 && written.indexOf("[[", open + 1) < 0 && written.startsWith(lead + quote(base), open + 2)) {
    const from = open + 2 + lead.length;
    return { from, to: from + quote(base).length, text: quote(next) };
  }
  const token = node.srcToken;
  if (!quoted || !token || (token.type !== "double-quoted-scalar" && token.type !== "single-quoted-scalar") || token.source !== written) return null;
  CST.setScalarValue(token, value.slice(0, at) + next + value.slice(at + base.length));
  return { from: 0, to: written.length, text: token.source };
}

/**
 * The value under a key as the index names the key. The index reads the block
 * as data, where every key is a text: `1:` is listed as "1", `true:` as
 * "true", a key without a name (`~:`) as "". In the YAML they are a number, a
 * boolean and nothing, and asked for by their text they are not found.
 */
function valueUnder(map: YAMLMap, key: string): unknown {
  const direct = map.get(key, true);
  if (direct !== undefined) return direct;
  for (const pair of map.items) {
    const name = isScalar(pair.key) ? pair.key.value : pair.key;
    if (typeof name === "string" || (typeof name === "object" && name !== null)) continue;
    if ((name === null || name === undefined ? "" : String(name)) === key) return pair.value;
  }
  return undefined;
}

/**
 * Rewrites whole-value wiki links (`"[[T]]"`, `"[[T#a|alias]]"`) in the given
 * frontmatter keys — scalar string values and string items of sequences —
 * where they stand: the characters of the target change, and nothing else in
 * the note does. Anchor, alias, the scalar's quotes, the block's comments,
 * spacing and line ends, every other entry and the text behind the block stay
 * byte for byte.
 *
 * It does not write the block anew through the YAML library (finding
 * 2026-10-09; no helper here does any more, see `frontmatter-entry.ts`). A
 * rename runs over notes nobody opened, and a block written anew came back in
 * the library's form: a long line folded at 80 characters, `[a, b]` as
 * `[ a, b ]`, `- item` under a key indented, `007` as `7`.
 *
 * Only the listed keys are inspected; missing keys and non-string items are
 * no-ops. `skipped` counts links that name one of the targets and could not
 * be rewritten in place — a link folded over two lines of a block scalar, one
 * whose new name a link here cannot carry (`propertiesCanName`), or one a key
 * holds only by reference (`key: *a`) while the value it refers to was not
 * rewritten: they still name the old file. Malformed frontmatter
 * throws FrontmatterSurgicalError (callers keep their body-side fix, see
 * renameNote).
 */
export function renameFrontmatterWikiLinks(
  content: string,
  renames: readonly FrontmatterLinkRename[]
): { content: string; renamed: number; skipped: number } {
  if (renames.length === 0) return { content, renamed: 0, skipped: 0 };
  const split = splitDocument(content, { sourceTokens: true });
  const span = frontmatterSpan(content);
  const map = split.doc.contents;
  if (!span || !split.hadFrontmatter || !isMap(map)) return { content, renamed: 0, skipped: 0 };

  const byKey = new Map<string, Map<string, string>>();
  for (const r of renames) {
    if (!byKey.has(r.key)) byKey.set(r.key, new Map());
    byKey.get(r.key)!.set(r.oldTarget, r.newTarget);
  }

  /** Changes to the YAML as it stands in the note, by its offsets. */
  const edits: Array<{ from: number; to: number; text: string }> = [];
  let skipped = 0;
  /** The scalars a change was made in, and — once per reference — those a key holds by reference. */
  const rewritten = new Set<Scalar>();
  const referred: Scalar[] = [];
  /** The target a scalar's link is to get, and where the old one begins in its value; null where it holds no such link. */
  const wanted = (node: Scalar, targets: Map<string, string>): { base: string; next: string; at: number } | null => {
    if (typeof node.value !== "string") return null;
    const match = WHOLE_WIKILINK_RE.exec(node.value);
    if (!match) return null;
    const { base } = splitWikiInner(match[1]);
    const next = targets.get(base);
    if (next === undefined || next === base) return null;
    // Behind `[[` and the blanks in front of the target.
    const inner = match[1];
    const pipe = inner.indexOf("|");
    const target = pipe === -1 ? inner : inner.slice(0, pipe);
    return { base, next, at: node.value.indexOf("[[") + 2 + (target.length - target.trimStart().length) };
  };
  const rewriteScalar = (node: unknown, targets: Map<string, string>) => {
    if (isAlias(node)) {
      // The value stands where its anchor is; it changes there or not at all.
      const source = node.resolve(split.doc);
      if (isScalar(source) && wanted(source, targets)) referred.push(source);
      return;
    }
    if (!isScalar(node) || typeof node.value !== "string") return;
    const link = wanted(node, targets);
    if (!link || rewritten.has(node)) return;
    // A name a link here cannot carry is not written: the link keeps the old one.
    if (!propertiesCanName(link.next)) {
      skipped++;
      return;
    }
    const range = node.range;
    const written = range ? span.yaml.slice(range[0], range[1]) : null;
    const edit = range && written !== null && node.value.startsWith(link.base, link.at) ? targetInScalar(written, node, node.value, link.at, link.base, link.next) : null;
    if (!range || edit === null) {
      skipped++;
      return;
    }
    edits.push({ from: range[0] + edit.from, to: range[0] + edit.to, text: edit.text });
    rewritten.add(node);
  };

  for (const [key, targets] of byKey) {
    const value = valueUnder(map, key);
    if (value == null) continue;
    if (isSeq(value)) {
      for (const item of value.items) rewriteScalar(item, targets);
    } else {
      rewriteScalar(value, targets);
    }
  }
  for (const source of referred) if (!rewritten.has(source)) skipped++;

  if (edits.length === 0) return { content, renamed: 0, skipped };
  // In one pass over the note. A scalar is changed once, so no two changes meet.
  edits.sort((a, b) => a.from - b.from);
  const pieces: string[] = [];
  let cursor = 0;
  for (const edit of edits) {
    pieces.push(content.slice(cursor, span.yamlStart + edit.from), edit.text);
    cursor = span.yamlStart + edit.to;
  }
  pieces.push(content.slice(cursor));
  return { content: pieces.join(""), renamed: edits.length, skipped };
}

export interface EnsureOkfFrontmatterOptions {
  /** OKF type to set when the document has none (or only a blank string). */
  type: string;
}

export interface EnsureOkfFrontmatterResult {
  content: string;
  changed: boolean;
  setType: boolean;
}

/**
 * Guarantees the OKF minimum frontmatter (`type`) on a document. Existing
 * non-blank `type` values are always kept — they are valid OKF types by
 * definition (free string). A non-string `type` is left untouched here;
 * resolving it (rename) is an explicit, user-driven conversion step.
 *
 * Since OKF v0.2 (E1, 2026-08-20) this no longer writes `okf_version`: the
 * spec places that declaration only in the bundle-root `index.md`, and the
 * per-note copy Plainva used to add was never read by anything. An existing
 * `okf_version` key is left exactly as it is.
 */
export function ensureOkfFrontmatter(
  content: string,
  options: EnsureOkfFrontmatterOptions
): EnsureOkfFrontmatterResult {
  const split = splitDocument(content);
  const map = split.doc.contents;

  const existingType = isMap(map) && map.has("type") ? split.doc.get("type") : undefined;
  const typeIsBlank =
    existingType === undefined ||
    existingType === null ||
    (typeof existingType === "string" && existingType.trim() === "");
  if (!typeIsBlank) {
    return { content, changed: false, setType: false };
  }
  return { content: setEntry(content, ["type"], options.type), changed: true, setType: true };
}
