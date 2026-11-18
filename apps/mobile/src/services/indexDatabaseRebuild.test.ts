import { beforeEach, describe, expect, it, vi } from "vitest";
import { phoneSqlite } from "../../../../packages/core/test/helpers/phoneSqlitePlugin";

/**
 * The phone's side of "Rebuild index" (services/indexDatabaseRebuild.ts):
 * where the plugin keeps a database on each platform, a damaged one set
 * aside under a name nothing takes for a database or its companion, and an
 * empty one in its place. The Filesystem plugin is a map of paths in memory,
 * keyed by directory.
 */

const device = vi.hoisted(() => ({ platform: "ios" as "ios" | "android", files: new Map<string, string>() }));
const missing = () => Object.assign(new Error("File does not exist"), { code: "OS-PLUG-FILE-0008" });
const key = (path: string, directory?: string) => `${directory ?? "ABSOLUTE"}:${path}`;

vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => device.platform, isNativePlatform: () => true },
  registerPlugin: () => ({}),
}));
vi.mock("@capacitor/filesystem", () => ({
  Directory: { Documents: "DOCUMENTS", Library: "LIBRARY", Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    getUri: async ({ directory }: { directory: string }) => ({ uri: directory === "DATA" ? "file:///data/user/0/com.plainva.app/files" : "file:///other" }),
    stat: async ({ path, directory }: { path: string; directory?: string }) => {
      if (!device.files.has(key(path, directory))) throw missing();
      return {};
    },
    rename: async ({ from, to, directory, toDirectory }: { from: string; to: string; directory?: string; toDirectory?: string }) => {
      const data = device.files.get(key(from, directory));
      if (data === undefined) throw missing();
      device.files.delete(key(from, directory));
      device.files.set(key(to, toDirectory ?? directory), data);
    },
    writeFile: async ({ path, directory, data }: { path: string; directory?: string; data: string }) => { device.files.set(key(path, directory), data); },
    readFile: async ({ path, directory }: { path: string; directory?: string }) => {
      const data = device.files.get(key(path, directory));
      if (data === undefined) throw missing();
      return { data };
    },
    readdir: async ({ path, directory }: { path: string; directory?: string }) => {
      const prefix = key(path.replace(/\/?$/, "/"), directory);
      const names = [...device.files.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
      return { files: names.map((name) => ({ name, type: "file" })) };
    },
    deleteFile: async ({ path, directory }: { path: string; directory?: string }) => { device.files.delete(key(path, directory)); },
  },
}));
vi.mock("@capacitor-community/sqlite", async () => (await import("../../../../packages/core/test/helpers/phoneSqlitePlugin")).phoneSqlite.module);

const { androidDatabasesFolder, finishMobileSetAside, removeSetAsideMobileIndexDatabases, setAsideMobileIndexDatabase } = await import("./indexDatabaseRebuild");
const { resetDatabasesForTests } = await import("../adapters/sqliteConnections");
const { resetDatabaseFolderForTests } = await import("../adapters/iosDatabaseFolder");

beforeEach(() => {
  device.files.clear();
  resetDatabasesForTests();
  resetDatabaseFolderForTests();
});

describe("setting the phone's damaged index database aside", () => {
  it("iOS: in the plugin's folder below Library, under names the folder sweep never takes for a database's companion", async () => {
    device.platform = "ios";
    phoneSqlite.reset("ios");
    device.files.set(key("CapacitorDatabase/plainva-indexSQLite.db", "LIBRARY"), "damaged");
    device.files.set(key("CapacitorDatabase/plainva-indexSQLite.db-wal", "LIBRARY"), "log");
    const aside = await setAsideMobileIndexDatabase("plainva-index");
    expect(aside).toMatch(/^plainva-indexSQLite\.db\.broken-/);
    expect(device.files.get(key(`CapacitorDatabase/${aside}`, "LIBRARY"))).toBe("damaged");
    expect(device.files.get(key(`CapacitorDatabase/${aside}-wal`, "LIBRARY"))).toBe("log");
    expect(device.files.get(key("CapacitorDatabase/plainva-indexSQLite.db", "LIBRARY")), "an empty database in its place").toBe("");
    for (const name of [aside, `${aside}-wal`]) expect(name).not.toMatch(/SQLite\.db(-wal|-shm|-journal)?$/);
  });

  it("Android: in the app's own databases folder beside files, by its path", async () => {
    device.platform = "android";
    phoneSqlite.reset("android");
    const db = "file:///data/user/0/com.plainva.app/databases/plainva-v1SQLite.db";
    device.files.set(key(db), "damaged");
    const aside = await setAsideMobileIndexDatabase("plainva-v1");
    expect(device.files.get(key(`file:///data/user/0/com.plainva.app/databases/${aside}`))).toBe("damaged");
    expect(device.files.get(key(db))).toBe("");
  });

  it("Android: the databases folder beside files, however many slashes the files uri ends in", () => {
    // What the earlier `uri.replace(/\/+$/, "").replace(/\/files$/, "")` gave, case by case.
    const app = "file:///data/user/0/com.plainva.app";
    for (const [uri, folder] of [
      [`${app}/files`, `${app}/databases`],
      [`${app}/files/`, `${app}/databases`],
      [`${app}/files///`, `${app}/databases`],
      [app, `${app}/databases`],
      [`${app}/`, `${app}/databases`],
      [`${app}/filesystem`, `${app}/filesystem/databases`],
      ["", "/databases"],
      ["/", "/databases"],
      ["///", "/databases"],
    ]) {
      expect(androidDatabasesFolder(uri), uri).toBe(folder);
    }
  });

  it("a set-aside that stopped before the database moved is finished before it opens, by its note; the two newest copies are kept", async () => {
    device.platform = "ios";
    phoneSqlite.reset("ios");
    const at = (file: string) => key(`CapacitorDatabase/${file}`, "LIBRARY");
    const stamp = "2026-11-17T09-00-00-000Z";
    device.files.set(at("plainva-v1SQLite.db"), "damaged");
    device.files.set(at("plainva-v1SQLite.db.setting-aside"), JSON.stringify({ stamp }));
    device.files.set(at(`plainva-v1SQLite.db.broken-${stamp}-wal`), "its log");
    device.files.set(at("plainva-v1SQLite.db.broken-2026-02-01T00-00-00-000Z"), "older");
    device.files.set(at("plainva-v1SQLite.db.broken-2026-01-01T00-00-00-000Z"), "oldest");
    await finishMobileSetAside("plainva-v1");
    expect(Object.fromEntries([...device.files].filter(([k]) => k.startsWith("LIBRARY:")))).toEqual({
      [at(`plainva-v1SQLite.db.broken-${stamp}`)]: "damaged",
      [at(`plainva-v1SQLite.db.broken-${stamp}-wal`)]: "its log",
      [at("plainva-v1SQLite.db.broken-2026-02-01T00-00-00-000Z")]: "older",
      [at("plainva-v1SQLite.db")]: "",
    });
  });

  it("an orphan companion of an earlier copy beside a healthy database, and no note: nothing moves at the open", async () => {
    device.platform = "ios";
    phoneSqlite.reset("ios");
    const at = (file: string) => key(`CapacitorDatabase/${file}`, "LIBRARY");
    device.files.set(at("plainva-v1SQLite.db"), "healthy");
    device.files.set(at("plainva-v1SQLite.db.broken-2026-11-17T09-00-00-000Z-wal"), "orphan");
    await finishMobileSetAside("plainva-v1");
    expect(device.files.get(at("plainva-v1SQLite.db"))).toBe("healthy");
  });

  it("forgetting the vault on this device removes every copy set aside, and nothing else", async () => {
    device.platform = "ios";
    phoneSqlite.reset("ios");
    device.files.set(key("CapacitorDatabase/plainva-v1SQLite.db.broken-2026-11-17T09-00-00-000Z", "LIBRARY"), "old");
    device.files.set(key("CapacitorDatabase/plainva-v1SQLite.db.broken-2026-11-17T09-00-00-000Z-wal", "LIBRARY"), "old log");
    device.files.set(key("CapacitorDatabase/plainva-v2SQLite.db.broken-2026-11-17T09-00-00-000Z", "LIBRARY"), "another vault's");
    device.files.set(key("CapacitorDatabase/plainva-v1SQLite.db", "LIBRARY"), "");
    device.files.set(key("CapacitorDatabase/plainva-v1SQLite.db.setting-aside", "LIBRARY"), JSON.stringify({ stamp: "2026-11-17T09-00-00-000Z" }));
    await removeSetAsideMobileIndexDatabases("plainva-v1");
    expect([...device.files.keys()].sort()).toEqual([
      key("CapacitorDatabase/plainva-v1SQLite.db", "LIBRARY"),
      key("CapacitorDatabase/plainva-v2SQLite.db.broken-2026-11-17T09-00-00-000Z", "LIBRARY"),
    ]);
  });
});
