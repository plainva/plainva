import { parseBaseConfig, serializeBaseConfig } from "./baseFormat";
import { retargetPinboardPaths } from "./pinboardModel";

/**
 * Path sweep for pinboard arrangements (plan Pinboard P5, D4).
 *
 * `pinboardOrder`/`pinboardPinned` carry vault-relative PATHS, and moves/renames
 * deliberately do no vault-wide link rewrite (links resolve by name) — so every
 * path-changing operation must retarget the pinboard lists instead, or the
 * moved card silently loses its position and pin. Wired into BOTH shells
 * (the templateFor lesson: a desktop-only sweep loses mobile renames):
 *  - shared renameFileWithLinkUpdates (desktop file rename + mobile rename)
 *  - desktop folder rename (fileActions) and tree drag/move (FileTree)
 *  - mobile vaultOps.moveNote / renameFolder
 *
 * Cheap by construction: bases are few (listBaseFilePaths), and a text
 * precheck skips every base without pinboard keys — a foreign `.base` is
 * never parsed or rewritten (no accidental format normalization).
 */
export interface PinboardSweepDeps {
  adapter: {
    readTextFile(path: string): Promise<string>;
    writeTextFile(path: string, content: string): Promise<void>;
  };
  queryService: { listBaseFilePaths(): Promise<string[]> } | null | undefined;
}

/** Exact file moves plus folder-prefix moves; returns the rewritten `.base` paths. */
export async function sweepPinboardRefs(
  deps: PinboardSweepDeps,
  moves: ReadonlyArray<{ from: string; to: string }>,
  folderMoves: ReadonlyArray<{ from: string; to: string }> = [],
): Promise<string[]> {
  if (!deps.queryService || (moves.length === 0 && folderMoves.length === 0)) return [];
  const exact = new Map(moves.map((m) => [m.from, m.to]));
  const retarget = (p: string): string | undefined => {
    const hit = exact.get(p);
    if (hit !== undefined) return hit;
    for (const f of folderMoves) {
      if (p.startsWith(f.from + "/")) return f.to + p.slice(f.from.length);
    }
    return undefined;
  };

  let basePaths: string[];
  try {
    basePaths = await deps.queryService.listBaseFilePaths();
  } catch {
    return [];
  }
  const changed: string[] = [];
  for (const basePath of basePaths) {
    let text: string;
    try {
      text = await deps.adapter.readTextFile(basePath);
    } catch {
      continue;
    }
    if (!text.includes("pinboardOrder") && !text.includes("pinboardPinned")) continue;
    let cfg: any;
    try {
      cfg = parseBaseConfig(text);
    } catch {
      continue;
    }
    let any = false;
    for (const v of Array.isArray(cfg.views) ? cfg.views : []) {
      for (const key of ["pinboardOrder", "pinboardPinned"] as const) {
        if (!Array.isArray(v?.[key])) continue;
        const map = new Map<string, string>();
        for (const p of v[key] as string[]) {
          const to = retarget(String(p));
          if (to !== undefined && to !== p) map.set(String(p), to);
        }
        if (map.size === 0) continue;
        const r = retargetPinboardPaths(v[key] as string[], map);
        if (r.changed) {
          v[key] = r.list;
          any = true;
        }
      }
    }
    if (!any) continue;
    try {
      // Through the caller's adapter chain (backup/sync like every write).
      await deps.adapter.writeTextFile(basePath, serializeBaseConfig(cfg));
      changed.push(basePath);
    } catch (e) {
      // One unwritable base must never break the rename/move itself.
      console.warn("[pinboardSweep] rewriting", basePath, "failed", e);
    }
  }
  return changed;
}
