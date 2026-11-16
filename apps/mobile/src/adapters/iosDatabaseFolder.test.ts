import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * iOS: the databases leave Documents (release list A11). The move runs against
 * two folders in memory that behave as the Filesystem plugin's rename and
 * delete do; each file carries a marker, so a test sees which copy ended up
 * where. What only a device shows - the plugin's own move at launch, the
 * Files app no longer listing the files - is not covered here.
 */

const platform = vi.hoisted(() => ({ kind: "ios" }));
vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => platform.kind, isNativePlatform: () => platform.kind !== "web" }, registerPlugin: () => ({}) }));

const { moveDatabasesOutOfDocuments, databaseFolderRefusal, resetDatabaseFolderForTests, IOS_DATABASE_FOLDER } = await import("./iosDatabaseFolder");
type DatabaseFolders = import("./iosDatabaseFolder").DatabaseFolders;

class Folders implements DatabaseFolders {
  old = new Map<string, string>();
  new = new Map<string, string>();
  failMove = new Set<string>();
  failList = false;
  calls = 0;
  async listOld() {
    this.calls += 1;
    if (this.failList) throw new Error("readdir failed");
    return [...this.old.keys()];
  }
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
  async removeNew(file: string) { this.new.delete(file); }
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

  it("refuses a database whose log could not move, keeps everything, and goes on at the next start", async () => {
    folders.old.set(DB, "db").set(`${DB}-wal`, "wal");
    folders.failMove.add(`${DB}-wal`);
    const first = await moveDatabasesOutOfDocuments(folders);
    expect(first.refused).toEqual(new Set(["plainva-v1"]));
    expect(Object.fromEntries(folders.old)).toEqual({ [DB]: "db", [`${DB}-wal`]: "wal" });
    expect(folders.new.size).toBe(0);

    folders.failMove.clear();
    const second = await moveDatabasesOutOfDocuments(folders);
    expect(second.refused.size).toBe(0);
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "db", [`${DB}-wal`]: "wal" });
  });

  it("a start that ends between the log and the database leaves a pair the next start completes", async () => {
    folders.old.set(DB, "db").set(`${DB}-wal`, "wal");
    folders.failMove.add(DB);
    const first = await moveDatabasesOutOfDocuments(folders);
    expect(first.refused).toEqual(new Set(["plainva-v1"]));
    expect(Object.fromEntries(folders.new)).toEqual({ [`${DB}-wal`]: "wal" });

    folders.failMove.clear();
    await moveDatabasesOutOfDocuments(folders);
    expect(folders.old.size).toBe(0);
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "db", [`${DB}-wal`]: "wal" });
  });

  it("removes a log whose database is nowhere, and a stale log beside a database that has its own", async () => {
    folders.old.set("plainva-goneSQLite.db-wal", "orphan").set("plainva-goneSQLite.db-shm", "orphan");
    folders.new.set(DB, "db").set(`${DB}-wal`, "own");
    folders.old.set(`${DB}-wal`, "stale");
    await moveDatabasesOutOfDocuments(folders);
    expect(folders.old.size).toBe(0);
    expect(Object.fromEntries(folders.new)).toEqual({ [DB]: "db", [`${DB}-wal`]: "own" });
  });

  it("refuses every database when Documents cannot be listed", async () => {
    folders.failList = true;
    expect((await moveDatabasesOutOfDocuments(folders)).unknown).toBe(true);
  });

  it("leaves files that are no database alone", async () => {
    folders.old.set("recovery.pdf", "user").set("plainva.db", "user").set(DB, "db");
    await moveDatabasesOutOfDocuments(folders);
    expect(Object.fromEntries(folders.old)).toEqual({ "recovery.pdf": "user", "plainva.db": "user" });
  });
});

describe("the refusal before a database opens", () => {
  it("moves once per lifetime and refuses only the database that could not move", async () => {
    folders.old.set(DB, "db").set(`${DB}-wal`, "wal").set("plainva-v2SQLite.db", "db2");
    folders.failMove.add(`${DB}-wal`);
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
});
