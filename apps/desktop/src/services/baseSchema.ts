/**
 * Governing-`.base` resolution for the Properties panel (ADR 0008, TS-2).
 *
 * An Obsidian `.base` is a query/view, not a container — a note isn't "in" a base,
 * a base *matches* it. To find the base that governs a note we take every `.base`
 * whose folder is an ancestor of the note, run its query (reusing the tested
 * VaultQueryService.queryDatabaseFiles), and pick the most specific (deepest folder)
 * whose result set contains the note. Its `columns` schema then drives select/status/
 * relation rendering. This module is READ-ONLY — it never writes to a `.base`
 * (authoring stays in the BaseViewer's saveConfig path).
 */

import type { CuratedOption } from "@plainva/ui";
import type { RollupSpec } from "@plainva/core";
import { parseBaseConfig } from "@plainva/ui";

export interface ReverseRelationDef {
  /** Vault-relative path of the counterpart `.base` holding the owning relation. */
  base: string;
  /** Bare frontmatter key of the owning relation property in counterpart notes. */
  property: string;
}

export interface ColumnSchema {
  input?: string;
  options?: CuratedOption[];
  /** Relation: path to the target `.base` whose notes are the relation candidates. */
  relationBase?: string;
  /** Relation cardinality: "one" = single link (scalar value); absent = unlimited. */
  relationLimit?: "one";
  /** Computed reverse-relation column: values come from counterpart notes' `property`. */
  reverseOf?: ReverseRelationDef;
  /** Rollup: value aggregated from the notes a link column points at (never stored). */
  rollup?: RollupSpec;
  /** Rating: how many marks (1-10, default 5) and what a mark looks like (one character, default a dot). */
  ratingMax?: number;
  ratingGlyph?: string;
  /**
   * Former bare names of this column, oldest first (plan Stufe E, section 5).
   * Written by `renamePropertyInConfig`, read by `propertyAliasResolver` so a
   * comment anchored to a property survives the column being renamed.
   */
  previousKeys?: string[];
}

export interface GoverningBase {
  basePath: string;
  columns: Record<string, ColumnSchema>;
}

/** Directory portion of a path ("a/b/c.md" -> "a/b"; "c.md" -> ""). */
export function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** True if `dir` (a folder) is an ancestor of `notePath` (or the vault root ""). */
export function isAncestorDir(dir: string, notePath: string): boolean {
  if (dir === "") return true;
  return notePath.startsWith(dir + "/");
}

/**
 * Candidate `.base` paths that could govern `notePath`, most-specific first
 * (deepest containing folder). Pure — unit-tested.
 */
export function rankCandidateBases(basePaths: string[], notePath: string): string[] {
  return basePaths
    .filter((b) => b !== notePath && isAncestorDir(dirOf(b), notePath))
    .sort((a, b) => dirOf(b).length - dirOf(a).length || a.localeCompare(b));
}

type MinimalQueryService = {
  db: { query: (sql: string, params?: any[]) => Promise<any[]> };
  queryDatabaseFiles: (config: any) => Promise<any[]>;
};
type MinimalAdapter = { readTextFile: (path: string) => Promise<string> };

/**
 * Two things are kept per note, and they are not the same thing (finding
 * 2026-10-06):
 *
 *  - whether the answer is CURRENT — it is until the index moves, because a
 *    `.base` may have been edited or the note may have left the query;
 *  - what the answer WAS — which stays true enough to draw with until the new
 *    one has arrived.
 *
 * There used to be one map that was emptied on every index update. A reader
 * that asked in between got nothing, and the properties panel drew "no
 * database" for a moment on every save and every sync cycle.
 */
const cache = new Map<string, { epoch: number; value: GoverningBase | null }>();
let epoch = 0;

/**
 * The last known answer per note. Read by the properties panel so a row keeps
 * its rendering while a new lookup runs, and so a note that is opened again is
 * drawn right on its first frame.
 */
export const governingBaseMemory = new Map<string, GoverningBase | null>();

/**
 * The index moved: answers have to be looked up again. What was known stays
 * known (`governingBaseMemory`) until the lookup replaces it.
 */
export function clearGoverningBaseCache(): void {
  epoch += 1;
}

/** Another vault: nothing that was known applies. */
export function forgetGoverningBases(): void {
  epoch += 1;
  cache.clear();
  governingBaseMemory.clear();
}

let knownVault: string | null = null;
/**
 * Says which vault the answers are for. The maps are keyed by note path, and a
 * path means something else in another vault — so the first reader after a
 * vault switch empties them. Calling it again for the same vault does nothing.
 */
export function governingBasesBelongTo(vault: string): void {
  if (knownVault !== null && knownVault !== vault) forgetGoverningBases();
  knownVault = vault;
}

/**
 * Resolve which `.base` governs `notePath` and return its column schema, or null.
 * Cached per note path until the index moves (`clearGoverningBaseCache`).
 */
export async function resolveGoverningBase(
  notePath: string,
  queryService: MinimalQueryService | null | undefined,
  vaultAdapter: MinimalAdapter | null | undefined,
): Promise<GoverningBase | null> {
  if (!notePath || !queryService || !vaultAdapter) return null;
  const hit = cache.get(notePath);
  if (hit && hit.epoch === epoch) return hit.value;
  const asked = epoch;

  let result: GoverningBase | null = null;
  try {
    const rows = await queryService.db.query("SELECT path FROM files WHERE path LIKE '%.base'");
    const basePaths = rows.map((r: any) => String(r.path ?? r.PATH ?? "")).filter(Boolean);
    for (const basePath of rankCandidateBases(basePaths, notePath)) {
      try {
        const text = await vaultAdapter.readTextFile(basePath);
        const config = parseBaseConfig(text);
        const columns = config.columns;
        if (!columns || Object.keys(columns).length === 0) continue;
        const data = await queryService.queryDatabaseFiles(config);
        const member = data.some((d: any) => d["file.path"] === notePath || d.path === notePath);
        if (member) {
          result = { basePath, columns };
          break;
        }
      } catch {
        /* unreadable/invalid base — skip */
      }
    }
  } catch {
    // The index could not be asked. That is not "no database": what was known
    // stays, and the next caller asks again.
    return governingBaseMemory.get(notePath) ?? null;
  }

  cache.set(notePath, { epoch: asked, value: result });
  governingBaseMemory.set(notePath, result);
  return result;
}
