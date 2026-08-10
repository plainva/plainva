import { parseBaseConfig } from "../base/baseFormat";
import { parseDueValue } from "./dueTime";

/**
 * Database views projected onto the calendar (S18, plan P9a).
 *
 * The task overlay already does this for ONE database — the standard task list.
 * This is the same idea without the privilege: any `.base` view that is about
 * dates (a calendar or a timeline) can be shown in the calendar alongside real
 * appointments.
 *
 * Two things are deliberate and load-bearing:
 *
 *  - An overlay entry stays recognisable as a NOTE. It is not an appointment,
 *    it lives in the vault, it has no provider and no attendees, and pretending
 *    otherwise would be a lie the moment someone tried to invite anyone to it.
 *  - Only views that NAME a date field are offered. A calendar view without one
 *    has nothing to place, and offering it would produce a switch that turns on
 *    and shows nothing.
 */

/** A view of a database, addressed the way the setting stores it. */
export interface OverlayRef {
  basePath: string;
  viewName: string;
}

/** `path#view` — one string, because the setting is a list that travels through
 * the settings profile and a pair of fields would have to be kept in step. */
export function overlayKey(ref: OverlayRef): string {
  return `${ref.basePath}#${ref.viewName}`;
}

export function parseOverlayKey(key: string): OverlayRef | null {
  const hash = key.lastIndexOf("#");
  if (hash <= 0 || hash === key.length - 1) return null;
  return { basePath: key.slice(0, hash), viewName: key.slice(hash + 1) };
}

/** A database view that CAN be shown in the calendar. */
export interface OverlayCandidate extends OverlayRef {
  /** What the user sees: the database name and the view name. */
  label: string;
  kind: "calendar" | "timeline";
  dateField: string;
  endField?: string;
}

/**
 * Which views of one database qualify.
 *
 * A view qualifies when it renders as a calendar or a timeline AND names the
 * column that carries its date. The second half is what keeps the list honest:
 * without it the entry has no position, and a toggle that places nothing reads
 * as a broken feature rather than as an unconfigured view.
 */
export function overlayCandidates(basePath: string, baseTitle: string, source: string): OverlayCandidate[] {
  let config: { views?: unknown[] };
  try {
    config = parseBaseConfig(source) as { views?: unknown[] };
  } catch {
    return [];
  }
  const out: OverlayCandidate[] = [];
  for (const raw of config?.views ?? []) {
    const view = raw as { name?: string; type?: string; dateField?: string; endField?: string };
    const kind = view?.type === "calendar" ? "calendar" : view?.type === "timeline" ? "timeline" : null;
    if (!kind || !view?.name || !view.dateField) continue;
    out.push({
      basePath,
      viewName: view.name,
      label: `${baseTitle} · ${view.name}`,
      kind,
      dateField: view.dateField,
      ...(view.endField ? { endField: view.endField } : {}),
    });
  }
  return out;
}

/** One row of a database, placed on a day. */
export interface OverlayEntry {
  /** The note, so a click opens it. */
  path: string;
  title: string;
  /** YYYY-MM-DD */
  day: string;
  /** Minutes into the day, when the column is a datetime and carries a time. */
  minutes?: number;
  /** Last day of a span (timeline views with an end column). */
  endDay?: string;
  /** Which view put it here — the calendar shows it, so a reader can tell one
   * database's entries from another's. */
  source: string;
  /** The database and column a drag has to write back into. */
  basePath: string;
  dateField: string;
}

export interface OverlayDeps {
  vaultAdapter: { readTextFile(path: string): Promise<string> };
  queryService: { queryDatabaseFiles(config: unknown): Promise<Record<string, unknown>[]> };
}

/**
 * Loads the entries of the selected views.
 *
 * A view that cannot be read is skipped rather than failing the whole overlay:
 * one renamed database must not empty the calendar of every other.
 */
export async function loadBaseOverlay(
  selected: readonly string[],
  bases: readonly { path: string; title: string }[],
  deps: OverlayDeps
): Promise<OverlayEntry[]> {
  const wanted = new Map<string, Set<string>>();
  for (const key of selected) {
    const ref = parseOverlayKey(key);
    if (!ref) continue;
    const set = wanted.get(ref.basePath) ?? new Set<string>();
    set.add(ref.viewName);
    wanted.set(ref.basePath, set);
  }

  const out: OverlayEntry[] = [];
  for (const [basePath, views] of wanted) {
    try {
      const source = await deps.vaultAdapter.readTextFile(basePath);
      const title = bases.find((b) => b.path === basePath)?.title ?? basePath.split("/").pop()?.replace(/\.base$/i, "") ?? basePath;
      const config = parseBaseConfig(source) as { filters?: unknown; views?: { name?: string; filters?: unknown }[] };
      for (const candidate of overlayCandidates(basePath, title, source)) {
        if (!views.has(candidate.viewName)) continue;
        // The view's OWN filters decide what it shows — an overlay that ignored
        // them would put rows in the calendar that the view itself hides.
        const view = (config?.views ?? []).find((v) => v?.name === candidate.viewName);
        const rows = await deps.queryService.queryDatabaseFiles({ ...(config as object), filters: mergeFilters(config, view) });
        for (const row of rows) {
          const parsed = parseDueValue(row[candidate.dateField]);
          if (!parsed) continue;
          const end = candidate.endField ? parseDueValue(row[candidate.endField]) : null;
          out.push({
            path: String(row["file.path"] ?? ""),
            title: String(row["file.name"] ?? String(row["file.path"] ?? "").split("/").pop()?.replace(/\.md$/i, "") ?? ""),
            day: parsed.day,
            ...(parsed.minutes !== undefined ? { minutes: parsed.minutes } : {}),
            ...(end && end.day !== parsed.day ? { endDay: end.day } : {}),
            source: candidate.label,
            basePath,
            dateField: candidate.dateField,
          });
        }
      }
    } catch {
      /* an unreadable database costs its own entries, not the whole overlay */
    }
  }
  return out;
}

/** The database's source clause AND the view's own rules, both. */
function mergeFilters(config: { filters?: unknown }, view: { filters?: unknown } | undefined): unknown {
  const parts = [config?.filters, view?.filters].filter(Boolean);
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return { and: parts };
}
