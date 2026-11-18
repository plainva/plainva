import { appDataDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import Database from "@tauri-apps/plugin-sql";
import { readFile, readTextFile, writeFile, writeTextFile, exists as fsExists, mkdir, readDir, remove, rename, stat } from "@tauri-apps/plugin-fs";
import { initializeSchema } from "@plainva/core";
import { finishSetAside, hasSetAside, SET_ASIDE_MARKER, setAsideIndexDatabase, type IndexDatabaseFiles } from "@plainva/ui";
import { TauriDatabaseAdapter } from "../adapters/TauriDatabaseAdapter";
import { indexDbFileName } from "./indexDbPath";

/**
 * The vault's index database, opened (`openIndexDatabase`), and set aside when
 * it is damaged (`setAsideDesktopIndexDatabase`, the start's "Rebuild index").
 */

/** The index database of a vault did not open; `url` names it, `cause` says why (`indexDatabaseFailureKind`). */
export class IndexDatabaseOpenError extends Error {
  constructor(readonly url: string, readonly cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "IndexDatabaseOpenError";
  }
}

/**
 * Opens the index database of a vault and brings its schema up to date. A
 * database that does not open throws `IndexDatabaseOpenError` with its URL —
 * and leaves no pool behind on the file: the driver keeps a pool per URL that
 * opened before a later statement failed, and on Windows an open file cannot
 * be set aside.
 */
export async function openIndexDatabase(vaultPath: string): Promise<{ dbPath: string; dbAdapter: TauriDatabaseAdapter }> {
  const dbPath = await resolveIndexDbUrl(vaultPath);
  const dbAdapter = new TauriDatabaseAdapter(dbPath);
  try {
    // A set-aside that stopped half-way is finished first: the database never opens without its log.
    await finishSetAside(desktopIndexFiles, dbPath.replace(/^sqlite:/, ""));
    await dbAdapter.initialize();
    await initializeSchema(dbAdapter);
  } catch (cause) {
    await dbAdapter.close().catch(() => {});
    throw new IndexDatabaseOpenError(dbPath, cause);
  }
  return { dbPath, dbAdapter };
}

/**
 * Sets the damaged index database at `url` aside (`<file>.broken-<time>`, its
 * companions with it) and leaves an empty one in its place; the next open of
 * the vault builds its index anew, as on a device that never saw it.
 * Whatever still holds the file is closed first: the driver's pool for the
 * URL and the idle connection the transactions run on (`db_tx.rs`).
 */
export async function setAsideDesktopIndexDatabase(url: string): Promise<string> {
  const file = url.replace(/^sqlite:/, "");
  await Promise.resolve().then(() => Database.get(url).close()).catch(() => {});
  await invoke("db_tx_close", { dbPath: url }).catch(() => {});
  return setAsideIndexDatabase(desktopIndexFiles, file);
}

/** Whether the index database at `url` was set aside here before: the one there now was built anew (`restoreDesktopAccountsAfterRebuild`). */
export async function indexDatabaseWasRebuilt(url: string): Promise<boolean> {
  const file = url.replace(/^sqlite:/, "");
  return (await desktopIndexFiles.listStartingWith(file + SET_ASIDE_MARKER).catch(() => [])).length > 0;
}

/** The index databases' files as the desktop reaches them (`IndexDatabaseFiles`). */
const desktopIndexFiles: IndexDatabaseFiles = {
  exists: (path) => fsExists(path),
  rename: (from, to) => rename(from, to),
  async writeEmpty(path) {
    try {
      // Never over a database there: another window's run may have made it and opened it.
      await writeFile(path, new Uint8Array(), { createNew: true });
    } catch (error) {
      if (await fsExists(path)) return;
      throw error;
    }
  },
  async listStartingWith(prefix) {
    const cut = prefix.lastIndexOf("/");
    const dir = prefix.slice(0, cut);
    const start = prefix.slice(cut + 1);
    const entries = await readDir(dir).catch(() => []);
    return entries.filter((entry) => entry.name.startsWith(start)).map((entry) => `${dir}/${entry.name}`);
  },
  remove: (path) => remove(path),
  readText: async (path) => ((await fsExists(path)) ? readTextFile(path) : null),
  async writeText(path, text, options) {
    try {
      await writeTextFile(path, text, options?.exclusive ? { createNew: true } : undefined);
      return true;
    } catch (error) {
      // Created first by another window's run (`createNew`).
      if (options?.exclusive && (await fsExists(path))) return false;
      throw error;
    }
  },
  async modifiedAt(path) {
    const info = await stat(path).catch(() => null);
    return info?.mtime ? new Date(info.mtime).getTime() : null;
  },
};

/**
 * Resolves the index-DB sqlite URL (WP5 5b). The SQLite index used to live in
 * `<vault>/.plainva/vault.db`; on a network-drive vault the ~10 index statements
 * per save were network round-trips (the sqlx pool forbids batching them into
 * one transaction), which made saving very slow. The index now lives in the OS
 * app-data dir — only the DB moves, backups stay in the vault.
 *
 * When an existing in-vault DB is found, we migrate it (copy the DB + WAL/SHM
 * sidecars) so the index AND the sync state carry over untouched — no reindex,
 * no spurious `.CONFLICT`. CRITICAL: we only switch to the app-data DB when that
 * migration actually succeeds (or there is no old DB = a genuinely new vault).
 * If the copy fails, we keep using the WARM in-vault DB instead of pointing at a
 * fresh, empty app-data DB — otherwise a failed copy would silently trigger a
 * full re-index of the whole vault on startup, and repeat it every launch.
 *
 * A database set aside here (`setAsideDesktopIndexDatabase`) is never followed
 * by the in-vault copy: that one is older still, and a stop between setting
 * the damaged one aside and writing the empty one must not bring it back.
 */
export async function resolveIndexDbUrl(vaultPath: string): Promise<string> {
  const oldAbs = `${vaultPath}/.plainva/vault.db`;
  try {
    const dataDir = await appDataDir();
    const dir = `${dataDir}/index`;
    await mkdir(dir, { recursive: true });
    const fileName = await indexDbFileName(vaultPath);
    const newAbs = `${dir}/${fileName}`;

    // Already relocated (or a fresh vault whose DB was created here before): use it.
    if (await fsExists(newAbs)) return `sqlite:${newAbs}`;

    // No in-vault DB -> genuinely new vault: create the index in app-data (it is
    // indexed once, which is correct for a new vault).
    if (!(await fsExists(oldAbs))) return `sqlite:${newAbs}`;

    // Set aside here before: a new index, not the old in-vault one.
    const names = await readDir(dir).then((entries) => entries.map((entry) => entry.name), () => [] as string[]);
    if (hasSetAside(names, fileName)) return `sqlite:${newAbs}`;

    // Migrate the (closed) in-vault DB. The MAIN .db copy must succeed to reuse
    // the warm index; on failure keep the in-vault DB (warm, no reindex) rather
    // than falling through to an empty app-data DB.
    try {
      await writeFile(newAbs, await readFile(oldAbs));
    } catch (e) {
      console.warn("[VaultContext] index DB migration failed; keeping the in-vault DB (no reindex)", e);
      return `sqlite:${oldAbs}`;
    }
    // Sidecars are best-effort: copying the WAL/SHM avoids losing an
    // un-checkpointed tail, but a miss only costs a few files the next save
    // reconciles — it must not undo the successful main copy above.
    for (const suffix of ["-wal", "-shm"]) {
      try {
        if (await fsExists(oldAbs + suffix)) await writeFile(newAbs + suffix, await readFile(oldAbs + suffix));
      } catch (e) {
        console.warn(`[VaultContext] index DB sidecar ${suffix} copy failed; continuing`, e);
      }
    }
    return `sqlite:${newAbs}`;
  } catch (e) {
    console.warn("[VaultContext] app-data index path unavailable; keeping the in-vault DB", e);
    return `sqlite:${oldAbs}`;
  }
}
