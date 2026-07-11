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

const cache = new Map<string, GoverningBase | null>();

/** Drop cached resolutions (call after a `.base` is edited so the panel re-resolves). */
export function clearGoverningBaseCache(): void {
  cache.clear();
}

/**
 * Resolve which `.base` governs `notePath` and return its column schema, or null.
 * Cached per note path (cleared via clearGoverningBaseCache on base edits).
 */
export async function resolveGoverningBase(
  notePath: string,
  queryService: MinimalQueryService | null | undefined,
  vaultAdapter: MinimalAdapter | null | undefined,
): Promise<GoverningBase | null> {
  if (!notePath || !queryService || !vaultAdapter) return null;
  if (cache.has(notePath)) return cache.get(notePath) ?? null;

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
    result = null;
  }

  cache.set(notePath, result);
  return result;
}
