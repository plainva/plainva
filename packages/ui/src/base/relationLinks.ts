import {
  wikiLinkParts,
  readFrontmatterPath,
  upsertFrontmatterKeys,
  noteLinkResolver,
  updateVaultText,
  wikiTargetForPath,
  type TextUpdateFiles,
  type VaultQueryService,
} from "@plainva/core";
import i18n from "i18next";
import { errorText } from "../lib/errorText";
import { parseBaseConfig } from "./baseFormat";
import { parseWikiLinkValue } from "./propertyModel";
import { removeRelationLinksToNoteShared } from "./relationCleanup";

/**
 * Owning-side relation writes (Gesamtplan Base-Relationen, P6): add/remove a
 * wiki link in a note's relation property, surgically (untouched frontmatter
 * keys keep their formatting, the body stays byte-identical). Matching is
 * resolution-based so bare, qualified, aliased and anchored raw forms of the
 * same target all count as "linked".
 *
 * Caller contract: after a successful write, trigger `indexer.indexFile(...)`
 * for the touched note (the Editor save pattern) so reverse lookups refresh.
 */

/**
 * The note's files: the vault's chain, or a storage with nothing above it. A
 * note is read, changed and written in one step (`updateVaultText`).
 */
export type RelationWriteAdapter = TextUpdateFiles;

const WIKILINK_VALUE_RE = /^\s*\[\[([^[\]]+)\]\]\s*$/;

/** Anchor-/alias-free base of a whole-value wiki link, or null for non-links. */
function linkBaseOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = WIKILINK_VALUE_RE.exec(value);
  if (!m) return null;
  let inner = m[1];
  // In front of the alias bar and of the backslash of `\|` (Sammelplan § 3.133 Nr. 1).
  inner = inner.slice(0, wikiLinkParts(inner).headEnd);
  const anchor = inner.search(/[#^]/);
  if (anchor !== -1) inner = inner.slice(0, anchor);
  const base = inner.trim();
  return base || null;
}

/**
 * What the note holds under `key`, as a list — read with the reader of the
 * writer that will set the key (finding 2026-10-12).
 *
 * The values used to come from the reader of the index, whose schema rejected a
 * proper YAML map with a value it did not take (an empty `tags:`, a year
 * among the tags; until 2026-10-22, ADR 0009). "Could not be read" passed for
 * "holds no link", and adding ONE link replaced the list the note carried. A
 * block the writer itself cannot read answers no values here, and the write
 * then refuses the note.
 */
function currentValues(content: string, key: string): unknown[] {
  const value = readFrontmatterPath(content, [key]);
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

async function linkRule(queryService: VaultQueryService): Promise<{ allFilePaths: string[]; linkedNote: LinkedNote }> {
  // Which spelling a link is written in, and which values lead to a note, is read from the index: never over half of one (performance plan L3).
  queryService.requireWholeIndex?.();
  // The link rule's corpus: what a stored value leads to is asked of every
  // file, what a new link is called of the notes alone.
  const files = await queryService.linkTargets();
  const allFilePaths = files.filter((f) => f.mode !== "attachment").map((f) => f.path);
  return { allFilePaths, linkedNote: noteLinkResolver(files) };
}

type LinkedNote = ReturnType<typeof noteLinkResolver>;

function resolvesToTarget(value: unknown, notePath: string, targetNotePath: string, linkedNote: LinkedNote): boolean {
  const base = linkBaseOf(value);
  return base != null && linkedNote(notePath, base) === targetNotePath;
}

/**
 * Adds a wiki link to `propertyKey` in `notePath`'s frontmatter. `limit: "one"`
 * REPLACES the value with a scalar link (Notion "steal" semantics); otherwise
 * the link is appended to a list (scalar legacy values are promoted to lists).
 * No-op when a stored link already resolves to `targetNotePath`. The link text
 * is collision-safe via wikiTargetForPath.
 */
export async function addRelationLink(opts: {
  adapter: RelationWriteAdapter;
  queryService: VaultQueryService;
  notePath: string;
  propertyKey: string;
  targetNotePath: string;
  limit?: "one";
}): Promise<{ changed: boolean }> {
  const { adapter, queryService, notePath, propertyKey, targetNotePath, limit } = opts;
  // What a link leads to and what a new one is called is asked first: the
  // change itself runs on the note's text alone, as it lies there when it is
  // written.
  const { allFilePaths, linkedNote } = await linkRule(queryService);
  const linkText = `[[${wikiTargetForPath(targetNotePath, allFilePaths)}]]`;

  const linked = (content: string): string | null => {
    const values = currentValues(content, propertyKey);
    if (limit === "one") {
      const already =
        values.length === 1 && resolvesToTarget(values[0], notePath, targetNotePath, linkedNote);
      return already ? null : upsertFrontmatterKeys(content, { [propertyKey]: linkText });
    }
    if (values.some((v) => resolvesToTarget(v, notePath, targetNotePath, linkedNote))) return null;
    return upsertFrontmatterKeys(content, { [propertyKey]: [...values, linkText] });
  };
  const update = await updateVaultText(adapter, notePath, linked);
  return { changed: linked(update.before) !== null };
}

/**
 * Removes every link in `propertyKey` that RESOLVES to `targetNotePath`
 * (robust against bare vs qualified raw forms, aliases, anchors). Deletes the
 * key when the value empties; list values stay lists otherwise. The actual
 * transformation lives in the shared relationCleanup kernel (`@plainva/ui`) so
 * the mobile cascade deletion runs the identical cleanup.
 */
export async function removeRelationLinksToNote(opts: {
  adapter: RelationWriteAdapter;
  queryService: VaultQueryService;
  notePath: string;
  propertyKey: string;
  targetNotePath: string;
}): Promise<{ changed: boolean; removed: number }> {
  const { adapter, queryService, notePath, propertyKey, targetNotePath } = opts;
  return removeRelationLinksToNoteShared(
    {
      readTextFile: (p) => adapter.readTextFile(p),
      writeTextFile: (p, c) => adapter.writeTextFile(p, c),
      updateTextFile: (p, change) => updateVaultText(adapter, p, change),
      listLinkTargets: () => queryService.linkTargets(),
    },
    { notePath, propertyKey, targetNotePath }
  );
}

/** The note a cell's value names: the target of a whole-value wiki link, or the value itself. */
function cellLinkTarget(value: string): string {
  return parseWikiLinkValue(value)?.target ?? value.replace(/^\[\[/, "").replace(/\]\]$/, "");
}

/** What an edit of a reverse relation's cell did (`editReverseRelation`). */
export interface ReverseRelationOutcome {
  /** The other notes that were written, each with what happened there. */
  changed: Map<string, "added" | "removed">;
  /** How many of the other notes could not be written. */
  failures: number;
  /** The reason of the first of them, for the message of a single one. */
  firstFailure: unknown;
  /** What the cell holds now: a link that could not be given is not in it, one that could not be taken out stays. */
  shown: string[];
  /** The owning side's cardinality, read from its database. */
  owningLimit?: "one";
}

/**
 * An edit of the cell of a reverse relation (Sammelplan § 3.71 no. 3): the
 * links back to `rowPath` live in the OTHER notes' owning property, so a link
 * added here is written there, and a link taken out is removed there — each
 * other note a write of its own. One that fails is counted, and the cell goes
 * on showing what that note holds. Both shells edit such a cell through this.
 *
 * Added links are found by their target; removals are found by what they
 * resolve to (`removeRelationLinksToNote`). The row's own note is never linked
 * to itself.
 */
export async function editReverseRelation(opts: {
  adapter: RelationWriteAdapter;
  queryService: VaultQueryService;
  /** The note whose reverse cell is edited. */
  rowPath: string;
  /** Where the links live: the reverse column's `reverseOf`. */
  owning: { base?: string; property: string };
  /** What the cell showed, and what it is to hold. */
  current: readonly string[];
  next: readonly string[];
}): Promise<ReverseRelationOutcome> {
  const { adapter, queryService, rowPath, owning, current, next } = opts;
  const keyOf = (value: string) => cellLinkTarget(value).toLowerCase();
  const currentByKey = new Map(current.map((v) => [keyOf(v), v]));
  const nextByKey = new Map(next.map((v) => [keyOf(v), v]));
  const added = [...nextByKey.entries()].filter(([k]) => !currentByKey.has(k));
  const removed = [...currentByKey.entries()].filter(([k]) => !nextByKey.has(k));
  const outcome: ReverseRelationOutcome = { changed: new Map(), failures: 0, firstFailure: null, shown: [...next] };
  if (added.length === 0 && removed.length === 0) return outcome;

  // The owning side's cardinality comes from its database's schema.
  try {
    const cfg = owning.base ? parseBaseConfig(await adapter.readTextFile(owning.base)) : null;
    if (cfg?.columns?.[owning.property]?.relationLimit === "one") outcome.owningLimit = "one";
  } catch {
    /* an unreadable database: no limit */
  }

  const notAdded = new Set<string>();
  const notRemoved = new Set<string>();
  const failed = (key: string, into: Set<string>, e: unknown) => {
    into.add(key);
    outcome.failures += 1;
    if (outcome.firstFailure === null) outcome.firstFailure = e;
  };
  for (const [key, value] of added) {
    try {
      const notePath = await queryService.resolveNotePath(cellLinkTarget(value), rowPath);
      if (!notePath || notePath === rowPath) continue;
      await addRelationLink({ adapter, queryService, notePath, propertyKey: owning.property, targetNotePath: rowPath, limit: outcome.owningLimit });
      outcome.changed.set(notePath, "added");
    } catch (e) {
      failed(key, notAdded, e);
    }
  }
  for (const [key, value] of removed) {
    try {
      const notePath = await queryService.resolveNotePath(cellLinkTarget(value), rowPath);
      if (!notePath) continue;
      await removeRelationLinksToNote({ adapter, queryService, notePath, propertyKey: owning.property, targetNotePath: rowPath });
      outcome.changed.set(notePath, "removed");
    } catch (e) {
      failed(key, notRemoved, e);
    }
  }
  if (outcome.failures > 0) {
    outcome.shown = [...next.filter((v) => !notAdded.has(keyOf(v))), ...current.filter((v) => notRemoved.has(keyOf(v)))];
  }
  return outcome;
}

/**
 * What both shells say after such an edit: the reason of a single note that
 * refused, or one count of the notes written and the notes that failed.
 */
export function sayReverseRelationOutcome(outcome: ReverseRelationOutcome, say: { error(message: string): void }): void {
  if (outcome.failures === 1) say.error(i18n.t("mobile.propertyWriteFailed", { message: errorText(outcome.firstFailure) }));
  else if (outcome.failures > 1) say.error(i18n.t("database.bulkSetPartial", { done: outcome.changed.size, failed: outcome.failures }));
}
