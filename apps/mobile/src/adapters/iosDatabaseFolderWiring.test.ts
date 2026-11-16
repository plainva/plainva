import { beforeEach, describe, expect, it, vi } from "vitest";
import { phoneSqlite } from "../../../../packages/core/test/helpers/phoneSqlitePlugin";

/**
 * The phone's one opening path (`sqliteConnections.ts`) on iOS: the files of
 * a database leave Documents before the plugin opens it, and a database whose
 * files stayed behind is not opened - the plugin would make a second, empty
 * one at its new location (release list A11). The Filesystem plugin is two
 * folders in memory; which file the plugin opens is not modelled, only that
 * it is or is not asked to.
 */

const fs = vi.hoisted(() => ({
  documents: new Map<string, string>(),
  library: new Map<string, string>(),
  failRename: new Set<string>(),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "ios", isNativePlatform: () => true }, registerPlugin: () => ({}) }));
vi.mock("@capacitor/filesystem", () => {
  const folder = (directory: string) => (directory === "LIBRARY" ? fs.library : fs.documents);
  return {
    Directory: { Documents: "DOCUMENTS", Library: "LIBRARY" },
    Filesystem: {
      readdir: async ({ directory }: { directory: string }) => ({ files: [...folder(directory).keys()].map((name) => ({ name, type: "file" })) }),
      stat: async ({ path, directory }: { path: string; directory: string }) => {
        if (!folder(directory).has(path)) throw new Error("File does not exist");
        return {};
      },
      rename: async ({ from, directory, to, toDirectory }: { from: string; directory: string; to: string; toDirectory: string }) => {
        if (fs.failRename.has(from)) throw new Error("rename failed");
        const data = folder(directory).get(from);
        if (data === undefined) throw new Error("File does not exist");
        folder(directory).delete(from);
        folder(toDirectory).set(to, data);
      },
      deleteFile: async ({ path, directory }: { path: string; directory: string }) => { folder(directory).delete(path); },
    },
  };
});
vi.mock("@capacitor-community/sqlite", async () => (await import("../../../../packages/core/test/helpers/phoneSqlitePlugin")).phoneSqlite.module);

const { acquireDatabase, deleteDatabaseFile, releaseDatabase, resetDatabasesForTests } = await import("./sqliteConnections");

beforeEach(() => {
  phoneSqlite.reset("ios");
  resetDatabasesForTests();
  fs.documents.clear();
  fs.library.clear();
  fs.failRename.clear();
});

describe("opening a database on iOS", () => {
  it("moves its files out of Documents first", async () => {
    fs.documents.set("plainva-v1SQLite.db", "db").set("plainva-v1SQLite.db-wal", "wal").set("plainva-v1SQLite.db-shm", "shm");
    await acquireDatabase("plainva-v1");
    expect(fs.documents.size).toBe(0);
    expect(Object.fromEntries(fs.library)).toEqual({ "CapacitorDatabase/plainva-v1SQLite.db": "db", "CapacitorDatabase/plainva-v1SQLite.db-wal": "wal" });
    expect(phoneSqlite.isOpen("plainva-v1")).toBe(true);
    await releaseDatabase("plainva-v1");
  });

  it("does not open a database whose files could not move, and opens the others", async () => {
    fs.documents.set("plainva-v1SQLite.db", "db").set("plainva-v1SQLite.db-wal", "wal");
    fs.failRename.add("plainva-v1SQLite.db-wal");
    await expect(acquireDatabase("plainva-v1")).rejects.toThrow(/could not be moved out of Documents/);
    expect(phoneSqlite.log).toEqual([]);
    expect(fs.documents.get("plainva-v1SQLite.db")).toBe("db");

    await acquireDatabase("plainva-index");
    expect(phoneSqlite.isOpen("plainva-index")).toBe(true);
    await releaseDatabase("plainva-index");
  });

  it("does not delete at the new place a database that is still in Documents", async () => {
    fs.documents.set("plainva-v1SQLite.db", "db").set("plainva-v1SQLite.db-wal", "wal");
    fs.failRename.add("plainva-v1SQLite.db-wal");
    await expect(deleteDatabaseFile("plainva-v1")).rejects.toThrow(/could not be moved out of Documents/);
    expect(phoneSqlite.log).toEqual([]);
    expect(fs.documents.get("plainva-v1SQLite.db")).toBe("db");
  });
});
