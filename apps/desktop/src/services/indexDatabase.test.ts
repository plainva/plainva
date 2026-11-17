import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The desktop's index database at the start (services/indexDatabase.ts): a
 * damaged one is set aside only once nothing holds it, and the in-vault copy
 * of an older version never comes back in its place.
 */

const disk = vi.hoisted(() => ({ files: new Map<string, string>(), log: [] as string[] }));

vi.mock("@tauri-apps/api/path", () => ({ appDataDir: async () => "/data" }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async (cmd: string, args: { dbPath?: string }) => { disk.log.push(`${cmd} ${args?.dbPath ?? ""}`); } }));
vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { get: (url: string) => ({ close: async () => { disk.log.push(`close pool ${url}`); } }) },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (path: string) => disk.files.has(path),
  mkdir: async () => {},
  readFile: async (path: string) => new TextEncoder().encode(disk.files.get(path) ?? ""),
  writeFile: async (path: string, data: Uint8Array) => { disk.log.push(`write ${path}`); disk.files.set(path, new TextDecoder().decode(data)); },
  rename: async (from: string, to: string) => {
    disk.log.push(`rename ${from} -> ${to}`);
    disk.files.set(to, disk.files.get(from)!);
    disk.files.delete(from);
  },
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
});
