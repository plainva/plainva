import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * iOS: the databases leave Documents (release list A11). The move runs against
 * two folders in memory that behave as the Filesystem plugin's rename and
 * delete do; each file carries a marker, so a test sees which copy ended up
 * where. What only a device shows - the plugin's own move at launch, the
 * Files app no longer listing the files - is not covered here.
 */

const require = createRequire(import.meta.url);
const platform = vi.hoisted(() => ({ kind: "ios" }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => platform.kind, isNativePlatform: () => platform.kind !== "web" }, registerPlugin: () => ({}) }));

const { moveDatabasesOutOfDocuments, databaseFolderRefusal, deleteClosedDatabase, removeDatabaseLeftovers, resetDatabaseFolderForTests, IOS_DATABASE_FOLDER } = await import("./iosDatabaseFolder");
type DatabaseFolders = import("./iosDatabaseFolder").DatabaseFolders;

class Folders implements DatabaseFolders {
  old = new Map<string, string>();
  new = new Map<string, string>();
  failMove = new Set<string>();
  failRemove = new Set<string>();
  failList = false;
  calls = 0;
  removedNew: string[] = [];
  async listOld() {
    this.calls += 1;
    if (this.failList) throw new Error("readdir failed");
    return [...this.old.keys()];
  }
  failRemoveOld = new Set<string>();
  failExistsOld = new Set<string>();
  failListNew = false;
  async listNew() {
    if (this.failListNew) throw new Error("readdir failed");
    return [...this.new.keys()];
  }
  async existsOld(file: string) {
    if (this.failExistsOld.has(file)) throw Object.assign(new Error("not permitted"), { code: "OS-PLUG-FILE-0007" });
    return this.old.has(file);
  }
  async existsNew(file: string) { return this.new.has(file); }
  async writeNew(file: string, text: string) { this.new.set(file, text); }
  async moveToNew(file: string) {
    if (this.failMove.has(file)) throw new Error(`rename ${file} failed`);
    const data = this.old.get(file);
    if (data === undefined) throw new Error(`no ${file}`);
    if (this.new.has(file)) throw new Error(`${file} exists`);
    this.old.delete(file);
    this.new.set(file, data);
  }
  async removeOld(file: string) {
    if (this.failRemoveOld.has(file)) throw new Error(`remove ${file} failed`);
    this.old.delete(file);
  }
  async removeNew(file: string) {
    if (this.failRemove.has(file)) throw new Error(`remove ${file} failed`);
    this.removedNew.push(file);
    this.new.delete(file);
  }
}

const DB = "plainva-v1SQLite.db";

let folders: Folders;
beforeEach(() => {
  folders = new Folders();
  platform.kind = "ios";
  resetDatabaseFolderForTests();
});

describe("moving the databases out of Documents", () => {
  it("does nothing when there is no database in Documents", async () => {
    folders.old.set("notes.txt", "user");
    folders.new.set(DB, "db");
    const outcome = await moveDatabasesOutOfDocuments(folders);
    expect(outcome).toEqual({ refused: new Set(), unknown: false, unlisted: null });
    expect([...folders.old]).toEqual([["notes.txt", "user"]]);
    expect([...folders.new]).toEqual([[DB, "db"]]);
  });

  it("moves a database with its log and journal, and drops the log's index", async () => {
    folders.old.set(DB, "db").set(`${DB}-wal`, "wal").set(`${DB}-shm`, "shm").set(`${DB}-journal`, "journal");
    const outcome = await moveDatabasesOutOfDocuments(folders);
    expect(outcome.refused.size).toBe(0);
    expect(folders.old.size).toBe(0);
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "db", [`${DB}-wal`]: "wal", [`${DB}-journal`]: "journal" });
  });

  it("brings the log after a database the plugin moved at launch", async () => {
    folders.new.set(DB, "db");
    folders.old.set(`${DB}-wal`, "wal").set(`${DB}-shm`, "shm");
    await moveDatabasesOutOfDocuments(folders);
    expect(folders.old.size).toBe(0);
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "db", [`${DB}-wal`]: "wal" });
  });

  it("keeps the copy in Documents when both places hold the database - only an older build writes there", async () => {
    folders.new.set(DB, "stale").set(`${DB}-wal`, "stale-wal").set(`${DB}-shm`, "stale-shm");
    folders.old.set(DB, "latest").set(`${DB}-wal`, "latest-wal");
    await moveDatabasesOutOfDocuments(folders);
    expect(folders.old.size).toBe(0);
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "latest", [`${DB}-wal`]: "latest-wal" });
  });

  it("refuses a database that could not move, keeps everything, and goes on at the next start", async () => {
    folders.old.set(DB, "db").set(`${DB}-wal`, "wal");
    folders.failMove.add(DB);
    const first = await moveDatabasesOutOfDocuments(folders);
    expect(first.refused).toEqual(new Set(["plainva-v1"]));
    expect(Object.fromEntries(folders.old)).toEqual({ [DB]: "db", [`${DB}-wal`]: "wal" });
    expect(folders.new.size).toBe(0);

    folders.failMove.clear();
    const second = await moveDatabasesOutOfDocuments(folders);
    expect(second.refused.size).toBe(0);
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "db", [`${DB}-wal`]: "wal" });
  });

  it("a start that ends between the database and its log leaves a pair the next start completes", async () => {
    folders.old.set(DB, "db").set(`${DB}-wal`, "wal");
    folders.failMove.add(`${DB}-wal`);
    const first = await moveDatabasesOutOfDocuments(folders);
    expect(first.refused).toEqual(new Set(["plainva-v1"]));
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "db" });

    folders.failMove.clear();
    const second = await moveDatabasesOutOfDocuments(folders);
    expect(second.refused.size).toBe(0);
    expect(folders.old.size).toBe(0);
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "db", [`${DB}-wal`]: "wal" });
  });

  it("never lets a log without its database stand beside a database that moves in", async () => {
    // What a removal that ended between the database and its log left behind.
    folders.new.set(`${DB}-wal`, "foreign-wal").set(`${DB}-shm`, "foreign-shm");
    folders.old.set(DB, "latest");
    await moveDatabasesOutOfDocuments(folders);
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "latest" });
  });

  it("removes a stale copy in the new folder log first, database last", async () => {
    folders.new.set(DB, "stale").set(`${DB}-wal`, "stale-wal").set(`${DB}-shm`, "stale-shm").set(`${DB}-journal`, "stale-journal");
    folders.old.set(DB, "latest");
    await moveDatabasesOutOfDocuments(folders);
    expect(folders.removedNew[folders.removedNew.length - 1]).toBe(DB);
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "latest" });
  });

  it("a removal of the stale copy that ends half way keeps the stale database, and the next start finishes", async () => {
    folders.new.set(DB, "stale").set(`${DB}-wal`, "stale-wal");
    folders.old.set(DB, "latest").set(`${DB}-wal`, "latest-wal");
    folders.failRemove.add(DB);
    expect((await moveDatabasesOutOfDocuments(folders)).refused).toEqual(new Set(["plainva-v1"]));
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "stale" });
    expect(Object.fromEntries(folders.old)).toEqual({ [DB]: "latest", [`${DB}-wal`]: "latest-wal" });

    folders.failRemove.clear();
    await moveDatabasesOutOfDocuments(folders);
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "latest", [`${DB}-wal`]: "latest-wal" });
  });

  it("keeps a database closed whose foreign log could not be removed", async () => {
    folders.new.set(`${DB}-wal`, "foreign-wal");
    folders.old.set(DB, "latest");
    folders.failRemove.add(`${DB}-wal`);
    expect((await moveDatabasesOutOfDocuments(folders)).refused).toEqual(new Set(["plainva-v1"]));
    expect(Object.fromEntries(folders.old)).toEqual({ [DB]: "latest" });
  });

  it("a failed check of the new folder leaves the log in Documents", async () => {
    folders.new.set(DB, "db");
    folders.old.set(`${DB}-wal`, "wal");
    folders.existsNew = async () => { throw Object.assign(new Error("not permitted"), { code: "OS-PLUG-FILE-0007" }); };
    expect((await moveDatabasesOutOfDocuments(folders)).refused).toEqual(new Set(["plainva-v1"]));
    expect(Object.fromEntries(folders.old)).toEqual({ [`${DB}-wal`]: "wal" });
  });

  it("removes a log whose database is nowhere, and a stale log beside a database that has its own", async () => {
    folders.old.set("plainva-goneSQLite.db-wal", "orphan").set("plainva-goneSQLite.db-shm", "orphan");
    folders.new.set(DB, "db").set(`${DB}-wal`, "own");
    folders.old.set(`${DB}-wal`, "stale");
    await moveDatabasesOutOfDocuments(folders);
    expect(folders.old.size).toBe(0);
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "db", [`${DB}-wal`]: "own" });
  });

  it("refuses every database when its own folder cannot be listed", async () => {
    folders.failListNew = true;
    expect((await moveDatabasesOutOfDocuments(folders)).unknown).toBe(true);
  });

  it("leaves files that are no database alone", async () => {
    folders.old.set("recovery.pdf", "user").set("plainva.db", "user").set(DB, "db");
    await moveDatabasesOutOfDocuments(folders);
    expect(Object.fromEntries(folders.old)).toEqual({ "recovery.pdf": "user", "plainva.db": "user" });
  });
});

describe("after a database was deleted", () => {
  it("removes the files left beside it", async () => {
    // The move ran at the start of this lifetime, before the database was deleted.
    await databaseFolderRefusal("plainva-v1", folders);
    folders.new.set(`${DB}-wal`, "wal").set(`${DB}-shm`, "shm").set(`${DB}-journal`, "journal").set("plainva-v2SQLite.db-wal", "other");
    await removeDatabaseLeftovers("plainva-v1", folders);
    expect([...folders.new.keys()]).toEqual(["plainva-v2SQLite.db-wal"]);
  });

  it("keeps the name closed when they cannot be removed", async () => {
    folders.new.set(`${DB}-wal`, "wal");
    await databaseFolderRefusal("plainva-v1", folders);
    folders.new.set(`${DB}-wal`, "wal");
    folders.failRemove.add(`${DB}-wal`);
    await expect(removeDatabaseLeftovers("plainva-v1", folders)).rejects.toThrow();
    expect(await databaseFolderRefusal("plainva-v1", folders)).toBeInstanceOf(Error);
  });

  it("does nothing on Android, which removes them itself", async () => {
    platform.kind = "android";
    folders.new.set(`${DB}-wal`, "wal");
    await removeDatabaseLeftovers("plainva-v1", folders);
    expect(folders.new.size).toBe(1);
  });
});

describe("the refusal before a database opens", () => {
  it("moves once per lifetime and refuses only the database that could not move", async () => {
    folders.old.set(DB, "db").set(`${DB}-wal`, "wal").set("plainva-v2SQLite.db", "db2");
    folders.failMove.add(DB);
    expect(await databaseFolderRefusal("plainva-v1", folders)).toBeInstanceOf(Error);
    expect(await databaseFolderRefusal("plainva-v2", folders)).toBeNull();
    expect(folders.calls).toBe(1);
  });

  it("opens every database whose own files it can ask for when Documents could not be listed (F43)", async () => {
    // Documents is shared with the Files app: one entry it cannot list must not close every database.
    folders.failList = true;
    folders.old.set(DB, "db").set(`${DB}-wal`, "wal").set(`${DB}-shm`, "shm");
    folders.failExistsOld.add("plainva-v2SQLite.db");
    expect(await databaseFolderRefusal("plainva-index", folders)).toBeNull();
    expect(await databaseFolderRefusal("plainva-v1", folders)).toBeNull();
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "db", [`${DB}-wal`]: "wal" });
    expect(folders.old.size).toBe(0);
    // Only the database whose own files cannot be asked for stays closed.
    expect(await databaseFolderRefusal("plainva-v2", folders)).toBeInstanceOf(Error);
  });

  it.each(["android", "web"])("moves nothing on %s", async (kind) => {
    platform.kind = kind;
    folders.old.set(DB, "db");
    expect(await databaseFolderRefusal("plainva-v1", folders)).toBeNull();
    expect(folders.calls).toBe(0);
  });

  it("the plugin is configured with the folder the move fills", () => {
    const config = readFileSync(new URL("../../capacitor.config.ts", import.meta.url), "utf8");
    expect(config).toContain(`iosDatabaseLocation: "Library/${IOS_DATABASE_FOLDER}"`);
  });

  it("the app makes the folder before the plugin loads, and keeps it in the backup", () => {
    // Capacitor 8: `CAPBridgeViewController.loadView()` asks `instanceDescriptor()`
    // first and creates the bridge after it; the bridge's initialiser runs every
    // plugin's `load()`, where the SQLite plugin makes a missing folder and
    // excludes it from the backup. Swift does not compile here: the iOS build
    // in CI is the proof that it compiles, this is the proof it is wired.
    const swift = readFileSync(new URL("../../ios/App/App/MainViewController.swift", import.meta.url), "utf8");
    const override = swift.match(/override open func instanceDescriptor\(\) -> InstanceDescriptor \{([^}]*)\}/);
    expect(override?.[1]).toMatch(/DatabaseFolder\.prepare\(\)\s*return super\.instanceDescriptor\(\)/);
    expect(swift).toContain(`static let name = "${IOS_DATABASE_FOLDER}"`);
    expect(swift).toContain(".libraryDirectory");
    expect(swift).toMatch(/createDirectory\(at: folder, withIntermediateDirectories: true\)/);
    expect(swift).toMatch(/isExcludedFromBackup = false[\s\S]*setResourceValues/);
    const loadView = readFileSync(require.resolve("@capacitor/ios/Capacitor/Capacitor/CAPBridgeViewController.swift", { paths: [new URL("../..", import.meta.url).pathname] }), "utf8");
    const body = loadView.slice(loadView.indexOf("func loadView()"));
    expect(body.indexOf("instanceDescriptor()")).toBeGreaterThan(-1);
    expect(body.indexOf("instanceDescriptor()")).toBeLessThan(body.indexOf("CapacitorBridge(with:"));
  });
});

/** Every operation, with the lifetime ending at operation `crashAt` (the app is ended there). */
function crashing(source: Folders, crashAt: number): DatabaseFolders & { ops: number } {
  const wrapped = { ops: 0 } as DatabaseFolders & { ops: number };
  for (const name of ["listOld", "listNew", "existsOld", "existsNew", "moveToNew", "removeOld", "removeNew", "writeNew"] as const) {
    (wrapped as unknown as Record<string, unknown>)[name] = async (...args: unknown[]) => {
      wrapped.ops += 1;
      if (crashAt >= 0 && wrapped.ops >= crashAt) throw new Error("the app was ended");
      return (source[name] as unknown as (...a: unknown[]) => Promise<unknown>).apply(source, args);
    };
  }
  return wrapped;
}

describe("deleting a database that is closed (F43)", () => {
  it("deletes it where it lies, so the next start does not bring it back", async () => {
    folders.old.set(DB, "db").set(`${DB}-wal`, "wal");
    folders.failMove.add(DB);
    expect(await databaseFolderRefusal("plainva-v1", folders)).toBeInstanceOf(Error);
    await deleteClosedDatabase("plainva-v1", folders);
    expect(folders.old.size).toBe(0);
    expect(folders.new.size).toBe(0);
    // The name is free again: a new database of it may open.
    expect(await databaseFolderRefusal("plainva-v1", folders)).toBeNull();

    resetDatabaseFolderForTests();
    folders.failMove.clear();
    expect(await databaseFolderRefusal("plainva-v1", folders)).toBeNull();
    expect(folders.new.size).toBe(0);
  });

  it("finishes a deletion that could not finish at the next start, before anything moves", async () => {
    folders.old.set(DB, "db").set(`${DB}-wal`, "wal");
    folders.failMove.add(DB);
    folders.failRemoveOld.add(DB);
    await expect(deleteClosedDatabase("plainva-v1", folders)).rejects.toThrow();
    expect(await databaseFolderRefusal("plainva-v1", folders)).toBeInstanceOf(Error);

    resetDatabaseFolderForTests();
    folders.failMove.clear();
    folders.failRemoveOld.clear();
    expect(await databaseFolderRefusal("plainva-v1", folders)).toBeNull();
    expect(folders.old.size).toBe(0);
    expect(folders.new.size).toBe(0);
  });

  it("never brings a deleted database back, wherever the deletion ends", async () => {
    const fresh = () => {
      const f = new Folders();
      f.old.set(DB, "db").set(`${DB}-wal`, "wal").set(`${DB}-shm`, "shm");
      f.new.set(`${DB}-journal`, "stale");
      return f;
    };
    const count = fresh();
    count.failMove.add(DB);
    const total = crashing(count, -1);
    await databaseFolderRefusal("plainva-v1", total);
    await deleteClosedDatabase("plainva-v1", total);
    for (let crashAt = 1; crashAt <= total.ops + 1; crashAt += 1) {
      const f = fresh();
      f.failMove.add(DB);
      resetDatabaseFolderForTests();
      const run = crashing(f, crashAt);
      // The database is closed first (its move fails), only then deleted.
      if (await databaseFolderRefusal("plainva-v1", run).catch(() => new Error("ended"))) await deleteClosedDatabase("plainva-v1", run).catch(() => {});
      // Whatever ended there, the next start is undisturbed.
      resetDatabaseFolderForTests();
      f.failMove.clear();
      const outcome = await databaseFolderRefusal("plainva-v1", f);
      const left = { old: [...f.old.keys()], new: [...f.new.keys()] };
      if (left.new.length === 0 && left.old.length === 0) continue;
      // Ended before the deletion was marked: nothing was deleted yet, and nothing was lost.
      expect({ crashAt, outcome, left }).toEqual({ crashAt, outcome: null, left: { old: [], new: [DB, `${DB}-wal`] } });
      expect(f.new.get(DB)).toBe("db");
    }
  });

  it("puts a database in place by name wherever that start ends, and loses nothing", async () => {
    const fresh = () => {
      const f = new Folders();
      f.failList = true;
      f.old.set(DB, "db").set(`${DB}-wal`, "wal").set(`${DB}-shm`, "shm");
      return f;
    };
    const total = crashing(fresh(), -1);
    await databaseFolderRefusal("plainva-v1", total);
    for (let crashAt = 1; crashAt <= total.ops + 1; crashAt += 1) {
      const f = fresh();
      resetDatabaseFolderForTests();
      await databaseFolderRefusal("plainva-v1", crashing(f, crashAt)).catch(() => {});
      resetDatabaseFolderForTests();
      expect({ crashAt, refusal: await databaseFolderRefusal("plainva-v1", f) }).toEqual({ crashAt, refusal: null });
      expect({ crashAt, old: [...f.old.keys()], db: f.new.get(DB), wal: f.new.get(`${DB}-wal`) }).toEqual({ crashAt, old: [], db: "db", wal: "wal" });
    }
  });
});
