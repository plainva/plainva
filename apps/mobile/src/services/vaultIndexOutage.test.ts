// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IDatabaseAdapter } from "@plainva/core";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import type { VaultEntry } from "./vaultRegistry";

/**
 * The phone without its index database (stability plan S6, R5).
 *
 * When the vault's database does not open, the vault still opens — without
 * search, tags, databases and the sync — and the person may go on writing,
 * deleting and renaming notes. The sync's queue lives in that database, so
 * nothing of it was queued. This runs the real boot (`vaultService.ts`) three
 * times over one container and one SQLite: synced, then without the
 * database, then with it back, and asks what the sync gets to carry up.
 */

const registry = vi.hoisted(() => ({ vaults: [] as VaultEntry[], activeId: "cloud-1", fresh: new Set<string>() }));
const containers = vi.hoisted(() => new Map<string, unknown>());

vi.mock("../adapters/CapacitorVaultAdapter", async () => {
  const { MemoryVaultAdapter } = await import("../../../../packages/core/test/helpers/memoryVault");
  // One container per root that outlives a boot, as the phone's folder does.
  class ContainerAdapter {
    constructor(root: string) {
      if (!containers.has(root)) containers.set(root, new MemoryVaultAdapter(1_000));
      return containers.get(root) as ContainerAdapter;
    }
  }
  return { CapacitorVaultAdapter: ContainerAdapter };
});
// The ledger's file outside the container, kept across boots (the web shell's Filesystem needs IndexedDB).
const ledgers = vi.hoisted(() => new Map<string, string>());
vi.mock("./queueLedgerStore", () => ({
  queueLedgerPath: (vaultId: string) => `queue-ledger/${vaultId}.json`,
  queueLedgerStore: (vaultId: string) => ({
    load: async () => ledgers.get(vaultId) ?? null,
    save: async (text: string) => { ledgers.set(vaultId, text); },
    clear: async () => { ledgers.delete(vaultId); },
  }),
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

/** The phone's SQLite, kept across boots; `failing` makes it refuse to open. */
const sql = { dbs: new Map<string, Promise<IDatabaseAdapter>>(), failing: false };
function installSqlBridge(): void {
  const open = (name: string) => {
    let db = sql.dbs.get(name);
    if (!db) { db = realSqlite(); sql.dbs.set(name, db); }
    return db;
  };
  const refuse = () => { throw new Error("unable to open database file"); };
  (globalThis as Record<string, unknown>).__plainvaFixtureSql = {
    exec: async (name: string, statement: string, params: unknown[]) => { if (sql.failing) refuse(); await (await open(name)).execute(statement, params); },
    all: async (name: string, statement: string, params: unknown[]) => { if (sql.failing) refuse(); return (await open(name)).query(statement, params); },
  };
}

beforeEach(() => {
  vi.resetModules();
  containers.clear();
  ledgers.clear();
  sql.dbs.clear();
  sql.failing = false;
  installSqlBridge();
  registry.vaults = [{ id: "cloud-1", name: "Notes", provider: "webdav" } as VaultEntry];
  registry.activeId = "cloud-1";
});

afterEach(async () => {
  delete (globalThis as Record<string, unknown>).__plainvaFixtureSql;
  for (const db of sql.dbs.values()) await (await db).close();
});

type Service = typeof import("./vaultService");
type Vault = Awaited<ReturnType<Service["getMobileVault"]>>;

/** Opens the active vault afresh, as a start of the app does. */
async function boot(): Promise<{ service: Service; vault: Vault }> {
  vi.resetModules();
  const service = await import("./vaultService");
  return { service, vault: await service.getMobileVault() };
}

/** Every file of the vault confirmed with the remote, nothing owed: a synced vault. */
async function markAllSynced(vault: Vault): Promise<void> {
  const db = vault.db!;
  for (const { path } of await db.query<{ path: string }>("SELECT path FROM files")) {
    const state = await vault.syncRepo!.getSyncState(path);
    await vault.syncRepo!.recordSyncedBase(path, { sha256: state!.local_sha256!, etag: "e1", text: await vault.adapter.readTextFile(path) });
    await vault.syncRepo!.updateRemoteState(path, "e1", `id-${path}`, 1);
  }
  await db.execute("DELETE FROM offline_queue");
  await db.execute("UPDATE files SET sync_state = 'synced'");
}

/** What the sync of the next start gets to carry up, after its first cycle queued what it owes. */
async function owed(vault: Vault): Promise<string[]> {
  await vault.syncQueue!.enqueueLocalOnlyFiles();
  return queued(vault);
}

/** Every entry of the sync queue, as `operation path`. */
async function queued(vault: Vault): Promise<string[]> {
  const ops = await vault.db!.query<{ operation: string; file_path: string; new_path: string | null }>("SELECT operation, file_path, new_path FROM offline_queue");
  return ops.map((op) => (op.operation === "rename" ? `rename ${op.file_path} -> ${op.new_path}` : `${op.operation} ${op.file_path}`)).sort();
}

describe("the phone without its index database", () => {
  it("carries every change made without the database to the sync once it is back", async () => {
    const container = new (await import("../adapters/CapacitorVaultAdapter")).CapacitorVaultAdapter("vaults/cloud-1");
    for (const [path, text] of [["Edited.md", "# Edited\n"], ["Deleted.md", "# Deleted\n"], ["Renamed.md", "# Renamed\n"], ["Later.md", "# Later\n"], ["Kept.md", "# Kept\n"]]) {
      await container.writeTextFile(path, text);
    }

    // 1. A synced vault.
    let { vault } = await boot();
    expect(vault.db).not.toBeNull();
    vault.enableSyncEnqueue();
    vault.markFirstSyncComplete();
    await markAllSynced(vault);
    await vault.dispose();

    // 2. The database does not open: the vault runs without it, and the person writes.
    sql.failing = true;
    let service: Service;
    ({ service, vault } = await boot());
    expect(vault.db).toBeNull();
    expect(vault.syncQueue).toBeNull();
    await service.vaultOps.save(vault, "Edited.md", "# Edited\n\nwithout the database\n");
    await service.vaultOps.save(vault, "New.md", "# New\n");
    expect(await service.vaultOps.remove(vault, "Deleted.md", { confirmed: true })).toBe(true);
    await service.vaultOps.rename(vault, "Renamed.md", "Moved");
    await vault.dispose();

    // A second start without the database adds to what the first one kept.
    ({ service, vault } = await boot());
    expect(vault.db).toBeNull();
    expect(await service.vaultOps.remove(vault, "Later.md", { confirmed: true })).toBe(true);
    await vault.dispose();

    // 3. The database is back. The start's own steps: the index pass, then the sync.
    sql.failing = false;
    ({ vault } = await boot());
    expect(vault.db).not.toBeNull();
    await vault.indexer!.indexVaultFull("test: the warm pass");
    vault.enableSyncEnqueue();
    vault.markFirstSyncComplete();
    const carried = await owed(vault);
    expect(carried).toEqual([
      "delete Deleted.md",
      "delete Later.md",
      "rename Renamed.md -> Moved.md",
      "write Edited.md",
      "write Moved.md",
      "write New.md",
    ]);
    // Handed over once: the ledger is gone, and the next start queues nothing twice.
    expect(ledgers.size).toBe(0);
    await vault.dispose();
    ({ vault } = await boot());
    expect(await queued(vault)).toEqual(carried);
    await vault.dispose();
  }, 60_000);
});
