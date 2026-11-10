import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { phoneSqlite } from "../../../../packages/core/test/helpers/phoneSqlitePlugin";

/**
 * The phone's database writes through a write-ahead log (performance plan L4,
 * finding B5; `sqliteConnections.ts`).
 *
 * Two halves. The plugin's side, over the stand-in of `phoneSqlitePlugin.ts`:
 * every database is put into WAL with `synchronous = NORMAL` when it opens,
 * and a database is deleted even when nobody has it open - the vault being
 * deleted has been closed by then, and the plugin deletes only a database it
 * has a connection for. SQLite's side, on a real file: what the phone relies
 * on when the app is killed in the middle of a write, and that leaving the log
 * removes both of its files.
 */

vi.mock("@capacitor-community/sqlite", async () => (await import("../../../../packages/core/test/helpers/phoneSqlitePlugin")).phoneSqlite.module);

const { CapacitorSqliteAdapter } = await import("./CapacitorSqliteAdapter");
const { resetDatabasesForTests } = await import("./sqliteConnections");

beforeEach(() => {
  phoneSqlite.reset();
  resetDatabasesForTests();
});

describe("the phone's databases and the write-ahead log", () => {
  it.each(["android", "ios"] as const)("asks for WAL and NORMAL syncing at every open (%s)", async (platform) => {
    phoneSqlite.as(platform);
    const db = new CapacitorSqliteAdapter("plainva-wal");
    await db.initialize();
    const opened = phoneSqlite.log.indexOf("open");
    expect(phoneSqlite.log.slice(opened, opened + 3)).toEqual(["open", "query", "query"]);
    await db.close();
  });

  it.each(["android", "ios"] as const)("deletes a vault's index that is no longer open (%s)", async (platform) => {
    phoneSqlite.as(platform);
    const db = new CapacitorSqliteAdapter("plainva-gone");
    await db.initialize();
    await db.execute("CREATE TABLE t (k TEXT)");
    await db.execute("INSERT INTO t (k) VALUES ('note text')");
    await db.close();

    await CapacitorSqliteAdapter.deleteDatabase("plainva-gone");

    const again = new CapacitorSqliteAdapter("plainva-gone");
    await again.initialize();
    await expect(again.query("SELECT k FROM t")).rejects.toThrow(/no such table/);
    await again.close();
    expect(phoneSqlite.isOpen("plainva-gone")).toBe(false);
  });

  it("deletes an index that is still open", async () => {
    const db = new CapacitorSqliteAdapter("plainva-open");
    await db.initialize();
    await db.execute("CREATE TABLE t (k TEXT)");
    await CapacitorSqliteAdapter.deleteDatabase("plainva-open");
    expect(phoneSqlite.isOpen("plainva-open")).toBe(false);
  });
});

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

describe("SQLite's write-ahead log on a real file", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "plainva-wal-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("an app killed in the middle of a write comes back with what was committed, and intact", () => {
    const file = join(dir, "index.db").replace(/\\/g, "/");
    // A child process that commits 50 rows, then dies inside an open transaction
    // of 50 more - as the app does when the system ends it mid-write.
    const script = `
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(${JSON.stringify(file)});
      db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;");
      db.exec("CREATE TABLE t (k INTEGER)");
      for (let i = 0; i < 50; i++) db.exec("INSERT INTO t (k) VALUES (" + i + ")");
      db.exec("BEGIN");
      for (let i = 50; i < 100; i++) db.exec("INSERT INTO t (k) VALUES (" + i + ")");
      process.kill(process.pid, "SIGKILL");
    `;
    const child = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    expect(child.status === 0).toBe(false);
    expect(existsSync(`${file}-wal`)).toBe(true);

    const db = new DatabaseSync(file);
    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.prepare("SELECT COUNT(*) AS n FROM t").get()).toEqual({ n: 50 });
    // Leaving the log - what a deletion does first - folds it in and removes its files.
    expect(db.prepare("PRAGMA journal_mode = DELETE").get()).toEqual({ journal_mode: "delete" });
    db.close();
    expect(existsSync(`${file}-wal`)).toBe(false);
    expect(existsSync(`${file}-shm`)).toBe(false);
    const reopened = new DatabaseSync(file);
    expect(reopened.prepare("SELECT COUNT(*) AS n FROM t").get()).toEqual({ n: 50 });
    reopened.close();
  });
});
