// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SyncEngine, SyncWorker, WebDavSyncTarget, isStructureNeedsIndexError, type IDatabaseAdapter, type IVaultAdapter } from "@plainva/core";
import { errorText } from "@plainva/ui";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import { byteExactDav, type ByteExactDav } from "../../../../packages/core/test/helpers/byteExactDav";
import type { VaultEntry } from "./vaultRegistry";

/**
 * The phone without its index database (stability plan S6, R5).
 *
 * When the vault's database does not open, the vault still opens — without
 * search, tags, databases and the sync — and the person may go on reading,
 * writing and creating notes. The sync queue lives in that database, so what
 * only the queue can carry to the other devices — a deletion, a rename, a
 * move — is refused before it touches the disk (`StructureRefusingVaultAdapter`).
 *
 * This runs the real boot (`vaultService.ts`) over one container and one
 * SQLite, and a real sync — engine, worker and WebDAV target against an
 * in-memory server, wired the way `syncService` wires them: synced, then
 * without the database, then with it back. It asks what reaches the remote,
 * and that nothing is sent twice.
 */

const registry = vi.hoisted(() => ({ vaults: [] as VaultEntry[], activeId: "cloud-1", fresh: new Set<string>() }));
const containers = vi.hoisted(() => new Map<string, unknown>());
/** The workspace status the boot reads: null for a plain vault. */
const ws = vi.hoisted(() => ({ status: null as unknown }));

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
vi.mock("./mobileWorkspaceSecurity", () => {
  const rest = anyFn();
  return new Proxy(rest, { get: (target, key) => (key === "getMobileWorkspaceStatus" ? async () => ws.status : Reflect.get(target, key)) });
});
vi.mock("./profileImportJournal", () => anyFn());
vi.mock("./mobileSettingsSync", () => ({ mobileSyncDeviceId: async () => "device-1", clearMobileSyncState: vi.fn() }));
vi.mock("./mobileSettings", async (original) => ({
  ...(await original<typeof import("./mobileSettings")>()),
  reloadMobileSettingsForActiveVault: async () => {},
}));

/** The phone's SQLite, kept across boots; `failing` makes it refuse to open, `failAt` fail one statement after it opened. */
const sql = { dbs: new Map<string, Promise<IDatabaseAdapter>>(), failing: false, failAt: null as string | null };
function installSqlBridge(): void {
  const open = (name: string) => {
    let db = sql.dbs.get(name);
    if (!db) { db = realSqlite(); sql.dbs.set(name, db); }
    return db;
  };
  const refuse = () => { throw new Error("unable to open database file"); };
  (globalThis as Record<string, unknown>).__plainvaFixtureSql = {
    exec: async (name: string, statement: string, params: unknown[]) => { if (sql.failing) refuse(); await (await open(name)).execute(statement, params); },
    all: async (name: string, statement: string, params: unknown[]) => {
      if (sql.failing) refuse();
      if (sql.failAt && statement.includes(sql.failAt)) throw new Error("database disk image is malformed");
      return (await open(name)).query(statement, params); },
  };
}

beforeEach(() => {
  vi.resetModules();
  containers.clear();
  sql.dbs.clear();
  sql.failing = false;
  sql.failAt = null;
  ws.status = null;
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


/** Every entry of the sync queue, as `operation path`. */
async function queued(vault: Vault): Promise<string[]> {
  const ops = await vault.db!.query<{ operation: string; file_path: string; new_path: string | null }>("SELECT operation, file_path, new_path FROM offline_queue");
  return ops.map((op) => (op.operation === "rename" ? `rename ${op.file_path} -> ${op.new_path}` : `${op.operation} ${op.file_path}`)).sort();
}

let dav: ByteExactDav;
beforeEach(() => {
  dav = byteExactDav();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

/** The container's own adapter: what another app (the Files app) changes, past Plainva. */
async function container(): Promise<IVaultAdapter> {
  return new (await import("../adapters/CapacitorVaultAdapter")).CapacitorVaultAdapter("vaults/cloud-1") as unknown as IVaultAdapter;
}

/**
 * The sync of one start, as `syncService` builds it: the vault's queue, chain
 * and sync state; after the first clean cycle what the index owes is queued
 * (`enqueueLocalOnlyFiles`, and the deletion marks' sweep, `sweepOwedToRemote`)
 * and new files may queue from then on.
 *
 * `order: "app"` runs the start in the app's order: the index pass first (the
 * warm pass is set off at boot, vaultService `afterFirstPaint`), the queue
 * enabled after it (hooks/useVaultBoot.ts, syncService). A deletion the pass
 * finds before then is not queued by the pass; the index marks it in
 * `index_removed` and the first cycle's sweep queues it (tx strand, R22).
 * `order: "queue first"` enables the queue before the pass.
 */
function sync(vault: Vault, order: "app" | "queue first" = "queue first") {
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch);
  const engine = new SyncEngine(vault.syncQueue!, target, vault.files, vault.syncRepo!);
  const worker = new SyncWorker(engine, target, vault.syncRepo!, vault.belowChain, vault.syncQueue!, 60_000);
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  let owed: Promise<void> = Promise.resolve();
  worker.onFirstCycleComplete = () => {
    owed = vault.syncQueue!.enqueueLocalOnlyFiles();
    vault.sweepOwedToRemote("plain");
    vault.markFirstSyncComplete();
  };
  worker.onFilesChanged = (paths) => void vault.reindexPaths(paths);
  if (order === "queue first") vault.enableSyncEnqueue();
  return {
    /**
     * The start's index pass, then cycles until the queue is empty. `swept`
     * says when the first cycle's sweep has queued what it owes (it runs
     * without being awaited, as in the app).
     */
    async run(swept?: () => Promise<boolean>) {
      await vault.indexer!.indexVaultFull("test: the warm pass");
      if (order === "app") vault.enableSyncEnqueue();
      for (let i = 0; i < 5; i++) {
        await worker.runCycle();
        await owed;
        await vault.indexer!.whenIdle();
        if (i === 0 && swept) await vi.waitFor(async () => { if (!(await swept())) throw new Error("the sweep has not queued yet"); }, { timeout: 15_000 });
        if ((await queued(vault)).length === 0 && i > 0) break;
      }
    },
  };
}

const remoteText = (p: string) => (dav.files.has(p) ? new TextDecoder().decode(dav.files.get(p)!.bytes) : null);
const changesSent = () => dav.log.filter((line) => /^(PUT|DELETE|MOVE|MKCOL) /.test(line));

/** A vault on the remote, synced: KEEP keeps the guard against mass deletions out of the way. */
const KEEP = Array.from({ length: 12 }, (_, i) => `Keep ${i + 1}.md`);
async function syncedVault(paths: string[]): Promise<void> {
  const disk = await container();
  for (const p of [...paths, ...KEEP]) await disk.writeTextFile(p, `# ${p}\n`);
  const { vault } = await boot();
  expect(vault.db).not.toBeNull();
  await sync(vault).run();
  for (const p of paths) expect(remoteText(p), p).toBe(`# ${p}\n`);
  await vault.dispose();
}

describe("the phone without its index database", () => {
  it("keeps writing and creating notes, refuses what only the queue could carry, and the next start sends what was done", async () => {
    await syncedVault(["Edited.md", "Doomed.md", "Named.md", "Projects/Plan.md"]);

    sql.failing = true;
    const { service, vault } = await boot();
    expect(vault.db).toBeNull();
    expect(vault.indexClosed).toBe(true);
    // Writing and creating go on, a new file in a new folder included.
    await service.vaultOps.save(vault, "Edited.md", "# Edited.md\n\nwithout the database\n");
    await service.vaultOps.save(vault, "New.md", "# New\n");
    await service.vaultOps.save(vault, "Fresh folder/Inner.md", "# Inner\n");
    // What only the queue could carry is refused, and nothing of it touches the disk.
    const refusals: unknown[] = [];
    const refused = (attempt: Promise<unknown>) => attempt.then(() => { throw new Error("went through"); }, (error: unknown) => { refusals.push(error); });
    await refused(service.vaultOps.remove(vault, "Doomed.md", { confirmed: true }));
    await refused(service.vaultOps.rename(vault, "Named.md", "Renamed"));
    await refused(service.vaultOps.moveNote(vault, "Named.md", "Projects"));
    await refused(service.vaultOps.moveFolder(vault, "Projects", "Archive"));
    await refused(service.vaultOps.removeFolder(vault, "Projects", { confirmed: true }));
    await refused(service.vaultOps.createFolder(vault, "Empty"));
    await refused(vault.files.deleteItem("Doomed.md", false, { confirmed: true }));
    await refused(vault.files.renameItem("Named.md", "Elsewhere.md"));
    expect(refusals).toHaveLength(8);
    for (const error of refusals) expect(isStructureNeedsIndexError(error)).toBe(true);
    // Each surface that shows a failure shows the one sentence.
    expect(errorText(refusals[0])).toMatch(/search index could not be opened/);
    const disk = await container();
    for (const p of ["Doomed.md", "Named.md", "Projects/Plan.md"]) expect(await disk.exists(p), p).toBe(true);
    for (const p of ["Renamed.md", "Elsewhere.md", "Archive", "Empty", "Projects/Named.md"]) expect(await disk.exists(p), p).toBe(false);
    await vault.dispose();

    // The next start with the database: the ordinary pass and the ordinary sync.
    sql.failing = false;
    const back = (await boot()).vault;
    expect(back.indexClosed).toBe(false);
    const before = changesSent().length;
    await sync(back).run();
    expect(remoteText("Edited.md")).toBe("# Edited.md\n\nwithout the database\n");
    expect(remoteText("New.md")).toBe("# New\n");
    expect(remoteText("Fresh folder/Inner.md")).toBe("# Inner\n");
    // What was refused is as it was, here and there.
    for (const p of ["Doomed.md", "Named.md", "Projects/Plan.md"]) expect(remoteText(p), p).toBe(`# ${p}\n`);
    expect(await queued(back)).toEqual([]);
    // Sent once: a further cycle sends nothing.
    const sent = changesSent().length;
    expect(sent).toBeGreaterThan(before);
    await sync(back).run();
    expect(changesSent().length).toBe(sent);
  }, 120_000);

  it("refuses nothing in a vault without a remote: nobody would miss the deletion", async () => {
    registry.vaults = [{ id: "local-2", name: "Local" } as VaultEntry];
    registry.activeId = "local-2";
    const disk = new (await import("../adapters/CapacitorVaultAdapter")).CapacitorVaultAdapter("vaults/local-2") as unknown as IVaultAdapter;
    await disk.writeTextFile("Old.md", "# Old\n");
    sql.failing = true;
    const { service, vault } = await boot();
    expect(vault.db).toBeNull();
    expect(vault.indexClosed).toBe(false);
    expect(await service.vaultOps.remove(vault, "Old.md", { confirmed: true })).toBe(true);
    expect(await disk.exists("Old.md")).toBe(false);
    await service.vaultOps.createFolder(vault, "Empty");
    expect(await disk.exists("Empty")).toBe(true);
  }, 60_000);

  it("finds what another app changed meanwhile by the ordinary pass, and the sync carries it the ordinary way, once", async () => {
    await syncedVault(["Gone.md", "Old.md", "Folder/One.md", "Folder/Two.md"]);

    // Without the database, the Files app deletes a note, renames one and renames a folder.
    sql.failing = true;
    let { vault } = await boot();
    expect(vault.indexClosed).toBe(true);
    await vault.dispose();
    const disk = await container();
    await disk.deleteItem("Gone.md");
    await disk.renameItem("Old.md", "Moved.md");
    await disk.renameItem("Folder", "Renamed folder");

    sql.failing = false;
    ({ vault } = await boot());
    // In the app's order: the deletions reach the remote through the marks' sweep.
    await sync(vault, "app").run(async () => (await queued(vault)).includes("delete Gone.md") || remoteText("Gone.md") === null);
    expect(remoteText("Gone.md")).toBeNull();
    expect(remoteText("Old.md")).toBeNull();
    expect(remoteText("Moved.md")).toBe("# Old.md\n");
    expect(remoteText("Folder/One.md")).toBeNull();
    expect(remoteText("Renamed folder/One.md")).toBe("# Folder/One.md\n");
    expect(remoteText("Renamed folder/Two.md")).toBe("# Folder/Two.md\n");
    for (const p of KEEP) expect(remoteText(p), p).toBe(`# ${p}\n`);
    expect(await queued(vault)).toEqual([]);
    const sent = changesSent();
    expect(sent.filter((line) => line.startsWith("DELETE ") && line.endsWith("Gone.md"))).toHaveLength(1);
    await sync(vault, "app").run();
    expect(changesSent()).toEqual(sent);
  }, 120_000);

  it("keeps nothing of a database that opened and then failed its first query: workspace state, permission check and queue go, the database is closed", async () => {
    // An encrypted workspace's vault (locked: no runtime), whose database opens and is malformed.
    ws.status = { workspaceId: "w-1" };
    sql.failAt = "SELECT COUNT(*) AS n FROM files";
    vi.resetModules();
    const fixture = await import("../adapters/FixtureSqliteAdapter");
    const close = vi.spyOn(fixture.FixtureSqliteAdapter.prototype, "close");
    const service = await import("./vaultService");
    const vault = await service.getMobileVault();
    opened.push(vault);
    expect(close).toHaveBeenCalled();
    expect(vault.db).toBeNull();
    expect(vault.syncQueue).toBeNull();
    expect(vault.workspaceState).toBeNull();
    expect(vault.indexClosed).toBe(true);
    // It runs on the chain without the database: the locked workspace's check
    // is gone with it (a write goes through), and a deletion is refused.
    await service.vaultOps.save(vault, "New.md", "# New\n");
    expect(await (await container()).readTextFile("New.md")).toBe("# New\n");
    await expect(service.vaultOps.remove(vault, "New.md", { confirmed: true })).rejects.toSatisfy(isStructureNeedsIndexError);
    expect(await (await container()).exists("New.md")).toBe(true);
  }, 60_000);
});
