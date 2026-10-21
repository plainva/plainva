import { deleteFrontmatterPath, frontmatterKeys, FrontmatterSurgicalError, renameFrontmatterKey, updateVaultText } from "@plainva/core";
import i18n from "i18next";
import { errorText } from "../lib/errorText";
import { noteDisplayName } from "../lib/noteTitle";
import { isPropertyColumn } from "./computedFields";
import { stripPropertyFilters } from "./filterExpr";
import { resolvePropertyWriteKey } from "./propertyModel";
import type { PropertyWriteAdapter } from "./writeProperty";

/**
 * One change to the TEXT of many notes: a property renamed across the notes of
 * a database, a property removed from them.
 *
 * `rewriteNoteProperties` is the loop for a change to a note's whole set of
 * properties; this is the one for the surgical helpers of `@plainva/core`,
 * which touch a single key and leave the rest of the block as it stands. Both
 * shells ran a loop of their own here (finding 2026-10-09): the desktop logged
 * each note it could not write to the console and then showed every row as
 * changed, the phone swallowed the error. So this goes on past a note it
 * cannot write and answers which ones those were, and both shells say one
 * count.
 */

export interface NoteRewriteFailure {
  path: string;
  message: string;
}

export interface NoteRewriteResult {
  /** Paths that were written. */
  written: string[];
  /** Paths the change left as they are: the note holds nothing it applies to. */
  unchanged: string[];
  /** Paths that failed, with the reason, in the order they failed. */
  failed: NoteRewriteFailure[];
}

export interface NoteRewriteOptions {
  /** Called after each note, written or not. */
  onProgress?: (done: number, total: number) => void;
}

const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Where the notes of a database are asked for: the index (`VaultQueryService`). */
export interface DatabaseNoteQuery {
  queryDatabaseFiles(config: any): Promise<Record<string, unknown>[]>;
}

/**
 * The notes a property is renamed in or removed from: every note of the
 * database's sources that carries it, as the index lists it — the one answer
 * of both shells.
 *
 * Not the rows of the view on screen: its filters may hide notes, and a note
 * left behind keeps the old key under a column that no longer exists (the
 * phone took the view's rows, finding 2026-10-21). And not a note that does
 * not carry the property: a rename asks every note it is handed first, and a
 * note whose block cannot be read would stop a rename it has nothing to do
 * with. Where the index cannot be asked, the rows on screen stand in.
 *
 * A computed column — the links back of a relation, a rollup over one — is
 * stored in no note, and goes through none: the index fills it on every row.
 */
export async function notesCarryingProperty(
  queryService: DatabaseNoteQuery | null | undefined,
  config: unknown,
  name: string,
  shown: readonly Record<string, unknown>[] = []
): Promise<string[]> {
  const columns = (config as { columns?: unknown } | null | undefined)?.columns;
  const schema = columns && typeof columns === "object" && !Array.isArray(columns) ? (columns as Record<string, any>)[name] : undefined;
  if (!isPropertyColumn(name, schema)) return [];
  let rows: readonly Record<string, unknown>[] = shown;
  if (queryService) {
    try {
      rows = await queryService.queryDatabaseFiles(stripPropertyFilters(config));
    } catch (e) {
      console.warn("[noteRewrite] the database's source query failed — using the rows on screen", e);
    }
  }
  // By the key in any casing: the index brings a column of the schema onto
  // its own spelling, a column a view merely names it leaves as the note
  // spells it (`Prio` for `prio`).
  const lower = name.toLowerCase();
  return rows.flatMap((row) => {
    const path = row["file.path"];
    if (typeof path !== "string" || path === "") return [];
    return Object.keys(row).some((key) => key.toLowerCase() === lower && row[key] !== undefined) ? [path] : [];
  });
}

/**
 * One note after the other, as the loops it replaces ran. Each note is changed
 * as it lies there when it is written (`updateVaultText`); where it has an
 * open conflict, the user's own version takes the change as well.
 */
export async function rewriteNoteTexts(
  adapter: PropertyWriteAdapter,
  paths: readonly string[],
  change: (text: string) => string,
  options: NoteRewriteOptions = {}
): Promise<NoteRewriteResult> {
  const result: NoteRewriteResult = { written: [], unchanged: [], failed: [] };
  let done = 0;
  for (const path of paths) {
    try {
      const update = await updateVaultText(adapter, path, (text) => {
        const next = change(text);
        return next === text ? null : next;
      });
      // Whether the note was one to change is read from the note as it was changed.
      if (change(update.before) === update.before) result.unchanged.push(path);
      else result.written.push(path);
    } catch (e) {
      result.failed.push({ path, message: reasonOf(e) });
    }
    done += 1;
    options.onProgress?.(done, paths.length);
  }
  return result;
}

/**
 * The key a note carries a property under: the column's own spelling, else
 * one that differs from it only in casing — the rule of a single write
 * (`resolvePropertyWriteKey`). The index lists a note with `Prio:` under the column
 * `prio`, and a rename in the column's spelling found nothing to rename there:
 * the note kept the old key under a column that no longer exists, counted as
 * unchanged (finding 2026-10-21).
 */
function storedKeyIn(keys: readonly string[], name: string): string {
  return resolvePropertyWriteKey(Object.fromEntries(keys.map((key) => [key, true])), name);
}

/**
 * The notes a change would be refused for, asked without writing any of them:
 * the check in front of a change that must not be left half done. The same
 * function answers the check and makes the change, so the two cannot disagree
 * on what a note takes.
 *
 * A note that cannot be read right now is not one that refuses: it is gone
 * (the index is behind) or held by something else, and neither is settled by
 * correcting the note. The change itself counts it as failed if it still
 * cannot be read then.
 */
export async function refusedNoteRewrites(
  adapter: PropertyWriteAdapter,
  paths: readonly string[],
  change: (text: string) => string
): Promise<NoteRewriteFailure[]> {
  const refused: NoteRewriteFailure[] = [];
  for (const path of paths) {
    let text: string;
    try {
      text = await adapter.readTextFile(path);
    } catch {
      continue;
    }
    try {
      change(text);
    } catch (e) {
      refused.push({ path, message: reasonOf(e) });
    }
  }
  return refused;
}

export type RenamePropertyOutcome =
  /** A note cannot take the new name. Nothing was asked and nothing was written, the database included. */
  | { status: "refused"; refused: NoteRewriteFailure[] }
  /** The question in front of the first write was answered with no. */
  | { status: "cancelled" }
  /** The database carries the new name; `result` says which notes follow it. */
  | { status: "renamed"; result: NoteRewriteResult };

/**
 * A property renamed across the notes of a database — checked first.
 *
 * The database is renamed before its notes, and it has to be: the notes are
 * written one after the other, and a database that still named the old key
 * would lose the column while they are under way. So a note that cannot follow
 * used to be left behind with the old key, under a column that no longer
 * exists — and where it already carried a property of the new name, the
 * column went on to show THAT value for it. Nothing on screen told the two
 * apart.
 *
 * A rename is a move, and half a move is a state nobody asked for. So every
 * note is asked first, with the very function that will rename it, and where
 * one refuses — a properties block that is no YAML map, YAML that cannot be
 * read, a property of the new name already there — nothing starts: not the
 * question, not the database, not a single note. The caller names the notes.
 *
 * What no check can rule out is a write that fails while the rename runs (a
 * file another program holds, a membership that may not write): those notes
 * are counted in `result.failed`, and the caller says the count.
 *
 * Removing a property (`removePropertyAcrossNotes`) does not check first. What
 * it leaves behind in a note it could not write is a key the database no
 * longer shows — the state the person asked for, less tidy — and refusing to
 * drop a column over it would help nobody.
 */
export async function renamePropertyAcrossNotes(opts: {
  adapter: PropertyWriteAdapter;
  paths: readonly string[];
  oldName: string;
  newName: string;
  /** The question in front of the first write; asked only once every note has passed the check. */
  confirm?: () => Promise<boolean>;
  /** Writes the database under the new name: after the check, before the first note. */
  saveConfig: () => Promise<void>;
  onProgress?: (done: number, total: number) => void;
}): Promise<RenamePropertyOutcome> {
  const { adapter, paths, oldName, newName } = opts;
  const rename = (text: string) => {
    const keys = frontmatterKeys(text);
    const key = storedKeyIn(keys, oldName);
    // A note that carries the property in the new spelling already (a rename
    // that only changes the casing) has nothing to move.
    if (key === newName) return text;
    // Nor may the new name stand there in another casing: the index reads the
    // keys without regard to case, and of the two a column would show one.
    const taken = keys.find((other) => other !== key && other !== newName && other.toLowerCase() === newName.toLowerCase());
    if (taken !== undefined && keys.includes(key)) throw new FrontmatterSurgicalError(`Cannot rename '${key}' to '${taken}': target key already exists`);
    return renameFrontmatterKey(text, key, newName);
  };
  const refused = await refusedNoteRewrites(adapter, paths, rename);
  if (refused.length > 0) return { status: "refused", refused };
  if (opts.confirm && !(await opts.confirm())) return { status: "cancelled" };
  await opts.saveConfig();
  return { status: "renamed", result: await rewriteNoteTexts(adapter, paths, rename, { onProgress: opts.onProgress }) };
}

/** A property removed from the notes of a database; see `renamePropertyAcrossNotes` for why this one does not check first. */
export function removePropertyAcrossNotes(
  adapter: PropertyWriteAdapter,
  paths: readonly string[],
  name: string,
  options: NoteRewriteOptions = {}
): Promise<NoteRewriteResult> {
  return rewriteNoteTexts(adapter, paths, (text) => deleteFrontmatterPath(text, [storedKeyIn(frontmatterKeys(text), name)]), options);
}

/** How many notes a refusal names before it says "…". */
const NAMED_NOTES = 3;

/**
 * The sentence for a rename that did not start: how many notes stand in its
 * way, the first of them by name, and why the first one does. The reason goes
 * through `errorText`, so it carries nothing of a note's text.
 */
export function renameRefusedText(oldName: string, refused: readonly NoteRewriteFailure[]): string {
  const names = refused.slice(0, NAMED_NOTES).map((r) => noteDisplayName(r.path));
  if (refused.length > NAMED_NOTES) names.push("…");
  return i18n.t("database.renamePropertyRefused", {
    old: oldName,
    count: refused.length,
    notes: names.join(", "),
    reason: errorText(refused[0]?.message ?? ""),
  });
}
