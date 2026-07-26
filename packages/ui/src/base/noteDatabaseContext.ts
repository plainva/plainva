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
    memberships.push({ basePath: base.path, baseLabel: base.label, viewName: base.viewNames[0] ?? null });
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
