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
    setAside: async () => { ledgers.delete(vaultId); },
  }),
}));
// The remote the vault syncs with: what a ledger is bound to.
const remote = vi.hoisted(() => ({ binding: "webdav:https://dav.example/notes" as string | null }));
vi.mock("./queueLedgerBinding", () => ({ ledgerBinding: async () => remote.binding }));
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
  remote.binding = "webdav:https://dav.example/notes";
  sql.dbs.clear();
  sql.failing = false;
  installSqlBridge();
  registry.vaults = [{ id: "cloud-1", name: "Notes", provider: "webdav" } as VaultEntry];
  registry.activeId = "cloud-1";
});

/** Every vault a test opened: closed after it, so a failed test leaves no index pass running into the next. */
const opened: Array<{ dispose(): Promise<void> }> = [];

afterEach(async () => {
  for (const v of opened.splice(0)) await v.dispose().catch(() => undefined);
  delete (globalThis as Record<string, unknown>).__plainvaFixtureSql;
  for (const db of sql.dbs.values()) await (await db).close();
});

type Service = typeof import("./vaultService");
type Vault = Awaited<ReturnType<Service["getMobileVault"]>>;

/** Opens the active vault afresh, as a start of the app does. */
async function boot(): Promise<{ service: Service; vault: Vault }> {
  vi.resetModules();
  const service = await import("./vaultService");
  const vault = await service.getMobileVault();
  opened.push(vault);
  return { service, vault };
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

    // 3. The database is back. The start's own steps: the index pass — with
    // the sync's enqueue already on, the worst order —, then the sync's first
    // cycle: its pull, then the ledger, then what the index owes.
    sql.failing = false;
    ({ vault } = await boot());
    expect(vault.db).not.toBeNull();
    vault.enableSyncEnqueue();
    await vault.indexer!.indexVaultFull("test: the warm pass");
    // The pass left the deletions and the rename to the ledger: nothing of them is queued before the pull.
    expect((await queued(vault)).filter((op) => !op.startsWith("write"))).toEqual([]);
    await vault.replayLedger();
    vault.markFirstSyncComplete();
    const carried = await owed(vault);
    expect(carried).toEqual([
      "delete Deleted.md",
      "delete Later.md",
      "rename Renamed.md -> Moved.md",
      "write Edited.md",
      // Moved.md is Renamed.md under its new name: the move carries it, and nothing of it changed.
      "write New.md",
    ]);
    // Handed over once: the ledger is gone, and the next start queues nothing twice.
    expect(ledgers.size).toBe(0);
    await vault.dispose();
    ({ vault } = await boot());
    expect(await queued(vault)).toEqual(carried);
    expect(await vault.replayLedger()).toBe(0);
    await vault.dispose();
  }, 60_000);

  it("hands each change over once: a replay that stops, a sync, a note restored elsewhere and the next start delete nothing again", async () => {
    const container = new (await import("../adapters/CapacitorVaultAdapter")).CapacitorVaultAdapter("vaults/cloud-1") as unknown as import("@plainva/core").IVaultAdapter;
    for (const path of ["A.md", "C.md", "D.md", "Kept.md"]) await container.writeTextFile(path, `# ${path}\n`);
    let { vault } = await boot();
    vault.enableSyncEnqueue();
    vault.markFirstSyncComplete();
    await markAllSynced(vault);
    await vault.dispose();

    // Without the database: delete C, rename A to B, delete D.
    sql.failing = true;
    let service: Service;
    ({ service, vault } = await boot());
    expect(await service.vaultOps.remove(vault, "C.md", { confirmed: true })).toBe(true);
    await service.vaultOps.rename(vault, "A.md", "B");
    expect(await service.vaultOps.remove(vault, "D.md", { confirmed: true })).toBe(true);
    await vault.dispose();

    // The database is back; the disk does not answer for D.md while the ledger is handed over.
    sql.failing = false;
    ({ vault } = await boot());
    vault.enableSyncEnqueue();
    await vault.indexer!.indexVaultFull("test: the warm pass");
    const exists = container.exists.bind(container);
    container.exists = async (path: string) => { if (path === "D.md") throw new Error("no answer from the folder"); return exists(path); };
    // A step is decided before anything leaves the ledger: a check that fails hands nothing over.
    // (A step that stops between hand-overs, followed by a sync: queueLedger.test.ts.)
    await vault.replayLedger();
    container.exists = exists;
    expect(await queued(vault)).toEqual([]);
    expect(ledgers.size).toBe(1);
    // The sync runs on; another device restores C.md, and the pull brings it here.
    await container.writeTextFile("C.md", "# C, restored on another device\n");
    await vault.dispose();

    // The next start: C is back, so its deletion stands on a decision the remote has moved past and is not sent.
    ({ vault } = await boot());
    vault.enableSyncEnqueue();
    await vault.indexer!.indexVaultFull("test: the warm pass");
    await vault.replayLedger();
    expect(await queued(vault)).toEqual(["delete D.md", "rename A.md -> B.md"]);
    expect(await container.exists("C.md")).toBe(true);
    expect(ledgers.size).toBe(0);
    await vault.dispose();
  }, 60_000);

  it("records nothing for a vault without a sync, and replays nothing into a remote the ledger was not written for", async () => {
    const container = new (await import("../adapters/CapacitorVaultAdapter")).CapacitorVaultAdapter("vaults/cloud-1");
    await container.writeTextFile("C.md", "# C\n");
    let { vault } = await boot();
    await markAllSynced(vault);
    await vault.dispose();
    sql.failing = true;
    let service: Service;
    ({ service, vault } = await boot());
    expect(await service.vaultOps.remove(vault, "C.md", { confirmed: true })).toBe(true);
    await vault.dispose();
    expect(ledgers.size).toBe(1);
    // The sync was moved to another folder before the database opened again.
    remote.binding = "webdav:https://dav.example/elsewhere";
    sql.failing = false;
    ({ vault } = await boot());
    vault.enableSyncEnqueue();
    await vault.replayLedger();
    expect(await queued(vault)).toEqual([]);
    expect(ledgers.size).toBe(0);
    await vault.dispose();
    // No sync at all: nothing is recorded.
    remote.binding = null;
    await container.writeTextFile("E.md", "# E\n");
    sql.failing = true;
    ({ service, vault } = await boot());
    expect(await service.vaultOps.remove(vault, "E.md", { confirmed: true })).toBe(true);
    await vault.dispose();
    expect(ledgers.size).toBe(0);
  }, 60_000);
});
