import { parseBaseConfig } from "./baseFormat";
import { stripPropertyFilters } from "./filterExpr";
import { noteDisplayName } from "../lib/noteTitle";

/**
 * Which notes belong to which `.base`, and how the bases relate to each other.
 *
 * Extracted from `deletionPlan.ts` (2026-07-25) because the note's database
 * context (plan P4) needs exactly the same answers: membership is the data
 * source WITHOUT the per-view filters — a note is a member of the database, not
 * of one of its views — and the relation/reverse columns are what tie two
 * databases together. Sharing the implementation keeps the two features from
 * drifting into two different notions of "belongs to".
 */

export interface IncomingRelationRef {
  path: string;
  title: string;
  propertyKey: string;
}

export interface BaseDataDeps {
  /** Incoming frontmatter-property links for the given targets (any key). */
  getIncomingRelationRefs(targetPaths: string[]): Promise<Map<string, IncomingRelationRef[]>>;
  /** Resolved outgoing targets of one property on one note (link index order). */
  getOutgoingRelationTargets(sourcePath: string, propertyKey: string): Promise<string[]>;
  /** Membership query (the shells pass VaultQueryService.queryDatabaseFiles). */
  queryDatabaseFiles(config: unknown): Promise<Array<{ path: string; title?: string | null }>>;
  listBaseFilePaths(): Promise<string[]>;
  readTextFile(path: string): Promise<string>;
}

export interface BaseInfo {
  path: string;
  label: string;
  config: unknown;
  /** Every declared column key (typed or not) — used to group candidates. */
  columnKeys: Set<string>;
  /** Owning relation columns: key + raw relationBase reference (may be bare). */
  relations: { key: string; relationBase: string | null }[];
  /** Raw base references my computed reverse columns point at. */
  reverseTargets: string[];
  /**
   * Per-view "sub-items" property, i.e. the owning column of the SELF relation
   * that builds the parent/child tree. First view that declares one wins — the
   * hierarchy is a property of the database, not of a view.
   */
  subItemsProperty: string | null;
  /** View names in file order (for "belongs to X, view Y"). */
  viewNames: string[];
}

export function normBasePath(p: unknown): string {
  return String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isBasePath(path: string): boolean {
  return /\.base$/i.test(path);
}

export function baseLabelOf(path: string): string {
  return (path.split(/[/\\]/).pop() ?? path).replace(/\.base$/i, "");
}

export async function loadBaseInfos(deps: BaseDataDeps): Promise<BaseInfo[]> {
  const out: BaseInfo[] = [];
  for (const path of await deps.listBaseFilePaths()) {
    try {
      const config: any = parseBaseConfig(await deps.readTextFile(path));
      const columns: Record<string, any> = config?.columns ?? {};
      const relations: BaseInfo["relations"] = [];
      const reverseTargets: string[] = [];
      for (const [key, col] of Object.entries(columns)) {
        if (!col || typeof col !== "object") continue;
        if (col.input === "relation" || col.relationBase) {
          relations.push({ key, relationBase: typeof col.relationBase === "string" ? col.relationBase : null });
        }
        if (col.reverseOf && typeof col.reverseOf.base === "string") {
          reverseTargets.push(col.reverseOf.base);
        }
      }
      const views: any[] = Array.isArray(config?.views) ? config.views : [];
      const subItemsProperty =
        views.map((v) => (typeof v?.subItemsProperty === "string" ? v.subItemsProperty : "")).find(Boolean) || null;
      out.push({
        path: normBasePath(path),
        label: baseLabelOf(path),
        config,
        columnKeys: new Set(Object.keys(columns)),
        relations,
        reverseTargets,
        subItemsProperty,
        viewNames: views.map((v) => String(v?.name ?? "")).filter(Boolean),
      });
    } catch {
      /* unparseable base: it cannot contribute anything */
    }
  }
  return out;
}

/** Resolves a raw base reference (bare name or path) against the loaded bases. */
export function baseByRef(bases: BaseInfo[], ref: string | null): BaseInfo | null {
  if (!ref) return null;
  const norm = normBasePath(ref).toLowerCase();
  const bare = norm.replace(/\.base$/i, "");
  for (const b of bases) {
    const p = b.path.toLowerCase();
    if (p === norm || p === `${norm}.base`) return b;
    if (b.label.toLowerCase() === bare && !bare.includes("/")) return b;
  }
  return null;
}

export interface BaseMembers {
  set: Set<string>;
  rows: Array<{ path: string; title: string }>;
}

/**
 * Cached membership lookup. Deliberately strips the per-view property filters:
 * a note belongs to the DATABASE, not to whichever view happens to show it —
 * the same rule the cascade deletion uses.
 */
export function createMemberLookup(deps: BaseDataDeps): (base: BaseInfo) => Promise<BaseMembers> {
  const cache = new Map<string, BaseMembers>();
  return async (base: BaseInfo) => {
    const cached = cache.get(base.path);
    if (cached) return cached;
    let rows: Array<{ path: string; title: string }>;
    try {
      rows = (await deps.queryDatabaseFiles(stripPropertyFilters(base.config))).map((r) => ({
        path: normBasePath(r.path),
        title: (r.title ?? "") || noteDisplayName(String(r.path)),
      }));
    } catch {
      rows = [];
    }
    const entry: BaseMembers = { set: new Set(rows.map((r) => r.path)), rows };
    cache.set(base.path, entry);
    return entry;
  };
}
