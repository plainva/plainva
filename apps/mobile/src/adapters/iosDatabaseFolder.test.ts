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

const { moveDatabasesOutOfDocuments, databaseFolderRefusal, removeDatabaseLeftovers, resetDatabaseFolderForTests, IOS_DATABASE_FOLDER } = await import("./iosDatabaseFolder");
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
  async listNew() { return [...this.new.keys()]; }
  async existsNew(file: string) { return this.new.has(file); }
  async moveToNew(file: string) {
    if (this.failMove.has(file)) throw new Error(`rename ${file} failed`);
    const data = this.old.get(file);
    if (data === undefined) throw new Error(`no ${file}`);
    if (this.new.has(file)) throw new Error(`${file} exists`);
    this.old.delete(file);
    this.new.set(file, data);
  }
  async removeOld(file: string) { this.old.delete(file); }
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
    expect(outcome).toEqual({ refused: new Set(), unknown: false });
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

  it("refuses every database when a folder cannot be listed", async () => {
    folders.failList = true;
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

  it("refuses every name when Documents could not be read", async () => {
    folders.failList = true;
    expect(await databaseFolderRefusal("plainva-index", folders)).toBeInstanceOf(Error);
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
