import { updateVaultText, type TextUpdateFiles } from "@plainva/core";
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
  /** A vault's chain, or a storage with nothing above it: each `.base` is read, changed and written in one step. */
  adapter: TextUpdateFiles;
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
  /** A `.base` text with its pinboard lists retargeted — `null` where it names none of the moved paths. */
  const retargeted = (text: string): string | null => {
    if (!text.includes("pinboardOrder") && !text.includes("pinboardPinned")) return null;
    let cfg: any;
    try {
      cfg = parseBaseConfig(text);
    } catch {
      return null;
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
    return any ? serializeBaseConfig(cfg) : null;
  };
  const changed: string[] = [];
  for (const basePath of basePaths) {
    // Looked at first, without the chain's gate: a base without pinboard keys
    // (nearly all of them) is never parsed and never rewritten.
    let text: string;
    try {
      text = await deps.adapter.readTextFile(basePath);
    } catch {
      continue;
    }
    if (retargeted(text) === null) continue;
    try {
      // Through the caller's adapter chain (backup/sync like every write), read and written in one step.
      if ((await updateVaultText(deps.adapter, basePath, retargeted)).changed) changed.push(basePath);
    } catch (e) {
      // One unwritable base must never break the rename/move itself.
      console.warn("[pinboardSweep] rewriting", basePath, "failed", e);
    }
  }
  return changed;
}

/**
 * A delete in the app takes the deleted notes out of every pinboard's lists,
 * as a move retargets them (`sweepPinboardRefs`): since a pin, an unpin or a
 * drag keeps every entry it does not show, a dead path left behind was taken
 * over by the next note of the same name — a quick capture "Einkauf" came back
 * pinned at the place of a deleted one. `paths` are files, `folders` folders
 * whose every entry below goes. Returns the rewritten `.base` paths; a base
 * that cannot be read or written is skipped, never the delete.
 */
export async function dropPinboardRefs(
  deps: PinboardSweepDeps,
  paths: ReadonlyArray<string>,
  folders: ReadonlyArray<string> = [],
): Promise<string[]> {
  if (!deps.queryService || (paths.length === 0 && folders.length === 0)) return [];
  const exact = new Set(paths);
  const gone = (p: string) => exact.has(p) || folders.some((f) => p.startsWith(f + "/"));
  let basePaths: string[];
  try {
    basePaths = await deps.queryService.listBaseFilePaths();
  } catch {
    return [];
  }
  const dropped = (text: string): string | null => {
    if (!text.includes("pinboardOrder") && !text.includes("pinboardPinned")) return null;
    let cfg: any;
    try {
      cfg = parseBaseConfig(text);
    } catch {
      return null;
    }
    let any = false;
    for (const v of Array.isArray(cfg.views) ? cfg.views : []) {
      for (const key of ["pinboardOrder", "pinboardPinned"] as const) {
        if (!Array.isArray(v?.[key])) continue;
        const kept = (v[key] as unknown[]).filter((p) => !gone(String(p)));
        if (kept.length === v[key].length) continue;
        v[key] = kept.length > 0 ? kept : undefined;
        if (v[key] === undefined) delete v[key];
        any = true;
      }
    }
    return any ? serializeBaseConfig(cfg) : null;
  };
  const changed: string[] = [];
  for (const basePath of basePaths) {
    let text: string;
    try {
      text = await deps.adapter.readTextFile(basePath);
    } catch {
      continue;
    }
    if (dropped(text) === null) continue;
    try {
      if ((await updateVaultText(deps.adapter, basePath, dropped)).changed) changed.push(basePath);
    } catch (e) {
      // One unwritable base must never break the delete itself.
      console.warn("[pinboardSweep] dropping deleted paths from", basePath, "failed", e);
    }
  }
  return changed;
}
