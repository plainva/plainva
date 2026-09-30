import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { migratePathIdentity, type PathIdentityReport } from "../src/db/pathIdentityMigration.js";

/**
 * ADR 0016, the migration at first start: the index, the sync state, the
 * offline queue and the other path-keyed tables move to NFC keys. Nothing is
 * merged; a pair that would collapse into one key is kept and left to the
 * sync to report. One transaction, so an interrupted run changes nothing and
 * the next start does it again.
 */

const NFC = "Neutralität".normalize("NFC");
const NFD = NFC.normalize("NFD");

describe("path identity migration (ADR 0016)", () => {
  let db: IDatabaseAdapter;
  beforeEach(async () => {
    expect(NFC).not.toBe(NFD);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    db = await realSqlite();
    // realSqlite ran the schema, including the migration on an empty
    // database; pretend these rows were written by an older version.
    await db.execute(`DELETE FROM meta WHERE key = 'path_identity_version'`);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
  });

  const paths = async (sql: string) => (await db.query<{ p: string }>(sql)).map((r) => r.p).sort();
  const file = (p: string, id = p) => db.execute(
    `INSERT INTO files (id, path, title, sha256, mtime_local, size_bytes, is_cached, mode, sync_state) VALUES (?, ?, 't', 's', 5, 1, 1, 'note', 'synced')`,
    [id, p],
  );
  const state = (p: string, etag: string) => db.execute(
    `INSERT INTO sync_state (path, local_sha256, remote_etag, base_sha256) VALUES (?, 'h', ?, 'h')`, [p, etag],
  );

  it("re-keys every table to NFC when there is no twin", async () => {
    await file(`${NFD}/a.md`);
    await db.execute(`INSERT INTO fts_notes (content, title, path) VALUES ('x', 'a', ?)`, [`${NFD}/a.md`]);
    await state(`${NFD}/a.md`, "e1");
    await db.execute(`INSERT INTO offline_queue (file_path, operation, queued_at) VALUES (?, 'write', 1)`, [`${NFD}/a.md`]);
    await db.execute(`INSERT INTO offline_queue (file_path, operation, new_path, queued_at) VALUES (?, 'rename', ?, 2)`, [`${NFD}/a.md`, `${NFD}/b.md`]);
    await db.execute(`INSERT INTO conflicts (id, file_path) VALUES ('c1', ?)`, [`${NFD}/a.md`]);
    await db.execute(`INSERT INTO pim_task_state (account_id, list_id, uid, note_path) VALUES ('a', 'l', 'u', ?)`, [`${NFD}/a.md`]);
    await db.execute(`INSERT INTO workspace_local_probe (path, mtime, size, plaintext_sha256) VALUES (?, 1, 1, 'h')`, [`${NFD}/a.md`]);

    const report = (await migratePathIdentity(db))!;

    expect(await paths(`SELECT path AS p FROM files`)).toEqual([`${NFC}/a.md`]);
    expect(await paths(`SELECT path AS p FROM fts_notes`)).toEqual([`${NFC}/a.md`]);
    expect(await paths(`SELECT path AS p FROM sync_state`)).toEqual([`${NFC}/a.md`]);
    expect(await paths(`SELECT file_path || ' ' || operation || COALESCE(' -> ' || new_path, '') AS p FROM offline_queue`)).toEqual(
      [`${NFC}/a.md rename -> ${NFC}/b.md`, `${NFC}/a.md write`],
    );
    expect(await paths(`SELECT file_path AS p FROM conflicts`)).toEqual([`${NFC}/a.md`]);
    expect(await paths(`SELECT note_path AS p FROM pim_task_state`)).toEqual([`${NFC}/a.md`]);
    // A cache: an old spelling is re-read, not re-keyed.
    expect(await paths(`SELECT path AS p FROM workspace_local_probe`)).toEqual([]);
    expect(report.twinsKept).toEqual([]);
    expect(report.droppedDeletes).toEqual([]);
    expect(report.rekeyed).toBeGreaterThanOrEqual(6);
    // The index keeps its row: same file, same mtime, nothing to re-read.
    expect(await db.queryOne<{ id: string; mtime_local: number }>(`SELECT id, mtime_local FROM files`)).toEqual({ id: `${NFD}/a.md`, mtime_local: 5 });
  });

  it("keeps a pair of sync rows apart instead of merging them, and drops the misread DELETE", async () => {
    // The #112 state on the Mac: the index read the folder decomposed, the
    // pull wrote the sync row composed, the "new" decomposed file got its own
    // row, and the composed one was queued for deletion as "gone".
    await file(`${NFD}/a.md`);
    await state(`${NFC}/a.md`, "e-server");
    await state(`${NFD}/a.md`, "e-twin");
    await db.execute(`INSERT INTO offline_queue (file_path, operation, queued_at) VALUES (?, 'delete', 1)`, [`${NFC}/a.md`]);
    await db.execute(`INSERT INTO offline_queue (file_path, operation, queued_at) VALUES (?, 'write', 2)`, [`${NFD}/a.md`]);
    await db.execute(`INSERT INTO offline_queue (file_path, operation, queued_at) VALUES ('Other/gone.md', 'delete', 3)`);

    const report = (await migratePathIdentity(db))!;

    expect(await paths(`SELECT path || ' ' || remote_etag AS p FROM sync_state`)).toEqual(
      [`${NFC}/a.md e-server`, `${NFD}/a.md e-twin`].sort(),
    );
    expect(report.twinsKept).toEqual([`${NFD}/a.md`]);
    expect(report.droppedDeletes).toEqual([`${NFC}/a.md`]);
    // The upload goes to the composed identity; an unrelated DELETE stays.
    expect(await paths(`SELECT operation || ' ' || file_path AS p FROM offline_queue`)).toEqual(
      [`delete Other/gone.md`, `write ${NFC}/a.md`],
    );
    expect(await paths(`SELECT path AS p FROM files`)).toEqual([`${NFC}/a.md`]);
  });

  it("drops the derived index row of a spelling whose composed form is indexed too", async () => {
    await file(`${NFC}/a.md`);
    await file(`${NFD}/a.md`);
    await db.execute(`INSERT INTO fts_notes (content, title, path) VALUES ('x', 'a', ?), ('y', 'a', ?)`, [`${NFC}/a.md`, `${NFD}/a.md`]);
    const report = (await migratePathIdentity(db))!;
    expect(await paths(`SELECT path AS p FROM files`)).toEqual([`${NFC}/a.md`]);
    expect(await paths(`SELECT path AS p FROM fts_notes`)).toEqual([`${NFC}/a.md`]);
    expect(report.droppedIndexRows).toBe(2);
  });

  it("runs once, and a second run changes nothing", async () => {
    await state(`${NFD}/a.md`, "e1");
    expect(await migratePathIdentity(db)).not.toBeNull();
    expect(await migratePathIdentity(db)).toBeNull();
    await db.execute(`DELETE FROM meta WHERE key = 'path_identity_version'`);
    const again = (await migratePathIdentity(db)) as PathIdentityReport;
    expect(again.rekeyed).toBe(0);
    expect(await paths(`SELECT path AS p FROM sync_state`)).toEqual([`${NFC}/a.md`]);
  });

  it("leaves everything as it was when interrupted, and finishes on the next start", async () => {
    await file(`${NFD}/a.md`);
    await state(`${NFD}/a.md`, "e1");
    const failing: IDatabaseAdapter = {
      ...db,
      transaction: db.transaction.bind(db),
      query: db.query.bind(db),
      queryOne: db.queryOne.bind(db),
      execute: async (sql: string, params?: any) => {
        if (sql.startsWith("UPDATE sync_state")) throw new Error("app killed");
        return db.execute(sql, params);
      },
    };
    await expect(migratePathIdentity(failing)).rejects.toThrow("app killed");
    expect(await paths(`SELECT path AS p FROM files`)).toEqual([`${NFD}/a.md`]);
    expect(await paths(`SELECT path AS p FROM sync_state`)).toEqual([`${NFD}/a.md`]);

    await migratePathIdentity(db);
    expect(await paths(`SELECT path AS p FROM files`)).toEqual([`${NFC}/a.md`]);
    expect(await paths(`SELECT path AS p FROM sync_state`)).toEqual([`${NFC}/a.md`]);
  });
});
