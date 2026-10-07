import { Document, isMap, isScalar, parseDocument } from "yaml";
import { canonicalJson } from "../../settingsSync/canonicalJson.js";
import { FrontmatterSurgicalError, deleteFrontmatterPath, frontmatterSpan, isReservedPropertyName, readFrontmatterPath, setFrontmatterPath } from "../../frontmatter-surgical.js";
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
 * - `reserved` — the rest of Plainva's own namespace, and every other name
 *   nobody adds a property under (`isReservedPropertyName`): what the app's
 *   own "add a property" refuses, a proposed value does not get either.
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
const TRUST_BY_NAME: readonly string[] = ["generated", "verified", "sources"];

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
 * the note as it is and the value as it would be. `generated`, `verified` and
 * `sources` are trust fields by their name. `status` and `stale_after` are
 * trust fields by their form (okf-trust.ts): `status: Done` in a task
 * database is an ordinary property, `status: stable` is the note's lifecycle
 * — so these two count as trust fields where the note uses them as such now,
 * or would after the write.
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
  // Who made a note, who vouches for it and what it rests on are trust fields by their name, whatever stands there.
  if (TRUST_BY_NAME.includes(name.toLowerCase())) return { class: "trust", path: [name] };
  // The names nobody adds a property under — the app's own "add a property" takes none of them either.
  if (isReservedPropertyName(name)) return { class: "reserved", path: [] };
  if ((OKF_TRUST_KEYS as readonly string[]).includes(name)) {
    const now = parseOkfTrustSignals({ [name]: readFrontmatterPath(note, [name]) }).claimedKeys.includes(name);
    const then = value !== null && parseOkfTrustSignals({ [name]: value }).claimedKeys.includes(name);
    if (now || then) return { class: "trust", path: [name] };
  }
  return { class: "plain", path: [name] };
}

/**
 * Whether a property is one of a note's own AI rules or trust fields, judged
 * by its NAME and by what stands under it — whatever form its value has:
 * everything in Plainva's own namespace, who made a note, who vouches for it
 * and what it rests on, and — where the note uses them as such, now or with
 * this value — its lifecycle `status` and `stale_after`.
 *
 * For a writer that brings whole properties instead of one value (an agent's
 * file, plan P5-6): `propertyTarget` calls a nested value "invalid" before it
 * looks at the name, and a nested value under `plainva` is still a rule.
 */
export function isRuleOrTrustProperty(note: string, key: string, value: unknown): boolean {
  const name = key.trim();
  if (/^plainva(?:$|[.:])/i.test(name) || TRUST_BY_NAME.includes(name.toLowerCase())) return true;
  if (!(OKF_TRUST_KEYS as readonly string[]).includes(name)) return false;
  const claims = (item: unknown) => item !== undefined && item !== null && parseOkfTrustSignals({ [name]: item }).claimedKeys.includes(name);
  return claims(attempt(() => readFrontmatterPath(note, [name]))) || claims(value);
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
  const span = frontmatterSpan(text);
  if (!span) return { map: {}, body: text };
  const doc = parseDocument(span.yaml);
  if (doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents))) return null;
  return { map: (doc.toJS() ?? {}) as Record<string, unknown>, body: text.slice(span.end) };
}

/** Two notes that say the same: the same properties with the same values, the same text. */
function sameNote(a: string, b: string): boolean {
  const left = propertiesOf(a);
  const right = propertiesOf(b);
  return left !== null && right !== null && left.body === right.body && same(left.map, right.map);
}

/**
 * The properties in which two versions of a note differ, by name, each with
 * the value the second version gives it — `null` where it has none there, or
 * an empty one. The names the second version carries come first, in its
 * order; then the ones it dropped. Null where the properties of either
 * cannot be read.
 *
 * Only what the properties SAY counts: another order, other quotes and other
 * spacing are no change. This is how a writer that hands over a whole file
 * (an agent, plan P5-6) is read as what it means: values, one by one.
 */
export function changedProperties(base: string, next: string): { key: string; value: unknown }[] | null {
  const from = propertiesOf(base);
  const to = propertiesOf(next);
  if (!from || !to) return null;
  const had = (key: string) => (Object.prototype.hasOwnProperty.call(from.map, key) ? from.map[key] : undefined);
  const out: { key: string; value: unknown }[] = [];
  for (const [key, value] of Object.entries(to.map)) if (!same(had(key), value)) out.push({ key, value: value ?? null });
  for (const [key, value] of Object.entries(from.map)) {
    if (!Object.prototype.hasOwnProperty.call(to.map, key) && !same(value, undefined)) out.push({ key, value: null });
  }
  return out;
}

/** A property as its lines, the way the properties of a note are written; no line break at the end. */
function entryLines(key: string, value: PropertyValue, eol: string): string {
  return new Document({ [key]: value }).toString().replace(/\r?\n$/, "").replace(/\r?\n/g, eol);
}

/** The change as one block against the note's own lines, or null where the properties are not written entry by entry. */
function entryChange(base: string, key: string, value: PropertyValue | null, eol: string): { intended: string; block: PropertyBlock } | null {
  const span = frontmatterSpan(base);
  if (!span) {
    if (value === null) return null;
    // No properties yet: the whole block is new, at the very top.
    const intended = setFrontmatterPath(base, [key], value);
    if (!intended.endsWith(base)) return null;
    return { intended, block: { from: 0, to: 0, replacement: intended.slice(0, intended.length - base.length) } };
  }
  const { yaml: yamlText, yamlStart, closeAt } = span;
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
  /** The suggestion adds the property: the note had no entry for it. */
  added: boolean;
  /** The value the property had when the suggestion was made; undefined where it had none or its entry cannot be read back. */
  previous: unknown;
  /**
   * How the suggestion is written: the property's `entry` replaced or removed,
   * an entry `insert`ed in front of the line that closes the properties, or a
   * whole properties `block` for a note that had none.
   */
  form: "entry" | "insert" | "block";
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
    // What the anchor quotes is the entry as it stood: its value then, where it still reads as that property's entry.
    const quoted = attempt(() => singleEntry(anchor.quote));
    const previous = quoted && quoted.key === hinted ? quoted.value : undefined;
    if (replacement.trim() === "") return { key: hinted, value: undefined, removed: true, added: false, previous, form: "entry" };
    const entry = singleEntry(replacement);
    return entry && entry.key === hinted ? { key: hinted, value: entry.value, removed: false, added: false, previous, form: "entry" } : null;
  }
  if (anchor.quote !== "") return null;
  if (/^---(?:\r?\n|$)/.test(anchor.after) && (anchor.before === "" || anchor.before.endsWith("\n")) && /\n$/.test(replacement)) {
    const entry = singleEntry(replacement);
    return entry ? { key: entry.key, value: entry.value, removed: false, added: true, previous: undefined, form: "insert" } : null;
  }
  if (anchor.before === "") {
    const block = frontmatterSpan(replacement);
    const entry = block && block.end === replacement.length ? singleEntry(block.yaml) : null;
    return entry ? { key: entry.key, value: entry.value, removed: false, added: true, previous: undefined, form: "block" } : null;
  }
  return null;
}

export type ProposedPropertyPlace =
  | { fits: true; from: number; to: number; replacement: string; property: ProposedProperty }
  /** The suggestion no longer fits the note: its entry is gone or says something else, or the note has the property by now. */
  | { fits: false; property: ProposedProperty };

/**
 * Where a suggestion that proposes a property goes in the note AS IT IS NOW —
 * or null where the suggestion proposes a passage like any other.
 *
 * `found` is where the suggestion's anchor is found by its words
 * (`resolveCommentAnchor`), null where it is not. A passage is applied where
 * its words are; a property is applied where the properties are, and only
 * there:
 *
 * - an entry that is replaced or removed has to be found INSIDE the
 *   properties. The same words further down are another passage: the entry
 *   itself is gone, or says something else by now.
 * - A new property goes in front of the line that closes the properties as
 *   they are now — wherever the place it was proposed at has drifted to —,
 *   and nowhere once the note has that property: a second entry of one name
 *   is no property, and the properties with it are no longer readable.
 * - The first property of a note that had none is the properties block at
 *   the very top — or, where the note has properties by now, one more entry
 *   of them. A second block below the first would be a rule, a line of text
 *   and another rule.
 *
 * Everyone who decides about a suggestion asks this (`planCommentDecision`),
 * and so does every card that shows one, so a card never offers what
 * accepting would refuse.
 */
export function placeProposedProperty(
  note: string,
  anchor: Pick<WorkspaceCommentAnchor, "quote" | "before" | "after" | "display">,
  replacement: string,
  found: { from: number; to: number } | null,
): ProposedPropertyPlace | null {
  const property = proposedPropertyOf(anchor, replacement);
  if (!property) return null;
  const block = frontmatterSpan(note);
  const end = block?.end ?? 0;
  if (property.form === "entry") {
    return found && found.to <= end ? { fits: true, from: found.from, to: found.to, replacement, property } : { fits: false, property };
  }
  // An insertion is read from where it is: found nowhere, it is a passage that is gone, like any other.
  if (!found) return null;
  // In front of three dashes further down, the line is text: three dashes also draw a rule in the middle of a note.
  if (property.form === "insert" && !(found.from > 0 && found.from < end)) return null;
  const place = additionPlace(note, property, replacement);
  return place ? { fits: true, ...place, property } : { fits: false, property };
}

/**
 * Where a NEW property goes in the note as it is now: in front of the line
 * that closes its properties, or — where the note has none — as the
 * properties block at its very top. Null where it cannot be added: the note
 * has a property of that name, or its properties cannot be read.
 */
function additionPlace(note: string, property: ProposedProperty, replacement: string): { from: number; to: number; replacement: string } | null {
  const eol = note.includes("\r\n") ? "\r\n" : "\n";
  const block = frontmatterSpan(note);
  // The entry's own lines, whichever way it was proposed: a whole block carries one entry between its fences.
  const entry = (property.form === "block" ? `${frontmatterSpan(replacement)?.yaml ?? ""}\n` : replacement).replace(/\r?\n/g, eol);
  if (!block) return { from: 0, to: 0, replacement: property.form === "block" ? replacement.replace(/\r?\n/g, eol) : `---${eol}${entry}---${eol}` };
  const now = propertiesOf(note);
  if (!now || Object.prototype.hasOwnProperty.call(now.map, property.key)) return null;
  return { from: block.closeAt, to: block.closeAt, replacement: entry };
}

/**
 * The note with a proposed new property added — where the properties are
 * NOW, without looking for the place it was proposed at again. A decision
 * that accepts several suggestions at once finds each of them in the note as
 * it stood, once; the new properties are then written one after the other,
 * and the words around the place one of them was proposed at may well have
 * changed with the others. Null where it cannot be added (`additionPlace`).
 */
export function addProposedProperty(note: string, property: ProposedProperty, replacement: string): string | null {
  if (!property.added) return null;
  const place = additionPlace(note, property, replacement);
  return place ? note.slice(0, place.from) + place.replacement + note.slice(place.to) : null;
}
