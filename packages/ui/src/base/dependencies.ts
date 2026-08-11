/**
 * Dependencies between entries — "this cannot start until that is finished".
 *
 * The on-disk shape follows **RFC 9253** (the iCalendar extension for task
 * relationships), the same vocabulary the TaskNotes plugin already writes into
 * frontmatter, so a vault is not locked into Plainva's private idea of what a
 * dependency is:
 *
 *     blockedBy:
 *       - uid: "[[Projekte/Umsetzung]]"
 *         reltype: FINISHTOSTART
 *         gap: P1D
 *
 * Only ONE direction is stored. The other is derived — a stored pair would be
 * two facts that can disagree, and the moment they do, neither is trustworthy.
 *
 * Only `FINISHTOSTART` is EVALUATED (decision E3). The rest of the vocabulary
 * round-trips untouched so a file written elsewhere survives, but Plainva draws
 * and checks the one relationship that carries almost all real scheduling.
 * Start-to-Finish is never offered: the DCMA assessment treats it as a defect,
 * and a tool that offers it invites plans nobody can read.
 */

export type RelType = "FINISHTOSTART" | "FINISHTOFINISH" | "STARTTOSTART" | "STARTTOFINISH";

export const REL_TYPES: readonly RelType[] = [
  "FINISHTOSTART", "FINISHTOFINISH", "STARTTOSTART", "STARTTOFINISH",
] as const;

/** The one relationship Plainva evaluates and draws. */
export const EVALUATED_RELTYPE: RelType = "FINISHTOSTART";

export interface Dependency {
  /** Wiki link to the predecessor, exactly as written in the note. */
  uid: string;
  reltype: RelType;
  /** ISO-8601 duration ("P1D"), optional lag between the two. */
  gap?: string;
}

const DURATION_RE = /^-?P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?!$)(\d+H)?(\d+M)?(\d+S)?)?$/;

/**
 * Read a dependency list off a frontmatter value.
 *
 * A bare string entry is accepted as a shorthand for a finish-to-start link —
 * that is what someone types by hand, and refusing it would make the feature
 * unusable outside the picker. Malformed entries are dropped, never thrown on.
 */
export function parseDependencies(raw: unknown): Dependency[] {
  const list = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
  const out: Dependency[] = [];
  for (const entry of list) {
    if (typeof entry === "string") {
      const uid = entry.trim();
      if (uid) out.push({ uid, reltype: EVALUATED_RELTYPE });
      continue;
    }
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const uid = typeof e.uid === "string" ? e.uid.trim() : "";
    if (!uid) continue;
    const rel = typeof e.reltype === "string" ? e.reltype.toUpperCase() : "";
    const dep: Dependency = {
      uid,
      reltype: (REL_TYPES as readonly string[]).includes(rel) ? (rel as RelType) : EVALUATED_RELTYPE,
    };
    const gap = typeof e.gap === "string" ? e.gap.trim() : "";
    if (gap && DURATION_RE.test(gap)) dep.gap = gap;
    out.push(dep);
  }
  return out;
}

/** Frontmatter value for a dependency list; an empty list means: remove the key. */
export function serializeDependencies(deps: Dependency[]): Record<string, string>[] {
  return deps.map((d) => {
    const out: Record<string, string> = { uid: d.uid, reltype: d.reltype };
    if (d.gap) out.gap = d.gap;
    return out;
  });
}

/** Days a gap adds, for the overlap check. Only day-scale parts matter here. */
export function gapDays(gap: string | undefined): number {
  if (!gap) return 0;
  const m = DURATION_RE.exec(gap);
  if (!m) return 0;
  const sign = gap.startsWith("-") ? -1 : 1;
  const y = parseInt(m[1] ?? "0", 10) || 0;
  const mo = parseInt(m[2] ?? "0", 10) || 0;
  const w = parseInt(m[3] ?? "0", 10) || 0;
  const d = parseInt(m[4] ?? "0", 10) || 0;
  return sign * (y * 365 + mo * 30 + w * 7 + d);
}

export interface DependencyNode {
  key: string;
  /** Predecessors of this entry, already resolved to keys of the same set. */
  blockedBy: { key: string; reltype: RelType; gap?: string }[];
}

/**
 * Would adding `from` -> `to` close a cycle? Returns the path if so, else null.
 *
 * A cycle is not a wrong number, it is a hang — and it is the one thing a user
 * can build by accident in two clicks. The check runs at WRITE time and names
 * the concrete path, because "that would create a cycle" without saying which
 * one leaves the user to find it themselves.
 */
export function findDependencyCycle(
  nodes: readonly DependencyNode[],
  from: string,
  to: string
): string[] | null {
  if (from === to) return [from, to];
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  // Walk the predecessors of `to`: if we reach `from`, the new edge closes a loop.
  const stack: string[][] = [[to]];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const path = stack.pop()!;
    const head = path[path.length - 1]!;
    if (head === from) return [from, ...path];
    if (seen.has(head)) continue;
    seen.add(head);
    for (const pred of byKey.get(head)?.blockedBy ?? []) {
      stack.push([...path, pred.key]);
    }
  }
  return null;
}

/**
 * Successors that start before their predecessor finishes.
 *
 * Reported, never corrected (decision E6): the dates are the user's statement
 * about the world. Plainva says the two disagree and lets them decide which one
 * was wrong — silently moving a date would rewrite a note nobody asked to change.
 */
export interface ScheduleConflict {
  key: string;
  predecessor: string;
  /** How many days too early the successor begins, gap included. */
  overlapDays: number;
}

export function findScheduleConflicts(
  nodes: readonly DependencyNode[],
  dates: ReadonlyMap<string, { start?: string; end?: string }>
): ScheduleConflict[] {
  const out: ScheduleConflict[] = [];
  for (const node of nodes) {
    const own = dates.get(node.key);
    const start = own?.start;
    if (!start) continue;
    for (const dep of node.blockedBy) {
      if (dep.reltype !== EVALUATED_RELTYPE) continue;
      const pred = dates.get(dep.key);
      const predEnd = pred?.end ?? pred?.start;
      if (!predEnd) continue;
      const earliest = addDaysIso(predEnd, 1 + gapDays(dep.gap));
      if (start < earliest) {
        out.push({
          key: node.key,
          predecessor: dep.key,
          overlapDays: Math.round((Date.parse(earliest) - Date.parse(start)) / 86_400_000),
        });
      }
    }
  }
  return out;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
