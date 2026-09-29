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

/**
 * What the index knew about a file: its content hash and modification time.
 * An open note keeps the pair from its last load or save, because by the time
 * it learns that its file vanished, the watcher or a reconcile has usually
 * removed the row that carried it (issue #110, E9).
 */
export interface KnownFileIdentity {
  sha256: string | null;
  mtime: number | null;
}

/** The identity the index holds for `path`, or null without a row. */
export async function readIndexedIdentity(db: Pick<IDatabaseAdapter, "queryOne">, path: string): Promise<KnownFileIdentity | null> {
  const row = await db.queryOne<{ sha256: string | null; mtime_local: number | null }>(
    `SELECT sha256, mtime_local FROM files WHERE path = ?`,
    [path],
  );
  return row ? { sha256: row.sha256 ?? null, mtime: mtimeOf(row.mtime_local) } : null;
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
 * A search in two stages: the first answer comes from the parent folder and
 * the index as it stands, the settled one after a full reconcile of the vault.
 */
export interface MissingFileSearch {
  /** Shown at once. */
  first: MissingFileOutcome;
  /**
   * The answer after one full reconcile, or null when `first` is already
   * certain. A move nobody watched is only found by that pass, and on 3 000
   * notes it takes about a second (plan section 6) — so it runs behind the
   * first answer instead of in front of it, and the surface updates.
   */
  settled: Promise<MissingFileOutcome> | null;
}

/**
 * Looks for the note behind a missing path by its content hash — the one the
 * index already stored for it (sha256). Order matters and is deliberate:
 *
 *  1. Existence is PROVEN first. A read can fail for many reasons; only a
 *     missing file is healed, and a check that fails decides nothing.
 *  2. Hash and modification time are read BEFORE anything reconciles, because
 *     the reconcile removes the very row that carries them. `known` stands in
 *     for the row when a watcher or reconcile already removed it — the case of
 *     a note that is open while its file is moved.
 *  3. The parent folder is reconciled flat: the stale row goes, and a rename
 *     inside the same folder is indexed on the spot.
 *  4. Candidates are indexed files with the same hash that exist on disk.
 *  5. The same content alone does not prove a move: two untouched notes from
 *     one template, or a copy made last week, carry the same hash. A move
 *     keeps the file's modification time, so only a single candidate that also
 *     has the missing note's time is followed; any other single candidate is
 *     offered. Following the wrong file is the one mistake this must not make.
 *  6. Anything short of that certainty gets a second look after one full
 *     reconcile: the move may have happened while nobody was watching, and
 *     the list of candidates may be incomplete.
 */
export async function searchMissingFile(path: string, deps: MissingFileDeps, known?: KnownFileIdentity | null): Promise<MissingFileSearch> {
  let present: boolean;
  try {
    present = await deps.exists(path);
  } catch {
    return { first: { kind: "present" }, settled: null };
  }
  if (present) return { first: { kind: "present" }, settled: null };

  const row = await readIndexedIdentity(deps.db, path);
  const hash = row?.sha256 ?? known?.sha256 ?? null;
  const mtime = row ? row.mtime : (known?.mtime ?? null);

  await deps.indexer.reconcileFolder(parentOf(path), { recursive: false });
  if (!hash || hash === EMPTY_SHA256) return { first: { kind: "gone" }, settled: null };

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
  const decide = (candidates: Array<{ path: string; mtime: number | null }>): MissingFileOutcome => {
    if (candidates.length === 1 && mtime !== null && candidates[0].mtime === mtime) return { kind: "moved", to: candidates[0].path };
    if (candidates.length > 0) return { kind: "ambiguous", candidates: candidates.map((c) => c.path) };
    return { kind: "gone" };
  };

  const first = decide(await lookup());
  if (first.kind === "moved") return { first, settled: null };
  const settled = (async () => {
    await deps.indexer.indexVaultFull();
    return decide(await lookup());
  })();
  return { first, settled };
}

/** The settled answer of `searchMissingFile`, for callers that can wait. */
export async function resolveMissingFile(path: string, deps: MissingFileDeps, known?: KnownFileIdentity | null): Promise<MissingFileOutcome> {
  const { first, settled } = await searchMissingFile(path, deps, known);
  return settled ? await settled : first;
}
