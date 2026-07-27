import {
  baseByRef,
  createMemberLookup,
  isBasePath,
  loadBaseInfos,
  normBasePath,
  type BaseDataDeps,
  type BaseInfo,
  type IncomingRelationRef,
} from "./baseMembership";
import { combineFilters } from "./filterExpr";
import { noteDisplayName } from "../lib/noteTitle";

/**
 * "Which database does this note belong to?" (plan P4).
 *
 * The maintainer's finding: sitting inside a note that is a row of a database,
 * nothing on screen says so — no database, no parent, no sub-items. This
 * derives all of it from data that already exists and writes NOTHING back:
 *
 *  - membership: the `.base` data source WITHOUT per-view filters (shared with
 *    the cascade deletion via `baseMembership`, so both features agree on what
 *    "belongs to" means),
 *  - parent/children: the self relation the database declares as its sub-items
 *    property (`views[i].subItemsProperty` + its `reverseOf` counterpart),
 *  - linked databases: incoming frontmatter relations from OTHER databases.
 *
 * Obsidian compatibility is untouched — nothing here is persisted.
 */

export interface NoteDatabaseMembership {
  basePath: string;
  baseLabel: string;
  /** First view name of that base, for "Aufgaben · Ansicht ‚Offen'". */
  viewName: string | null;
  /** The `.base` config — the inspector needs it for types, options and colors. */
  config: unknown;
  /** Visible columns of that view, in the order the table shows them (bare keys). */
  columns: string[];
  /** This note as the view sees it: property values plus the `file.*` fields. */
  row: Record<string, unknown> | null;
  /**
   * 1-based position in the VIEW and its length ("12 / 34"). Zero when the note
   * belongs to the database but the view's own filters exclude it — membership
   * deliberately ignores those filters, so the two can legitimately disagree.
   */
  index: number;
  total: number;
  /** Neighbours in view order; null at either end. */
  prevPath: string | null;
  nextPath: string | null;
}

export interface NoteRelative {
  path: string;
  title: string;
}

export interface NoteLinkedDatabase {
  basePath: string;
  baseLabel: string;
  /** How many notes of that database point at this one. */
  count: number;
}

export interface NoteDatabaseContext {
  /** Every database this note is a row of (E6: all of them, the row wraps). */
  memberships: NoteDatabaseMembership[];
  /** The note's parent in the sub-items hierarchy, with its database label. */
  parent: (NoteRelative & { baseLabel: string }) | null;
  /** Direct sub-items of this note. */
  children: NoteRelative[];
  /** Foreign databases whose notes reference this one. */
  linked: NoteLinkedDatabase[];
}

export const EMPTY_NOTE_DATABASE_CONTEXT: NoteDatabaseContext = {
  memberships: [],
  parent: null,
  children: [],
  linked: [],
};

/** True when there is anything worth showing (the bar stays hidden otherwise). */
export function hasNoteDatabaseContext(ctx: NoteDatabaseContext): boolean {
  return ctx.memberships.length > 0 || ctx.parent !== null || ctx.children.length > 0 || ctx.linked.length > 0;
}

/**
 * What the FIRST view of a database says about this one note: which columns it
 * shows, this note's values for them, and where the note sits in the view.
 *
 * The view's own filters apply here — unlike membership, which strips them so
 * that "belongs to" cannot change with a filter. Both readings are needed: one
 * answers "is this a row of that database", the other "what would I see there".
 */
async function inspectFirstView(
  deps: BaseDataDeps,
  base: BaseInfo,
  path: string,
): Promise<Pick<NoteDatabaseMembership, "columns" | "row" | "index" | "total" | "prevPath" | "nextPath">> {
  const empty = { columns: [] as string[], row: null, index: 0, total: 0, prevPath: null, nextPath: null };
  const cfg = base.config as { views?: unknown[]; filters?: unknown } | null;
  const views = Array.isArray(cfg?.views) ? cfg!.views : [];
  const view = (views[0] ?? {}) as { order?: unknown[] };

  let rows: Array<Record<string, unknown>>;
  try {
    const merged = { ...(cfg ?? {}), filters: combineFilters(cfg?.filters, (view as { filters?: unknown }).filters), views: [view] };
    rows = (await deps.queryDatabaseFiles(merged)) as unknown as Array<Record<string, unknown>>;
  } catch {
    return empty;
  }

  const at = rows.findIndex((r) => normBasePath(r["file.path"] ?? r.path) === path);
  // `note.` is the on-disk prefix for a note property; `file.*` columns are
  // derived fields the inspector cannot edit, so they stay out of it.
  const columns = (Array.isArray(view.order) ? view.order : [])
    .map((c) => String(c).replace(/^note\./, ""))
    .filter((c) => c && !c.startsWith("file."));

  if (at < 0) return { ...empty, columns, total: rows.length };
  return {
    columns,
    row: rows[at],
    index: at + 1,
    total: rows.length,
    prevPath: at > 0 ? normBasePath(rows[at - 1]["file.path"] ?? rows[at - 1].path) : null,
    nextPath: at < rows.length - 1 ? normBasePath(rows[at + 1]["file.path"] ?? rows[at + 1].path) : null,
  };
}

export async function buildNoteDatabaseContext(deps: BaseDataDeps, notePath: string): Promise<NoteDatabaseContext> {
  const path = normBasePath(notePath);
  // A `.base` file is a database, not a row of one.
  if (!path || isBasePath(path)) return EMPTY_NOTE_DATABASE_CONTEXT;

  const bases = await loadBaseInfos(deps);
  if (bases.length === 0) return EMPTY_NOTE_DATABASE_CONTEXT;
  const membersOf = createMemberLookup(deps);

  const memberships: NoteDatabaseMembership[] = [];
  const owning: BaseInfo[] = [];
  for (const base of bases) {
    const members = await membersOf(base);
    if (!members.set.has(path)) continue;
    owning.push(base);
    memberships.push({
      basePath: base.path,
      baseLabel: base.label,
      viewName: base.viewNames[0] ?? null,
      config: base.config,
      ...(await inspectFirstView(deps, base, path)),
    });
  }

  // Parent/children only exist where a database declares a sub-items property —
  // that column IS the hierarchy. First owning database that has one wins.
  let parent: NoteDatabaseContext["parent"] = null;
  let children: NoteRelative[] = [];
  const hierarchyBase = owning.find((b) => b.subItemsProperty);
  if (hierarchyBase?.subItemsProperty) {
    const key = hierarchyBase.subItemsProperty;
    const parentPaths = await deps.getOutgoingRelationTargets(path, key).catch(() => []);
    const parentPath = parentPaths.map(normBasePath).find((p) => p && p !== path) ?? null;
    if (parentPath) {
      parent = { path: parentPath, title: noteDisplayName(parentPath), baseLabel: hierarchyBase.label };
    }
    const incoming = await deps
      .getIncomingRelationRefs([path])
      .catch(() => new Map<string, IncomingRelationRef[]>());
    children = (incoming.get(path) ?? [])
      .filter((ref) => ref.propertyKey === key)
      .map((ref) => ({ path: normBasePath(ref.path), title: ref.title || noteDisplayName(ref.path) }))
      .filter((c) => c.path !== path);
  }

  // Linked databases: notes from OTHER databases that reference this one via a
  // frontmatter relation. Grouped by their database, counted, self excluded.
  const linked: NoteLinkedDatabase[] = [];
  const incomingAll = await deps
    .getIncomingRelationRefs([path])
    .catch(() => new Map<string, IncomingRelationRef[]>());
  const refs = incomingAll.get(path) ?? [];
  if (refs.length > 0) {
    const owningPaths = new Set(owning.map((b) => b.path));
    const childPaths = new Set(children.map((c) => c.path));
    const counts = new Map<string, number>();
    for (const ref of refs) {
      const refPath = normBasePath(ref.path);
      // Sub-items already have their own line — do not count them twice.
      if (childPaths.has(refPath)) continue;
      for (const base of bases) {
        if (owningPaths.has(base.path)) continue;
        const members = await membersOf(base);
        if (!members.set.has(refPath)) continue;
        counts.set(base.path, (counts.get(base.path) ?? 0) + 1);
      }
    }
    for (const [basePath, count] of counts) {
      const base = baseByRef(bases, basePath);
      if (base) linked.push({ basePath: base.path, baseLabel: base.label, count });
    }
  }

  return { memberships, parent, children, linked };
}
