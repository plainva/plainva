import { parseSourceClause, type SourceClause } from "@plainva/ui";

/**
 * Decides whether an index refresh restricted to `changedPaths` can affect a
 * `.base` view at all (P2.7). Before this, EVERY save of ANY vault file
 * re-queried the open database (rows, filters, reverse relations).
 *
 * Conservative by design — anything uncertain answers `true`:
 * - unknown paths (global bump) → refresh
 * - any changed `.base` file → refresh (could be this config or a relation target)
 * - tag sources → refresh (tags match anywhere)
 * - relation / reverse columns → refresh (links onto rows come from anywhere)
 * - no recognizable folder source → refresh
 * A wrong `false` would leave stale rows on screen; a wrong `true` only costs
 * one query.
 */
export function baseNeedsRefresh(cfg: unknown, changedPaths: string[] | null | undefined): boolean {
  if (!changedPaths || changedPaths.length === 0) return true;
  const c = cfg as { filters?: unknown; properties?: Record<string, unknown> } | null | undefined;
  if (!c) return true;

  if (changedPaths.some((p) => p.toLowerCase().endsWith(".base"))) return true;

  const sources = collectClauses(c.filters)
    .map(parseSourceClause)
    .filter((s): s is SourceClause => s !== null);
  if (sources.some((s) => s.type === "tag")) return true;

  const folders = sources.filter((s) => s.type === "folder").map((s) => normalizePath(s.value));
  if (folders.length === 0) return true;

  const props = c.properties && typeof c.properties === "object" ? Object.values(c.properties) : [];
  const hasRelationColumns = props.some((p) => {
    if (!p || typeof p !== "object") return false;
    const pv = (p as { plainva?: Record<string, unknown> }).plainva;
    return !!pv && (pv.relationBase !== undefined || pv.reverseOf !== undefined);
  });
  if (hasRelationColumns) return true;

  return changedPaths.some((p) => {
    const np = normalizePath(p);
    return folders.some((f) => f === "" || np === f || np.startsWith(f + "/"));
  });
}

/** Recursively collects every string clause from an and/or/not filter tree. */
function collectClauses(filters: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === "string") {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (node && typeof node === "object") {
      for (const value of Object.values(node)) walk(value);
    }
  };
  walk(filters);
  return out;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}
