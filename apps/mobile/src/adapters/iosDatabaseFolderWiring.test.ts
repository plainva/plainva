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
  failStat: new Set<string>(),
  failListDocuments: false,
}));

const missing = () => Object.assign(new Error("File does not exist"), { code: "OS-PLUG-FILE-0008" });

vi.mock("@capacitor/core", () => ({ Capacitor: { getPlatform: () => "ios", isNativePlatform: () => true }, registerPlugin: () => ({}) }));
vi.mock("@capacitor/filesystem", () => {
  const folder = (directory: string) => (directory === "LIBRARY" ? fs.library : fs.documents);
  return {
    Directory: { Documents: "DOCUMENTS", Library: "LIBRARY" },
    Encoding: { UTF8: "utf8" },
    Filesystem: {
      readdir: async ({ path, directory }: { path: string; directory: string }) => {
        if (directory !== "LIBRARY" && fs.failListDocuments) throw Object.assign(new Error("not permitted"), { code: "OS-PLUG-FILE-0007" });
        const prefix = path ? `${path}/` : "";
        const names = [...folder(directory).keys()].filter((key) => key.startsWith(prefix)).map((key) => key.slice(prefix.length));
        if (path && names.length === 0) throw missing();
        return { files: names.map((name) => ({ name, type: "file" })) };
      },
      stat: async ({ path, directory }: { path: string; directory: string }) => {
        if (fs.failStat.has(path)) throw Object.assign(new Error("not permitted"), { code: "OS-PLUG-FILE-0007" });
        if (!folder(directory).has(path)) throw missing();
        return {};
      },
      rename: async ({ from, directory, to, toDirectory }: { from: string; directory: string; to: string; toDirectory: string }) => {
        if (fs.failRename.has(from)) throw new Error("rename failed");
        const data = folder(directory).get(from);
        if (data === undefined) throw new Error("File does not exist");
        folder(directory).delete(from);
        folder(toDirectory).set(to, data);
      },
      writeFile: async ({ path, directory, data }: { path: string; directory: string; data: string }) => { folder(directory).set(path, data); },
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
  fs.failStat.clear();
  fs.failListDocuments = false;
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
    fs.failRename.add("plainva-v1SQLite.db");
    await expect(acquireDatabase("plainva-v1")).rejects.toThrow(/could not be moved out of Documents/);
    expect(phoneSqlite.log).toEqual([]);
    expect(fs.documents.get("plainva-v1SQLite.db")).toBe("db");

    await acquireDatabase("plainva-index");
    expect(phoneSqlite.isOpen("plainva-index")).toBe(true);
    await releaseDatabase("plainva-index");
  });

  it("deletes a database that is still in Documents there, without the plugin making a new one at its place", async () => {
    fs.documents.set("plainva-v1SQLite.db", "db").set("plainva-v1SQLite.db-wal", "wal");
    fs.failRename.add("plainva-v1SQLite.db");
    await deleteDatabaseFile("plainva-v1");
    expect(phoneSqlite.log).toEqual([]);
    expect(fs.documents.size).toBe(0);
  });

  it("keeps the log in Documents when the new folder cannot be checked, and does not open", async () => {
    fs.library.set("CapacitorDatabase/plainva-v1SQLite.db", "db");
    fs.documents.set("plainva-v1SQLite.db-wal", "wal");
    fs.failStat.add("CapacitorDatabase/plainva-v1SQLite.db");
    await expect(acquireDatabase("plainva-v1")).rejects.toThrow(/could not be moved out of Documents/);
    expect(fs.documents.get("plainva-v1SQLite.db-wal")).toBe("wal");
    expect(phoneSqlite.log).toEqual([]);
  });

  it("removes the files left beside a database it deleted", async () => {
    await acquireDatabase("plainva-v1");
    await releaseDatabase("plainva-v1");
    fs.library.set("CapacitorDatabase/plainva-v1SQLite.db-wal", "wal").set("CapacitorDatabase/plainva-v1SQLite.db-shm", "shm");
    await deleteDatabaseFile("plainva-v1");
    expect([...fs.library.keys()].filter((key) => key.startsWith("CapacitorDatabase/plainva-v1"))).toEqual([]);
  });

  it("opens a database when one entry of Documents cannot be listed (F43)", async () => {
    fs.failListDocuments = true;
    fs.documents.set("plainva-v1SQLite.db", "db").set("plainva-v1SQLite.db-wal", "wal");
    await acquireDatabase("plainva-v1");
    expect(phoneSqlite.isOpen("plainva-v1")).toBe(true);
    expect(fs.documents.size).toBe(0);
    await releaseDatabase("plainva-v1");
  });

  it("deletes a database that stayed closed where it lies, and the next start leaves it gone (F43)", async () => {
    fs.documents.set("plainva-v1SQLite.db", "db").set("plainva-v1SQLite.db-wal", "wal");
    fs.failRename.add("plainva-v1SQLite.db");
    await expect(acquireDatabase("plainva-v1")).rejects.toThrow(/could not be moved out of Documents/);
    await deleteDatabaseFile("plainva-v1");
    expect(fs.documents.size).toBe(0);
    expect(fs.library.size).toBe(0);

    resetDatabasesForTests();
    fs.failRename.clear();
    await acquireDatabase("plainva-index");
    expect([...fs.library.keys()].filter((key) => key.includes("plainva-v1"))).toEqual([]);
    await releaseDatabase("plainva-index");
  });
});
