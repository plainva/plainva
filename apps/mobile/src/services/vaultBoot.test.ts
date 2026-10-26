// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IDatabaseAdapter } from "@plainva/core";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { fakeVaultFolder } from "../adapters/fakeVaultFolder";
import type { VaultFolderNative } from "../platform/vaultFolder";
import type { VaultEntry } from "./vaultRegistry";

/**
 * Opening a vault in a folder another app keeps (issue 143, Android 0.8.6).
 *
 * The reporter connected an existing vault folder and got a blank screen that
 * never went away. The boot of a vault without an index read the WHOLE folder
 * before it answered — through the Storage Access Framework, one call per
 * folder and per file, with no time limit — so a large mirrored vault was
 * minutes of nothing, and one call that never answered was nothing for good.
 *
 * This runs the real boot (`vaultService.ts`) against a fake of the folder
 * plugin and a real SQLite behind the index; the registry, the sync and the
 * workspace security are replaced, because what is asked here is the boot.
 */

const folder = vi.hoisted(() => ({ plugin: null as VaultFolderNative | null }));
const registry = vi.hoisted(() => ({ vaults: [] as VaultEntry[], activeId: "local", fresh: new Set<string>() }));

vi.mock("../platform/vaultFolder", () => ({
  getVaultFolderPlugin: () => folder.plugin,
  isVaultFolderSupported: () => true,
  currentVaultFolderPlatform: () => "android",
  pickVaultFolder: vi.fn(),
}));
vi.mock("./vaultRegistry", () => ({
  LOCAL_VAULT_ID: "local",
  isExternalVault: (e: VaultEntry | null | undefined) => Boolean(e?.external?.handle),
  consumeNewLocalVault: (id: string) => registry.fresh.delete(id),
  loadRegistry: async () => registry,
  listVaults: async () => registry.vaults,
  getActiveVaultEntry: async () => registry.vaults.find((v) => v.id === registry.activeId) ?? registry.vaults[0],
  getVaultEntry: async (id: string) => registry.vaults.find((v) => v.id === id) ?? null,
  addVault: async (entry: VaultEntry) => { registry.vaults.push(entry); },
  setActiveVault: async (id: string) => { registry.activeId = id; },
  updateVault: async () => {},
  removeVault: async () => {},
  newVaultId: () => `v-${registry.vaults.length + 1}`,
}));
const anyFn = () => new Proxy({} as Record<string, unknown>, {
  get: (cache, key) => (typeof key !== "string" || key === "then" ? undefined : (cache[key] ??= vi.fn(async () => null))),
  has: () => true,
});
vi.mock("./syncService", () => anyFn());
vi.mock("./mobileWorkspaceSecurity", () => anyFn());
vi.mock("./profileImportJournal", () => anyFn());
vi.mock("./mobileSettingsSync", () => ({ mobileSyncDeviceId: async () => "device-1", clearMobileSyncState: vi.fn() }));
vi.mock("./mobileSettings", async (original) => ({
  ...(await original<typeof import("./mobileSettings")>()),
  reloadMobileSettingsForActiveVault: async () => {},
}));

/** A real SQLite behind the phone's index, as the screenshot runner installs it. */
function installSqlBridge(): () => void {
  const dbs = new Map<string, Promise<IDatabaseAdapter>>();
  const open = (name: string) => {
    let db = dbs.get(name);
    if (!db) { db = realSqlite(); dbs.set(name, db); }
    return db;
  };
  (globalThis as Record<string, unknown>).__plainvaFixtureSql = {
    exec: async (name: string, sql: string, params: unknown[]) => { await (await open(name)).execute(sql, params); },
    all: async (name: string, sql: string, params: unknown[]) => (await open(name)).query(sql, params),
  };
  return () => {
    delete (globalThis as Record<string, unknown>).__plainvaFixtureSql;
    for (const db of dbs.values()) void db.then((d) => d.close());
  };
}

const never = <T,>() => new Promise<T>(() => {});
let removeBridge: () => void;

beforeEach(() => {
  vi.resetModules();
  removeBridge = installSqlBridge();
  registry.vaults = [{ id: "local", name: "" }];
  registry.activeId = "local";
  registry.fresh.clear();
});

afterEach(() => {
  removeBridge();
});

/** A folder vault, registered and active, over the given plugin. */
function folderVault(plugin: VaultFolderNative): VaultEntry {
  folder.plugin = plugin;
  const entry: VaultEntry = { id: "folder-1", name: "Notes", external: { handle: "h", label: "Notes", platform: "android" } };
  registry.vaults.push(entry);
  registry.activeId = entry.id;
  return entry;
}

describe("opening a vault in a picked folder", () => {
  it("opens while the first scan waits on a read that never answers", async () => {
    const { plugin } = fakeVaultFolder(new Map([["Home.md", "# Home"], ["Stuck.md", "# Stuck"]]));
    folderVault({ ...plugin, read: () => never() });
    const service = await import("./vaultService");
    const build = await import("./indexBuild");
    const vault = await service.getMobileVault();
    expect(vault.vaultId).toBe("folder-1");
    // The first scan runs behind the open app, and the app can say so.
    expect(build.isIndexBuilding("folder-1")).toBe(true);
    let whole = false;
    void vault.whenIndexWhole().then(() => { whole = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(whole).toBe(false);
    await vault.dispose();
  });

  it("a switch away from a vault whose boot does not answer does not wait for it", async () => {
    const { plugin } = fakeVaultFolder(new Map([["Home.md", "# Home"]]));
    // The grant of the first folder does not answer: its boot itself hangs.
    folderVault({ ...plugin, resolve: (o) => (o.handle === "h" ? never() : plugin.resolve(o)) });
    registry.vaults.push({ id: "folder-2", name: "Other", external: { handle: "other", label: "Other", platform: "android" } });
    const service = await import("./vaultService");
    let opened = false;
    void service.getMobileVault().then(() => { opened = true; }, () => {});
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(opened).toBe(false);
    const switched = vi.fn();
    window.addEventListener("m-vault-switched", switched);
    await service.switchVault("folder-2");
    window.removeEventListener("m-vault-switched", switched);
    expect(switched).toHaveBeenCalledTimes(1);
    expect(registry.activeId).toBe("folder-2");
    // And "back" on the next boot surface knows where it came from.
    expect((await service.previousMobileVault())?.id).toBe("folder-1");
    const other = await service.getMobileVault();
    expect(other.vaultId).toBe("folder-2");
    await other.dispose();
  }, 10_000);

  it("writes nothing into the folder it was given", async () => {
    const files = new Map<string, string | Uint8Array>([["Home.md", "# Home\n\n[[Other]]"], ["Sub/Other.md", "# Other"], [".obsidian/app.json", "{}"]]);
    const { plugin } = fakeVaultFolder(files);
    const changes: string[] = [];
    const spied: VaultFolderNative = {
      ...plugin,
      write: async (o) => { changes.push(`write ${o.path}`); return plugin.write(o); },
      mkdir: async (o) => { changes.push(`mkdir ${o.path}`); return plugin.mkdir(o); },
      delete: async (o) => { changes.push(`delete ${o.path}`); return plugin.delete(o); },
      rename: async (o) => { changes.push(`rename ${o.from}`); return plugin.rename(o); },
    };
    folder.plugin = spied;
    const before = new Map(files);
    const service = await import("./vaultService");
    const id = await service.createExternalVault({ handle: "h", label: "Notes", platform: "android" }, "Notes");
    const vault = await service.getMobileVault();
    expect(vault.vaultId).toBe(id);
    await vault.whenIndexWhole();
    const indexed = (await vault.db!.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path);
    expect(indexed).toEqual(["Home.md", "Sub/Other.md"]);
    expect(changes).toEqual([]);
    expect(files).toEqual(before);
    await vault.dispose();
  });
});
