import { resolveLinkTarget } from "@plainva/core";

/**
 * Auto-scoping for embedded databases: when a `.base` is embedded inside a
 * single database element (a note that is a row of some base B), and the
 * embedded base relates to B, its rows are scoped to the host element without
 * touching the base's own saved filters. The scope is derived at query time,
 * never persisted, and shared with the "new item" prefill (a task created in a
 * project's embedded task list is linked back to that project).
 *
 * Directions:
 *  - "down": the embedded base OWNS a relation column targeting the host's base
 *    (Tasks.project -> Projects). Scope = rows whose relation points at the
 *    host. Self-relations (parent -> same base) with a nested view scope to the
 *    whole descendant subtree; otherwise to the direct children.
 *  - "up": the embedded base only has a computed reverse column of a relation
 *    the host's base owns (Projects embedded inside a Task). Scope = the rows
 *    the host itself points at (its outgoing links for the owning property).
 */

export interface EmbedScopeRelation {
  /** Column key on the embedded base that connects it to the host's base. */
  column: string;
  direction: "down" | "up";
  /** Cardinality of the owning side ("down": this column; "up": the host's
   * owning property). Drives the new-item link semantics (append vs replace). */
  limitOne: boolean;
  /** True when the owning relation targets the embedded base itself. */
  selfRelation: boolean;
  /** "up" only: the frontmatter property on the host that stores the link. */
  hostProperty?: string;
  /** Localized column label for the scope chip. */
  label: string;
}

function normPath(p: unknown): string {
  return String(p ?? "").replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * All relations that connect the embedded base to the host's governing base,
 * both directions. Pure — the caller supplies the two column schemas (the
 * embedded base's own columns and the host base's columns from
 * resolveGoverningBase) and a label resolver.
 */
export function detectEmbedScopeRelations(params: {
  hostBasePath: string;
  hostColumns: Record<string, any>;
  embeddedBasePath: string;
  embeddedColumns: Record<string, any>;
  labelOf: (columnKey: string) => string;
}): EmbedScopeRelation[] {
  const host = normPath(params.hostBasePath);
  const self = normPath(params.embeddedBasePath) === host;
  const out: EmbedScopeRelation[] = [];
  for (const [key, colRaw] of Object.entries(params.embeddedColumns ?? {})) {
    const col = colRaw as any;
    if (!col || typeof col !== "object") continue;
    // DOWN: the embedded base owns a relation that targets the host's base.
    if (col.input === "relation" && col.relationBase && normPath(col.relationBase) === host) {
      out.push({
        column: key,
        direction: "down",
        limitOne: col.relationLimit === "one",
        selfRelation: self,
        label: params.labelOf(key),
      });
      continue;
    }
    // UP: the embedded base has a reverse column of a relation the host owns.
    const rev = col.reverseOf;
    if (rev && rev.base && rev.property && normPath(rev.base) === host) {
      const ownerCol = params.hostColumns?.[rev.property];
      out.push({
        column: key,
        direction: "up",
        limitOne: ownerCol?.relationLimit === "one",
        selfRelation: self,
        hostProperty: rev.property,
        label: params.labelOf(key),
      });
    }
  }
  return out;
}

/**
 * Explicit "this note" self-reference filters (Notion's "this page"): the user
 * picks a property + value "Diese Notiz" in the filter UI. Stored plainva-side
 * (`views[0].plainva.contextFilters`, lifted to `config.contextFilters`), so
 * Obsidian ignores it and shows all rows. Resolved against the host only when
 * embedded — standalone drops it. Unlike the automatic detection above, this
 * works for ANY wiki-link-storing property, not just relations to the host base.
 */
export const SELF_MARKER = "@this";

/** Value shown in the filter dropdown that maps to the self-reference. */
export function isSelfMarker(value: unknown): boolean {
  return value === SELF_MARKER;
}

/** Configured self-reference property keys (base-global, deduped). */
export function getContextFilters(config: any): string[] {
  const cf = config?.contextFilters;
  return Array.isArray(cf) ? cf.filter((x: any): x is string => typeof x === "string" && !!x) : [];
}

export function addContextFilter(config: any, property: string): any {
  const nc = JSON.parse(JSON.stringify(config ?? {}));
  const list = getContextFilters(nc);
  if (property && !list.includes(property)) list.push(property);
  nc.contextFilters = list;
  return nc;
}

export function removeContextFilter(config: any, property: string): any {
  const nc = JSON.parse(JSON.stringify(config ?? {}));
  const list = getContextFilters(nc).filter((p) => p !== property);
  if (list.length > 0) nc.contextFilters = list;
  else delete nc.contextFilters;
  return nc;
}

/**
 * Build the scope descriptor for an EXPLICIT self-reference property (no
 * host-base matching needed — the user chose it): an owning relation or plain
 * wiki-link property resolves "down" (rows referencing the host); a computed
 * reverse column resolves "up" (the rows the host points at).
 */
export function buildContextScopeRelation(
  embeddedColumns: Record<string, any>,
  property: string,
  embeddedBasePath: string,
  labelOf: (columnKey: string) => string
): EmbedScopeRelation {
  const col = embeddedColumns?.[property];
  const label = labelOf(property);
  if (col && typeof col === "object") {
    const rev = (col as any).reverseOf;
    if (rev && rev.property) {
      return {
        column: property,
        direction: "up",
        limitOne: false,
        selfRelation: normPath(rev.base) === normPath(embeddedBasePath),
        hostProperty: rev.property,
        label,
      };
    }
    return {
      column: property,
      direction: "down",
      limitOne: (col as any).relationLimit === "one",
      selfRelation: (col as any).input === "relation" && normPath((col as any).relationBase) === normPath(embeddedBasePath),
      label,
    };
  }
  // Plain frontmatter link property (not a typed relation) — still in the link index.
  return { column: property, direction: "down", limitOne: false, selfRelation: false, label };
}

type ScopeQueryService = {
  getRelationSources(
    targetPaths: string[],
    propertyKey: string
  ): Promise<Map<string, { path: string; title: string }[]>>;
  getFileProperties(path: string): Promise<Record<string, any>>;
  listNotes(limit?: number): Promise<{ path: string }[]>;
};

/**
 * The set of note paths in scope for `relation` around `hostPath`. Uses the
 * link index (getRelationSources / resolved outgoing links), so matching is
 * exact and independent of the raw wiki-link form stored in frontmatter.
 */
export async function computeScopePaths(
  queryService: ScopeQueryService,
  hostPath: string,
  relation: EmbedScopeRelation,
  opts: { subtree: boolean }
): Promise<Set<string>> {
  if (relation.direction === "down") {
    if (relation.selfRelation && opts.subtree) {
      // Whole descendant subtree, level by level (one batched query per depth,
      // cycle-safe via the visited set).
      const scope = new Set<string>();
      let frontier = [hostPath];
      while (frontier.length > 0) {
        const map = await queryService.getRelationSources(frontier, relation.column);
        const next: string[] = [];
        for (const node of frontier) {
          for (const src of map.get(node) ?? []) {
            if (src.path === hostPath || scope.has(src.path)) continue;
            scope.add(src.path);
            next.push(src.path);
          }
        }
        frontier = next;
      }
      return scope;
    }
    const map = await queryService.getRelationSources([hostPath], relation.column);
    return new Set((map.get(hostPath) ?? []).map((s) => s.path));
  }

  // UP: resolve the host's own outgoing links for the owning property.
  const props = await queryService.getFileProperties(hostPath);
  const raw = relation.hostProperty ? props[relation.hostProperty] : undefined;
  const values = Array.isArray(raw) ? raw.map(String) : raw != null && raw !== "" ? [String(raw)] : [];
  if (values.length === 0) return new Set();
  const allPaths = (await queryService.listNotes()).map((n) => n.path);
  const scope = new Set<string>();
  for (const value of values) {
    const m = value.match(/\[\[([^\]|#]+)/);
    const targetText = (m ? m[1] : value).trim();
    if (!targetText) continue;
    const resolved = resolveLinkTarget(hostPath, targetText, allPaths);
    if (resolved) scope.add(resolved);
  }
  return scope;
}

/**
 * Combined scope for several explicit self-reference relations (AND-intersect —
 * a row must satisfy every "Diese Notiz" filter). Empty list yields an empty
 * set; the caller only intersects when at least one relation is present.
 */
export async function computeContextScope(
  queryService: ScopeQueryService,
  hostPath: string,
  relations: EmbedScopeRelation[],
  subtreeColumns: Set<string>
): Promise<Set<string>> {
  let acc: Set<string> | null = null;
  for (const rel of relations) {
    const set = await computeScopePaths(queryService, hostPath, rel, { subtree: subtreeColumns.has(rel.column) });
    if (acc === null) {
      acc = new Set<string>(set);
    } else {
      const prev: Set<string> = acc;
      acc = new Set<string>([...prev].filter((p) => set.has(p)));
    }
  }
  return acc ?? new Set<string>();
}

/**
 * Dropdown options for the embed scope control (now shown as a "This note"
 * filter row in the config panel, not a separate header pill). An explicit
 * `contextFilters` entry takes precedence (one "This note" option); otherwise
 * one option per auto-detected relation (labeled by the host, disambiguated by
 * the relation label only when several exist). "Show all" is always last.
 */
export function buildEmbedScopeOptions(
  hasContextFilters: boolean,
  scopeRelations: { label: string }[],
  hostTitle: string,
  labels: { thisNote: string; showAll: string }
): { value: string; label: string }[] {
  const opts: { value: string; label: string }[] = [];
  if (hasContextFilters) {
    opts.push({ value: "0", label: `${labels.thisNote}: ${hostTitle}` });
  } else {
    scopeRelations.forEach((r, i) => {
      opts.push({ value: String(i), label: scopeRelations.length > 1 ? `${hostTitle} · ${r.label}` : hostTitle });
    });
  }
  opts.push({ value: "off", label: labels.showAll });
  return opts;
}
