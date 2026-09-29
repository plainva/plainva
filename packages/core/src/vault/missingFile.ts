import type { IDatabaseAdapter } from "../db/IDatabaseAdapter.js";

/**
 * What became of a note whose file is missing (issue #110, E9).
 *
 *  - `present`   the file is there after all (the read failed for another
 *                reason, or the check itself failed): nothing to heal, and
 *                nothing is touched;
 *  - `moved`     exactly one other file carries the same content AND the same
 *                modification time — it is the note, moved outside Plainva;
 *                the caller follows it;
 *  - `ambiguous` the reader has to say: several files carry the same content,
 *                or the only one does at another modification time;
 *  - `gone`      proven missing, no candidate. The stale index row is already
 *                removed — no "Remove from index" click needed.
 */
export type MissingFileOutcome =
  | { kind: "present" }
  | { kind: "moved"; to: string }
  | { kind: "ambiguous"; candidates: string[] }
  | { kind: "gone" };

export interface MissingFileDeps {
  /** Checked existence: throws when the disk cannot answer (never guesses). */
  exists(path: string): Promise<boolean>;
  db: Pick<IDatabaseAdapter, "query" | "queryOne">;
  indexer: {
    reconcileFolder(folder: string, opts?: { recursive?: boolean }): Promise<unknown>;
    indexVaultFull(): Promise<unknown>;
  };
}

/** sha256 of the empty string: every empty note shares it, so it identifies nothing. */
const EMPTY_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const parentOf = (path: string): string => {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
};

const mtimeOf = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * Looks for the note behind a missing path by its content hash — the one the
 * index already stored for it (sha256). Order matters and is deliberate:
 *
 *  1. Existence is PROVEN first. A read can fail for many reasons; only a
 *     missing file is healed, and a check that fails decides nothing.
 *  2. Hash and modification time are read BEFORE anything reconciles, because
 *     the reconcile removes the very row that carries them.
 *  3. The parent folder is reconciled flat: the stale row goes, and a rename
 *     inside the same folder is indexed on the spot.
 *  4. Candidates are indexed files with the same hash that exist on disk.
 *     Fewer than two → one full reconcile first, then ask again: the move may
 *     have happened while nobody was watching, and a single hit in a stale
 *     index could be an older copy while the real note is not indexed yet.
 *  5. The same content alone does not prove a move: two untouched notes from
 *     one template, or a copy made last week, carry the same hash. A move
 *     keeps the file's modification time, so only a single candidate that also
 *     has the missing note's time is followed; any other single candidate is
 *     offered. Following the wrong file is the one mistake this must not make.
 */
export async function resolveMissingFile(path: string, deps: MissingFileDeps): Promise<MissingFileOutcome> {
  let present: boolean;
  try {
    present = await deps.exists(path);
  } catch {
    return { kind: "present" };
  }
  if (present) return { kind: "present" };

  const row = await deps.db.queryOne<{ sha256: string | null; mtime_local: number | null }>(
    `SELECT sha256, mtime_local FROM files WHERE path = ?`,
    [path],
  );
  const hash = row?.sha256 ?? null;
  const mtime = mtimeOf(row?.mtime_local);

  await deps.indexer.reconcileFolder(parentOf(path), { recursive: false });
  if (!hash || hash === EMPTY_SHA256) return { kind: "gone" };

  const lookup = async (): Promise<Array<{ path: string; mtime: number | null }>> => {
    const rows = await deps.db.query<{ path: string; mtime_local: number | null }>(
      `SELECT path, mtime_local FROM files WHERE sha256 = ? AND path <> ? ORDER BY path`,
      [hash, path],
    );
    const found: Array<{ path: string; mtime: number | null }> = [];
    for (const r of rows) {
      if (await deps.exists(r.path).catch(() => false)) found.push({ path: r.path, mtime: mtimeOf(r.mtime_local) });
    }
    return found;
  };

  let candidates = await lookup();
  if (candidates.length < 2) {
    await deps.indexer.indexVaultFull();
    candidates = await lookup();
  }
  if (candidates.length === 1 && mtime !== null && candidates[0].mtime === mtime) {
    return { kind: "moved", to: candidates[0].path };
  }
  if (candidates.length > 0) return { kind: "ambiguous", candidates: candidates.map((c) => c.path) };
  return { kind: "gone" };
}
