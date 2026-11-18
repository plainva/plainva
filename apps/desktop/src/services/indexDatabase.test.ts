import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The desktop's index database at the start (services/indexDatabase.ts): a
 * damaged one is set aside only once nothing holds it, and the in-vault copy
 * of an older version never comes back in its place.
 */

const disk = vi.hoisted(() => ({
  files: new Map<string, string>(),
  log: [] as string[],
  /** A look at `path` that finds nothing waits here until `release` — another window's run goes on meanwhile. */
  hold: null as null | { path: string; reached: () => void; release: Promise<void> },
}));

vi.mock("@tauri-apps/api/path", () => ({ appDataDir: async () => "/data" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (cmd: string, args: { dbPath?: string }) => { disk.log.push(`${cmd} ${args?.dbPath ?? ""}`); } }));
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { get: (url: string) => ({ close: async () => { disk.log.push(`close pool ${url}`); } }) },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (path: string) => {
    const there = disk.files.has(path);
    const hold = disk.hold;
    if (hold && path === hold.path && !there) {
      disk.hold = null;
      hold.reached();
      await hold.release;
    }
    return there;
  },
  mkdir: async () => {},
  readFile: async (path: string) => new TextEncoder().encode(disk.files.get(path) ?? ""),
  writeFile: async (path: string, data: Uint8Array, options?: { createNew?: boolean }) => {
    if (options?.createNew && disk.files.has(path)) throw new Error(`File exists (os error 17): ${path}`);
    disk.log.push(`write ${path}`);
    disk.files.set(path, new TextDecoder().decode(data));
  },
  rename: async (from: string, to: string) => {
    disk.log.push(`rename ${from} -> ${to}`);
    disk.files.set(to, disk.files.get(from)!);
    disk.files.delete(from);
  },
  stat: async (path: string) => ({ mtime: disk.files.has(path) ? new Date(0) : null }),
  readTextFile: async (path: string) => disk.files.get(path) ?? "",
  writeTextFile: async (path: string, text: string) => { disk.log.push(`note ${path}`); disk.files.set(path, text); },
  remove: async (path: string) => { disk.log.push(`remove ${path}`); disk.files.delete(path); },
  readDir: async (dir: string) => [...disk.files.keys()]
    .filter((path) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes("/"))
    .map((path) => ({ name: path.slice(dir.length + 1), isFile: true, isDirectory: false })),
}));

const { resolveIndexDbUrl, setAsideDesktopIndexDatabase } = await import("./indexDatabase");
const { indexDbFileName } = await import("./indexDbPath");

beforeEach(() => {
  disk.files.clear();
  disk.log.length = 0;
});

describe("setting the desktop's damaged index database aside", () => {
  it("closes the driver's pool and the transactions' connection before it moves the file", async () => {
    const url = "sqlite:/data/index/v-1.db";
    disk.files.set("/data/index/v-1.db", "damaged");
    disk.files.set("/data/index/v-1.db-wal", "log");
    const aside = await setAsideDesktopIndexDatabase(url);
    expect(disk.log.slice(0, 2)).toEqual([`close pool ${url}`, `db_tx_close ${url}`]);
    expect(disk.files.get(aside)).toBe("damaged");
    expect(disk.files.get(`${aside}-wal`)).toBe("log");
    expect(disk.files.get("/data/index/v-1.db"), "an empty database in its place").toBe("");
  });

  it("an older version's in-vault database never comes back in place of one set aside", async () => {
    const vault = "/home/me/Notes";
    const name = await indexDbFileName(vault);
    disk.files.set(`${vault}/.plainva/vault.db`, "the in-vault index of an older version");
    disk.files.set(`/data/index/${name}`, "damaged");
    await setAsideDesktopIndexDatabase(`sqlite:/data/index/${name}`);
    // A stop between the set-aside and the empty database: the name is missing.
    disk.files.delete(`/data/index/${name}`);
    disk.log.length = 0;
    expect(await resolveIndexDbUrl(vault)).toBe(`sqlite:/data/index/${name}`);
    expect(disk.log.filter((step) => step.startsWith("write")), "nothing copied over from the vault").toEqual([]);
  });

  it("still moves an older version's in-vault database where none was set aside (the one-time move)", async () => {
    const vault = "/home/me/Notes";
    const name = await indexDbFileName(vault);
    disk.files.set(`${vault}/.plainva/vault.db`, "warm index");
    expect(await resolveIndexDbUrl(vault)).toBe(`sqlite:/data/index/${name}`);
    expect(disk.files.get(`/data/index/${name}`)).toBe("warm index");
  });

  it("keeps the two newest copies set aside, also where the index stayed in the vault's own .plainva", async () => {
    const url = "sqlite:/home/me/Notes/.plainva/vault.db";
    disk.files.set("/home/me/Notes/.plainva/vault.db", "damaged again");
    disk.files.set("/home/me/Notes/.plainva/vault.db.broken-2026-02-01T00-00-00-000Z", "damaged before");
    disk.files.set("/home/me/Notes/.plainva/vault.db.broken-2026-01-01T00-00-00-000Z", "oldest");
    disk.files.set("/home/me/Notes/.plainva/vault.db.broken-2026-01-01T00-00-00-000Z-wal", "its log");
    disk.files.set("/home/me/Notes/.plainva/bookmarks.json", "{}");
    const aside = await setAsideDesktopIndexDatabase(url);
    expect([...disk.files.keys()].sort()).toEqual([aside, "/home/me/Notes/.plainva/vault.db.broken-2026-02-01T00-00-00-000Z", "/home/me/Notes/.plainva/bookmarks.json", "/home/me/Notes/.plainva/vault.db"].sort());
    expect(disk.files.get(aside)).toBe("damaged again");
  });

  it("two windows finish the same run: the second never writes its empty database over the one the first made and opened", async () => {
    const url = "sqlite:/data/index/v-2.db";
    const stamp = "2026-11-18T09-00-00-000Z";
    // The first window's run: its note, the damaged database moved aside, and the empty one not yet written.
    disk.files.set("/data/index/v-2.db.setting-aside", JSON.stringify({ stamp }));
    disk.files.set(`/data/index/v-2.db.broken-${stamp}`, "damaged");
    let reached!: () => void;
    const atTheLook = new Promise<void>((resolve) => { reached = resolve; });
    let release!: () => void;
    disk.hold = { path: "/data/index/v-2.db", reached: () => reached(), release: new Promise<void>((resolve) => { release = resolve; }) };
    const second = setAsideDesktopIndexDatabase(url);
    // The second window has looked and found no database; the first now writes its empty one and opens it.
    await atTheLook;
    disk.files.set("/data/index/v-2.db", "the first window's new database, open");
    release();
    await second;
    expect(disk.files.get("/data/index/v-2.db")).toBe("the first window's new database, open");
    expect(disk.files.get(`/data/index/v-2.db.broken-${stamp}`)).toBe("damaged");
  });
});
