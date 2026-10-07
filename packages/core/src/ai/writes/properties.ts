import { Document, isMap, isScalar, parseDocument } from "yaml";
import { canonicalJson } from "../../settingsSync/canonicalJson.js";
import { FrontmatterSurgicalError, deleteFrontmatterPath, readFrontmatterPath, setFrontmatterPath } from "../../frontmatter-surgical.js";
import { OKF_TRUST_KEYS, parseOkfTrustSignals } from "../../okf-trust.js";
import { MAX_ANCHOR_QUOTE_BYTES, type WorkspaceCommentAnchor } from "../../workspace/commentAnchor.js";
import { utf8Encode } from "../../workspace/encoding.js";
import { AI_POLICY_DIMENSIONS, type AiPolicyDimension } from "../policy.js";

/**
 * A change to a property of a note as a suggestion (plan KI-Harness P5).
 *
 * A note's properties are YAML at its top, and a suggestion is a passage of
 * the note with something to stand in its place. So a proposed value is
 * exactly that: the entry of the property — its line, or its lines — and the
 * entry as it would read. Nothing new is stored for it: the round, accepting,
 * declining, a conflict and the sync are the ones every suggestion has, and
 * an app that has never heard of a proposed property accepts it as the text
 * change it is and ends up with the right value.
 *
 * What makes it a property and not a passage is said at its anchor
 * (`display: {kind: "property", key}`), where an anchor may say it; a new
 * property is an insertion in front of the line that closes the properties,
 * and an insertion carries no such hint — `proposedPropertyOf` reads both.
 *
 * The entry is written by hand, not by re-serialising the properties: every
 * other line stays as its author wrote it. `setFrontmatterPath` is the
 * oracle — the result has to mean what it would give — and the fallback for
 * the properties this cannot do line by line.
 */

/** What a property can be set to by a suggestion: text, a number, yes/no, or a list of those. */
export type PropertyValue = string | number | boolean | readonly (string | number | boolean)[];

export const PROPERTY_WRITE_LIMITS = { key: 120, text: 2000, items: 50 } as const;

/**
 * What a write to a property is (plan §12.1, ADR 0019):
 * - `plain` — an ordinary property: a suggestion.
 * - `rules` — the note's own AI rules (`plainva.ai.cloud`, `plainva.ai.web`):
 *   never a suggestion, only a plan the user confirms.
 * - `trust` — who made the note and who vouches for it (`generated`,
 *   `verified`, `sources`, a lifecycle `status`, `stale_after`): never an
 *   assistant's to write (ADR 0023).
 * - `reserved` — the rest of Plainva's own namespace.
 * - `invalid` — no property name, or a value that is none.
 */
export type PropertyWriteClass = "plain" | "rules" | "trust" | "reserved" | "invalid";

export interface PropertyTarget {
  class: PropertyWriteClass;
  /** The path into the properties: one key, or the three of a rule. */
  path: string[];
  /** For `rules`: which rule. */
  rule?: AiPolicyDimension;
}

const RULE_PREFIX = "plainva.ai.";

/** A name with a control character or a line break of any kind in it is no property name. */
function unsafeKey(name: string): boolean {
  for (let index = 0; index < name.length; index++) {
    const code = name.charCodeAt(index);
    if (code < 32 || code === 127 || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

function validValue(value: PropertyValue | null): boolean {
  const scalar = (item: unknown): boolean =>
    typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item)) || (typeof item === "string" && item.length <= PROPERTY_WRITE_LIMITS.text);
  if (value === null) return true;
  if (Array.isArray(value)) return value.length <= PROPERTY_WRITE_LIMITS.items && value.every(scalar);
  return scalar(value);
}

/**
 * Where a write to `key` goes and what kind of write it is, judged against
 * the note as it is and the value as it would be. A trust field is one by its
 * form (okf-trust.ts): `status: Done` in a task database is an ordinary
 * property, `status: stable` is the note's lifecycle — so a key counts as a
 * trust field where the note uses it as one now, or would after the write.
 */
export function propertyTarget(note: string, key: string, value: PropertyValue | null): PropertyTarget {
  const name = key.trim();
  if (!name || name.length > PROPERTY_WRITE_LIMITS.key || unsafeKey(name) || !validValue(value)) return { class: "invalid", path: [] };
  if (name.startsWith(RULE_PREFIX)) {
    const rule = name.slice(RULE_PREFIX.length);
    if ((AI_POLICY_DIMENSIONS as readonly string[]).includes(rule)) {
      // A rule says "deny" or is not there; nothing else is a rule.
      return value === null || value === "deny" ? { class: "rules", path: ["plainva", "ai", rule], rule: rule as AiPolicyDimension } : { class: "invalid", path: [] };
    }
    return { class: "reserved", path: [] };
  }
  if (name === "plainva" || name.startsWith("plainva.")) return { class: "reserved", path: [] };
  if ((OKF_TRUST_KEYS as readonly string[]).includes(name)) {
    const now = parseOkfTrustSignals({ [name]: readFrontmatterPath(note, [name]) }).claimedKeys.includes(name);
    const then = value !== null && parseOkfTrustSignals({ [name]: value }).claimedKeys.includes(name);
    if (now || then) return { class: "trust", path: [name] };
  }
  return { class: "plain", path: [name] };
}

/** One passage of the note and what would stand in its place: the block of a suggestion. */
export interface PropertyBlock {
  from: number;
  to: number;
  replacement: string;
}

export type PropertyChangePlan =
  | {
      ok: true;
      /** The note as it would read. */
      intended: string;
      /** The one block that makes it so; null where the change is not one entry — then the caller diffs `intended`. */
      block: PropertyBlock | null;
      /** The block replaces a passage an anchor can quote in full: it may carry the property hint. */
      hinted: boolean;
      /** The value the note has now; undefined where it has none. */
      current: unknown;
    }
  | { ok: false; problem: "unchanged" | "unreadable" };

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const same = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

/** The result, or null where getting it failed: the entry-wise way is an offer, and the oracle stands behind it. */
function attempt<T>(get: () => T): T | null {
  try {
    return get();
  } catch {
    return null;
  }
}

/** The properties of a note as plain values; null where there are none to read. */
function propertiesOf(text: string): { map: Record<string, unknown>; body: string } | null {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return { map: {}, body: text };
  const doc = parseDocument(match[1]!);
  if (doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents))) return null;
  return { map: (doc.toJS() ?? {}) as Record<string, unknown>, body: text.slice(match[0].length) };
}

/** Two notes that say the same: the same properties with the same values, the same text. */
function sameNote(a: string, b: string): boolean {
  const left = propertiesOf(a);
  const right = propertiesOf(b);
  return left !== null && right !== null && left.body === right.body && same(left.map, right.map);
}

/** A property as its lines, the way the properties of a note are written; no line break at the end. */
function entryLines(key: string, value: PropertyValue, eol: string): string {
  return new Document({ [key]: value }).toString().replace(/\r?\n$/, "").replace(/\r?\n/g, eol);
}

/** The change as one block against the note's own lines, or null where the properties are not written entry by entry. */
function entryChange(base: string, key: string, value: PropertyValue | null, eol: string): { intended: string; block: PropertyBlock } | null {
  const match = FRONTMATTER_RE.exec(base);
  if (!match) {
    if (value === null) return null;
    // No properties yet: the whole block is new, at the very top.
    const intended = setFrontmatterPath(base, [key], value);
    if (!intended.endsWith(base)) return null;
    return { intended, block: { from: 0, to: 0, replacement: intended.slice(0, intended.length - base.length) } };
  }
  const yamlText = match[1]!;
  const yamlStart = match[0].indexOf("\n") + 1;
  const doc = parseDocument(yamlText);
  if (doc.errors.length > 0) return null;
  const items = isMap(doc.contents) ? doc.contents.items : doc.contents === null ? [] : null;
  if (items === null || (isMap(doc.contents) && doc.contents.flow)) return null;
  // Every property begins a line of its own; anything else is not written entry by entry.
  const starts: number[] = [];
  for (const item of items) {
    const start = isScalar(item.key) ? item.key.range?.[0] : undefined;
    if (start === undefined || (start > 0 && yamlText[start - 1] !== "\n")) return null;
    starts.push(start);
  }
  const index = items.findIndex((item) => isScalar(item.key) && item.key.value === key);
  const closeAt = yamlStart + yamlText.length + (base[yamlStart + yamlText.length] === "\r" ? 2 : 1);

  if (index < 0) {
    if (value === null) return null;
    const replacement = `${entryLines(key, value, eol)}${eol}`;
    return { intended: base.slice(0, closeAt) + replacement + base.slice(closeAt), block: { from: closeAt, to: closeAt, replacement } };
  }

  const from = starts[index]!;
  let to = index + 1 < starts.length ? starts[index + 1]! : yamlText.length;
  // Blank lines and comments between two properties belong to neither: the entry ends with its own last line.
  for (;;) {
    const trimmed = yamlText.slice(from, to).replace(/\r?\n$/, "");
    const lastBreak = trimmed.lastIndexOf("\n");
    const lastLine = trimmed.slice(lastBreak + 1);
    if (lastBreak < 0 || !(lastLine.trim() === "" || lastLine.startsWith("#"))) {
      to = from + trimmed.length;
      break;
    }
    to = from + lastBreak + 1;
  }
  if (value !== null) {
    const replacement = entryLines(key, value, eol);
    return { intended: base.slice(0, yamlStart + from) + replacement + base.slice(yamlStart + to), block: { from: yamlStart + from, to: yamlStart + to, replacement } };
  }
  // Removing the only property leaves an empty block, which is written without a line between its fences: the oracle's business.
  if (items.length === 1) return null;
  // The entry goes with one line break: the one behind it, or — for the last property — the one in front of it.
  const behind = /^\r?\n/.exec(yamlText.slice(to))?.[0].length ?? 0;
  const inFront = behind === 0 ? (/\r?\n$/.exec(yamlText.slice(0, from))?.[0].length ?? 0) : 0;
  const start = yamlStart + from - inFront;
  const end = yamlStart + to + behind;
  return { intended: base.slice(0, start) + base.slice(end), block: { from: start, to: end, replacement: "" } };
}

/**
 * What setting one property (or, with `null`, removing it) would make of the
 * note. `key` is a property of the note itself — a name at the top level; the
 * note's rules and trust fields are not planned here (`propertyTarget`).
 */
export function planPropertyChange(base: string, key: string, value: PropertyValue | null): PropertyChangePlan {
  const eol = base.includes("\r\n") ? "\r\n" : "\n";
  const current = readFrontmatterPath(base, [key]);
  let oracle: string;
  try {
    oracle = value === null ? deleteFrontmatterPath(base, [key]) : setFrontmatterPath(base, [key], value);
  } catch (error) {
    if (error instanceof FrontmatterSurgicalError) return { ok: false, problem: "unreadable" };
    throw error;
  }
  if (value === null ? current === undefined : current !== undefined && same(current, value)) return { ok: false, problem: "unchanged" };

  const change = attempt(() => entryChange(base, key, value, eol));
  if (!change || !sameNote(change.intended, oracle)) return { ok: true, intended: oracle, block: null, hinted: false, current };
  const quoted = base.slice(change.block.from, change.block.to);
  return { ok: true, intended: change.intended, block: change.block, hinted: quoted.length > 0 && utf8Encode(quoted).length <= MAX_ANCHOR_QUOTE_BYTES, current };
}

/** One property written as an entry: its name and its value. Null for anything else. */
function singleEntry(text: string): { key: string; value: unknown } | null {
  const doc = parseDocument(text);
  if (doc.errors.length > 0 || !isMap(doc.contents) || doc.contents.flow || doc.contents.items.length !== 1) return null;
  const item = doc.contents.items[0]!;
  if (!isScalar(item.key) || typeof item.key.value !== "string" || !item.key.value) return null;
  return { key: item.key.value, value: (doc.toJS() as Record<string, unknown>)[item.key.value] };
}

export interface ProposedProperty {
  key: string;
  /** The value the suggestion would set; undefined where it removes the property. */
  value: unknown;
  removed: boolean;
}

/**
 * The property a suggestion proposes, read from its anchor and its text — or
 * null where it proposes a passage like any other.
 *
 * Three shapes, the ones `planPropertyChange` writes: an entry replaced or
 * removed (the anchor says which property), an entry inserted in front of the
 * line that closes the properties, and a properties block where the note had
 * none. The last two are judged by their text alone, so a caller that has the
 * note at hand also checks that the place lies in the properties
 * (`noteBodyStart`): three dashes also draw a line in the middle of a note.
 */
export function proposedPropertyOf(anchor: Pick<WorkspaceCommentAnchor, "quote" | "before" | "after" | "display">, replacement: string): ProposedProperty | null {
  const hinted = anchor.display?.kind === "property" ? (anchor.display.key ?? null) : null;
  if (hinted !== null) {
    if (replacement.trim() === "") return { key: hinted, value: undefined, removed: true };
    const entry = singleEntry(replacement);
    return entry && entry.key === hinted ? { key: hinted, value: entry.value, removed: false } : null;
  }
  if (anchor.quote !== "") return null;
  if (/^---(?:\r?\n|$)/.test(anchor.after) && (anchor.before === "" || anchor.before.endsWith("\n")) && /\n$/.test(replacement)) {
    const entry = singleEntry(replacement);
    return entry ? { key: entry.key, value: entry.value, removed: false } : null;
  }
  if (anchor.before === "") {
    const block = FRONTMATTER_RE.exec(replacement);
    const entry = block && block[0].length === replacement.length ? singleEntry(block[1]!) : null;
    return entry ? { key: entry.key, value: entry.value, removed: false } : null;
  }
  return null;
}
