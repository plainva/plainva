import { parseBaseConfig } from "./baseFormat";
import { stripPropertyFilters } from "./filterExpr";
import { noteDisplayName } from "../lib/noteTitle";

/**
 * Cascade-deletion plan (plan Kaskadenloeschung 2026-07-19): one precomputed
 * "deletion plan" feeds ONE dialog that shows what hangs off a delete —
 * elements assigned via relations (recursively, across bases), the rows of a
 * deleted `.base`, and linked databases with their own two-step card.
 *
 * Semantics (maintainer-approved):
 *  - "Assigned" = an incoming FRONTMATTER property link (`links.property_key`);
 *    body links never count and are never touched.
 *  - The cascade walks incoming property links level by level (cycle-safe,
 *    across database boundaries). Depth 1 = directly assigned, >1 = sub-element.
 *  - "Shared" elements — the SAME property also points at a target that is NOT
 *    part of the deletion — are excluded by default (badge in the dialog).
 *  - Base membership = the data source without per-view filters
 *    (`stripPropertyFilters`); rows that are also members of ANOTHER base are
 *    excluded by default.
 *  - Linked databases (relation columns targeting a deleted base, or reverse
 *    columns of it) get their own named card with two steps: assigned elements
 *    only, or the whole database (file + every member). Both default OFF.
 *
 * Everything here is pure/injected (DeletionPlanDeps) so desktop and mobile
 * share one implementation and the unit suite runs on fake deps.
 */

export interface IncomingRelationRef {
  path: string;
  title: string;
  propertyKey: string;
}

export interface DeletionPlanDeps {
  /** Incoming frontmatter-property links for the given targets (any key). */
  getIncomingRelationRefs(targetPaths: string[]): Promise<Map<string, IncomingRelationRef[]>>;
  /** Resolved outgoing targets of one property on one note (link index order). */
  getOutgoingRelationTargets(sourcePath: string, propertyKey: string): Promise<string[]>;
  /** Membership query (the shells pass VaultQueryService.queryDatabaseFiles). */
  queryDatabaseFiles(config: unknown): Promise<Array<{ path: string; title?: string | null }>>;
  listBaseFilePaths(): Promise<string[]>;
  readTextFile(path: string): Promise<string>;
}

export interface CascadeElement {
  path: string;
  title: string;
  /** BFS depth: 1 = directly assigned to a primary target, >1 = sub-element. */
  depth: number;
  /** Property key through which the element entered the cascade. */
  viaKey: string;
  /** Display names of surviving targets the same key still points at ("shared"). */
  sharedWith: string[];
  /** Labels of OTHER bases this row also belongs to (base-deletion case). */
  alsoMemberOf: string[];
}

export type CascadeGroupKind = "assigned" | "dbItems" | "linkedAssigned" | "linkedAll";

export interface CascadeGroup {
  kind: CascadeGroupKind;
  /** Base file path the group belongs to ("" for the generic assigned group). */
  basePath: string;
  /** Display label of that base (file stem; "" for the generic group). */
  baseLabel: string;
  items: CascadeElement[];
  /** linkedAssigned/linkedAll: total member count of the linked base. */
  baseTotal?: number;
  /** linkedAll only: the linked `.base` file itself (deleted with the group). */
  linkedBaseFile?: string;
  defaultChecked: boolean;
}

export interface IncomingEdge {
  source: string;
  target: string;
  propertyKey: string;
}

export interface DeletionPlan {
  primary: { path: string; title: string; kind: "note" | "base" }[];
  groups: CascadeGroup[];
  /** Every incoming property-link edge seen while planning — reference cleanup
   * derives from it AFTER the user's selection is known. */
  incomingEdges: IncomingEdge[];
  /** `.base` files among the primary targets (silent tidy-ups hook on these). */
  affectedBases: string[];
}

export interface CascadeSelection {
  /** groupId -> checked. Missing entries fall back to the group default. */
  groups: Record<string, boolean>;
  /** Per-element opt-out (starts with shared/multi-membership elements). */
  excluded: Set<string>;
  cleanupRefs: boolean;
}

function normPath(p: unknown): string {
  return String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

export function isBasePath(path: string): boolean {
  return /\.base$/i.test(path);
}

function baseLabelOf(path: string): string {
  return (path.split(/[/\\]/).pop() ?? path).replace(/\.base$/i, "");
}

interface BaseInfo {
  path: string;
  label: string;
  config: unknown;
  /** Every declared column key (typed or not) — used to group candidates. */
  columnKeys: Set<string>;
  /** Owning relation columns: key + raw relationBase reference (may be bare). */
  relations: { key: string; relationBase: string | null }[];
  /** Raw base references my computed reverse columns point at. */
  reverseTargets: string[];
}

async function loadBaseInfos(deps: DeletionPlanDeps): Promise<BaseInfo[]> {
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
      out.push({ path: normPath(path), label: baseLabelOf(path), config, columnKeys: new Set(Object.keys(columns)), relations, reverseTargets });
    } catch {
      /* unparseable base: it cannot contribute groups */
    }
  }
  return out;
}

/** Resolves a raw base reference (bare name or path) against the loaded bases. */
function baseByRef(bases: BaseInfo[], ref: string | null): BaseInfo | null {
  if (!ref) return null;
  const norm = normPath(ref).toLowerCase();
  const bare = norm.replace(/\.base$/i, "");
  for (const b of bases) {
    const p = b.path.toLowerCase();
    if (p === norm || p === `${norm}.base`) return b;
    if (b.label.toLowerCase() === bare && !bare.includes("/")) return b;
  }
  return null;
}

interface CascadeResult {
  /** path -> candidate (excluding the seeds themselves). */
  candidates: Map<string, { title: string; depth: number; viaKey: string }>;
  edges: IncomingEdge[];
}

/** Level-by-level BFS over incoming property links (cycle-safe, cross-base). */
async function computeCascade(deps: DeletionPlanDeps, seeds: string[]): Promise<CascadeResult> {
  const candidates = new Map<string, { title: string; depth: number; viaKey: string }>();
  const edges: IncomingEdge[] = [];
  const visited = new Set(seeds);
  let frontier = [...new Set(seeds)];
  let depth = 0;
  while (frontier.length > 0) {
    depth++;
    const map = await deps.getIncomingRelationRefs(frontier);
    const next: string[] = [];
    for (const target of frontier) {
      for (const ref of map.get(target) ?? []) {
        edges.push({ source: ref.path, target, propertyKey: ref.propertyKey });
        if (visited.has(ref.path)) continue;
        visited.add(ref.path);
        candidates.set(ref.path, { title: ref.title, depth, viaKey: ref.propertyKey });
        next.push(ref.path);
      }
    }
    frontier = next;
  }
  return { candidates, edges };
}

/**
 * Builds the deletion plan for a set of target files (notes and/or `.base`
 * files; folders are the caller's business and never reach the plan). Bulk
 * targets aggregate into one plan: one dbItems group per deleted base, one
 * assigned/linked group per source base.
 */
export async function buildDeletionPlan(deps: DeletionPlanDeps, targetPaths: string[]): Promise<DeletionPlan> {
  const targets = [...new Set(targetPaths.map(normPath))];
  const baseTargets = targets.filter(isBasePath);
  const noteTargets = targets.filter((p) => !isBasePath(p));

  const bases = baseTargets.length > 0 || noteTargets.length > 0 ? await loadBaseInfos(deps) : [];
  const memberCache = new Map<string, { set: Set<string>; rows: Array<{ path: string; title: string }> }>();
  const membersOf = async (base: BaseInfo) => {
    const cached = memberCache.get(base.path);
    if (cached) return cached;
    let rows: Array<{ path: string; title: string }> = [];
    try {
      rows = (await deps.queryDatabaseFiles(stripPropertyFilters(base.config))).map((r) => ({
        path: normPath(r.path),
        title: (r.title ?? "") || noteDisplayName(String(r.path)),
      }));
    } catch {
      rows = [];
    }
    const entry = { set: new Set(rows.map((r) => r.path)), rows };
    memberCache.set(base.path, entry);
    return entry;
  };

  const groups: CascadeGroup[] = [];
  const grouped = new Set<string>(); // every element lands in exactly one group
  const primary: DeletionPlan["primary"] = [];
  const deletedBaseInfos: BaseInfo[] = [];

  // 1. Primary card entries.
  for (const p of targets) {
    primary.push({ path: p, title: noteDisplayName(p), kind: isBasePath(p) ? "base" : "note" });
  }

  // 2. Own rows of each deleted base (membership without per-view filters).
  //    Rows that are also members of another (surviving) base are excluded by
  //    default — tag-source bases especially can span the whole vault.
  const seedSet = new Set<string>(noteTargets);
  for (const basePath of baseTargets) {
    const info = bases.find((b) => b.path === normPath(basePath));
    if (!info) continue;
    deletedBaseInfos.push(info);
    const { rows } = await membersOf(info);
    const items: CascadeElement[] = [];
    for (const row of rows) {
      if (grouped.has(row.path) || targets.includes(row.path)) continue;
      const alsoMemberOf: string[] = [];
      for (const other of bases) {
        if (other.path === info.path || baseTargets.some((bt) => normPath(bt) === other.path)) continue;
        if ((await membersOf(other)).set.has(row.path)) alsoMemberOf.push(other.label);
      }
      items.push({ path: row.path, title: row.title, depth: 0, viaKey: "", sharedWith: [], alsoMemberOf });
      grouped.add(row.path);
      seedSet.add(row.path);
    }
    groups.push({
      kind: "dbItems",
      basePath: info.path,
      baseLabel: info.label,
      items,
      defaultChecked: true,
    });
  }

  // 3. Cascade over incoming property links from every note that would go
  //    (explicit note targets + the deleted bases' rows).
  const { candidates, edges } = await computeCascade(deps, [...seedSet]);

  // "Shared" detection: the same property still points at a surviving target.
  const potentialDeletes = new Set<string>([...seedSet, ...targets, ...candidates.keys()]);
  const elementFor = async (path: string, c: { title: string; depth: number; viaKey: string }): Promise<CascadeElement> => {
    let sharedWith: string[] = [];
    try {
      const outgoing = await deps.getOutgoingRelationTargets(path, c.viaKey);
      sharedWith = outgoing.filter((t) => !potentialDeletes.has(normPath(t))).map((t) => noteDisplayName(t));
    } catch {
      sharedWith = [];
    }
    return { path, title: c.title, depth: c.depth, viaKey: c.viaKey, sharedWith, alsoMemberOf: [] };
  };

  // 4. Group the candidates by their owning base: the base that declares the
  //    column they entered through AND counts them as a member. Falls back to
  //    one generic "assigned" group.
  const byGroup = new Map<string, { base: BaseInfo | null; items: CascadeElement[] }>();
  for (const [path, c] of candidates) {
    if (grouped.has(path)) continue;
    let owner: BaseInfo | null = null;
    for (const b of bases) {
      if (!b.columnKeys.has(c.viaKey)) continue;
      if ((await membersOf(b)).set.has(path)) {
        owner = b;
        break;
      }
    }
    const key = owner ? owner.path : "";
    const bucket = byGroup.get(key) ?? { base: owner, items: [] };
    bucket.items.push(await elementFor(path, c));
    byGroup.set(key, bucket);
    grouped.add(path);
  }

  const linkedBaseGroups = new Map<string, CascadeGroup>();
  for (const [key, bucket] of byGroup) {
    bucket.items.sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title));
    const isLinkedToDeletedBase =
      baseTargets.length > 0 && bucket.base !== null && !baseTargets.some((bt) => normPath(bt) === bucket.base?.path);
    const group: CascadeGroup = {
      kind: isLinkedToDeletedBase ? "linkedAssigned" : "assigned",
      basePath: key,
      baseLabel: bucket.base?.label ?? "",
      items: bucket.items,
      baseTotal: bucket.base ? (await membersOf(bucket.base)).set.size : undefined,
      // Element case: directly assigned elements are pre-checked (the question
      // the dialog asks); anything belonging to a LINKED base defaults OFF.
      defaultChecked: !isLinkedToDeletedBase,
    };
    groups.push(group);
    if (isLinkedToDeletedBase && bucket.base) linkedBaseGroups.set(bucket.base.path, group);
  }

  // 5. Whole-database step for every base linked to a deleted base (relation
  //    columns targeting it, or reverse columns of it) — default OFF, explicit.
  if (deletedBaseInfos.length > 0) {
    const linked = new Map<string, BaseInfo>();
    for (const b of bases) {
      if (deletedBaseInfos.some((d) => d.path === b.path)) continue;
      const pointsAtDeleted = b.relations.some((r) => {
        const target = baseByRef(bases, r.relationBase);
        return target != null && deletedBaseInfos.some((d) => d.path === target.path);
      });
      const reverseOfDeleted = deletedBaseInfos.some((d) =>
        d.reverseTargets.some((ref) => baseByRef(bases, ref)?.path === b.path)
      );
      const deletedReversesToMe = b.reverseTargets.some((ref) => {
        const target = baseByRef(bases, ref);
        return target != null && deletedBaseInfos.some((d) => d.path === target.path);
      });
      if (pointsAtDeleted || reverseOfDeleted || deletedReversesToMe) linked.set(b.path, b);
    }
    for (const b of linked.values()) {
      const { rows, set } = await membersOf(b);
      const items: CascadeElement[] = [];
      for (const row of rows) {
        if (grouped.has(row.path) || targets.includes(row.path)) continue;
        items.push({ path: row.path, title: row.title, depth: 0, viaKey: "", sharedWith: [], alsoMemberOf: [] });
        grouped.add(row.path);
      }
      if (!linkedBaseGroups.has(b.path)) {
        // No assigned elements — still offer the two-step card (step 1 empty).
        linkedBaseGroups.set(b.path, {
          kind: "linkedAssigned",
          basePath: b.path,
          baseLabel: b.label,
          items: [],
          baseTotal: set.size,
          defaultChecked: false,
        });
        groups.push(linkedBaseGroups.get(b.path)!);
      }
      groups.push({
        kind: "linkedAll",
        basePath: b.path,
        baseLabel: b.label,
        items,
        baseTotal: set.size,
        linkedBaseFile: b.path,
        defaultChecked: false,
      });
    }
  }

  // Stable order: dbItems first, then assigned, then linked pairs by label.
  const rank: Record<CascadeGroupKind, number> = { dbItems: 0, assigned: 1, linkedAssigned: 2, linkedAll: 3 };
  groups.sort((a, b) => rank[a.kind] - rank[b.kind] || a.baseLabel.localeCompare(b.baseLabel));

  return { primary, groups, incomingEdges: edges, affectedBases: baseTargets.map(normPath) };
}

export function groupId(group: Pick<CascadeGroup, "kind" | "basePath">): string {
  return `${group.kind}\n${group.basePath}`;
}

/** Initial dialog selection: group defaults + shared/multi-membership opt-outs. */
export function initialSelection(plan: DeletionPlan): CascadeSelection {
  const groups: Record<string, boolean> = {};
  const excluded = new Set<string>();
  for (const g of plan.groups) {
    groups[groupId(g)] = g.defaultChecked;
    for (const item of g.items) {
      if (item.sharedWith.length > 0 || item.alsoMemberOf.length > 0) excluded.add(item.path);
    }
  }
  return { groups, excluded, cleanupRefs: true };
}

/** linkedAll implies linkedAssigned of the same base (step 2 covers step 1). */
export function effectiveGroupChecked(plan: DeletionPlan, sel: CascadeSelection, group: CascadeGroup): boolean {
  const own = sel.groups[groupId(group)] ?? group.defaultChecked;
  if (own) return true;
  if (group.kind === "linkedAssigned") {
    const all = plan.groups.find((g) => g.kind === "linkedAll" && g.basePath === group.basePath);
    if (all) return sel.groups[groupId(all)] ?? all.defaultChecked;
  }
  return false;
}

/** The final set of file paths the current selection would delete. */
export function selectedPaths(plan: DeletionPlan, sel: CascadeSelection): string[] {
  const out = new Set<string>(plan.primary.map((p) => p.path));
  for (const g of plan.groups) {
    if (!effectiveGroupChecked(plan, sel, g)) continue;
    for (const item of g.items) {
      if (!sel.excluded.has(item.path)) out.add(item.path);
    }
    if (g.kind === "linkedAll" && g.linkedBaseFile) out.add(g.linkedBaseFile);
  }
  return [...out];
}

/** Property references from SURVIVING notes onto deleted paths (cleanup set). */
export function cleanupRefsFor(plan: DeletionPlan, selected: ReadonlySet<string>): IncomingEdge[] {
  const seen = new Set<string>();
  const out: IncomingEdge[] = [];
  for (const e of plan.incomingEdges) {
    if (!selected.has(e.target) || selected.has(e.source)) continue;
    const key = `${e.source}\n${e.propertyKey}\n${e.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/**
 * True when the delete deserves the cascade dialog: anything would cascade or
 * a linked database exists. Plain notes without incoming relations (and bases
 * without rows/links) keep the existing slim confirmation flow.
 */
export function planNeedsDialog(plan: DeletionPlan): boolean {
  return plan.groups.some((g) => g.items.length > 0 || g.kind === "linkedAll");
}
