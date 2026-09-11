import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PimCacheRepository, type IDatabaseAdapter, type ISyncTarget, type IVaultAdapter } from "@plainva/core";
import type { MobileVault } from "./vaultService";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";

const state = vi.hoisted(() => ({
  settings: new Map<string, unknown>(), secrets: new Map<string, unknown>(),
  disks: new Map<string, Map<string, string>>(), databases: new Map<string, IDatabaseAdapter>(),
  active: "source", entries: [{ id: "source", name: "Source", provider: undefined as string | undefined }],
  failSecret: "", accepted: true, afterReview: async () => {}, allocations: 0,
  switches: [] as string[], events: [] as string[],
}));
function memoryDisk(id: string): IVaultAdapter {
  let files = state.disks.get(id);
  if (!files) { files = new Map(); state.disks.set(id, files); }
  const disk = files;
  return {
    initialize: async () => {}, exists: async (p: string) => disk.has(p),
    readTextFile: async (p: string) => { if (!disk.has(p)) throw Error("missing"); return disk.get(p)!; },
    readBinaryFile: async (p: string) => { if (!disk.has(p)) throw Error("missing"); return new TextEncoder().encode(disk.get(p)); },
    writeTextFile: async (p: string, value: string) => { state.events.push("copy"); disk.set(p, value); },
    writeBinaryFile: async (p: string, value: Uint8Array) => { state.events.push("copy"); disk.set(p, new TextDecoder().decode(value)); },
    listDir: async (dir: string) => {
      const prefix = dir ? `${dir}/` : "";
      const names = [...new Set([...disk.keys()].filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length).split("/")[0]))];
      return names.map(name => ({ path: prefix + name, name, isDirectory: !disk.has(prefix + name), size: 0, mtime: 0 }));
    },
  } as IVaultAdapter;
}
vi.mock("../adapters/CapacitorVaultAdapter", () => ({ CapacitorVaultAdapter: class { constructor(path: string) { return memoryDisk(path.slice("vaults/".length)); } } }));
vi.mock("../adapters/webdavHttp", () => ({ webdavFetch: vi.fn() }));
vi.mock("../components/TransferReviewHost", () => ({ reviewVaultTransfer: async () => { state.events.push("review"); await state.afterReview(); return state.accepted; } }));
vi.mock("./profileImportJournal", () => ({ copyProfilePreferences: async () => { state.events.push("preferences"); } }));
vi.mock("./connectConsent", () => ({ bindRunTokenToAccount: async () => { state.events.push("grant"); } }));
vi.mock("./pim/pimService", () => ({ listPimAccounts: async () => [] }));
vi.mock("./accountBroker", () => ({ getAccountToken: async (v: string, a: string) => state.secrets.get(`account-${v}-${a}`), saveAccountToken: async (v: string, a: string, t: unknown) => { state.secrets.set(`account-${v}-${a}`, t); }, fileGrantProbe: vi.fn() }));
vi.mock("./pim/pimCredentials", () => ({
  getPimCredentials: async (v: string, a: string) => state.secrets.get(`pim-${v}-${a}`),
  savePimCredentials: async (v: string, a: string, c: unknown) => { if (state.failSecret === "pim") throw Error("storageFailed"); state.secrets.set(`pim-${v}-${a}`, c); },
}));
vi.mock("./vaultRegistry", () => ({
  getActiveVaultEntry: async () => state.entries.find(e => e.id === state.active),
  getVaultEntry: async (id: string) => state.entries.find(e => e.id === id), listVaults: async () => state.entries,
  newVaultId: () => `prepared-${++state.allocations}`,
  addVault: async (entry: typeof state.entries[number]) => { state.events.push("register"); state.entries.push(entry); },
}));
vi.mock("./vaultService", () => ({
  noteSaver: { flushAll: async () => {} },
  openPreparedVaultDatabase: async (id: string) => {
    let db = state.databases.get(id);
    if (!db) { db = await realSqlite(); state.databases.set(id, db); }
    return { ...db, close: async () => {} };
  },
  switchVault: async (id: string) => { state.events.push("activate"); state.switches.push(id); state.active = id; },
}));
vi.mock("@plainva/ui", async original => ({
  ...await original<typeof import("@plainva/ui")>(),
  getPlatformServices: () => ({
    credentials: {
      readSecret: async (key: string) => structuredClone(state.secrets.get(key) ?? null),
      writeSecret: async (key: string, value: unknown) => { if (state.failSecret === key) throw Error("storageFailed"); state.secrets.set(key, structuredClone(value)); },
      removeSecret: async (key: string) => { state.secrets.delete(key); },
    },
    loadSettings: async () => ({
      keys: async () => [...state.settings.keys()], get: async (key: string) => structuredClone(state.settings.get(key) ?? null),
      set: async (key: string, value: unknown) => { state.settings.set(key, structuredClone(value)); },
      delete: async (key: string) => { state.settings.delete(key); }, save: async () => {},
    }),
  }),
}));

import { connectAccountFiles } from "./accountVaultTransfer";
import { clearConnectQueue, loadConnectQueue, startConnectQueue } from "./connectQueue";
import { getMailPassword, listMailAccounts, saveMailAccount } from "@plainva/ui/mail";
import { loadCloudAccounts, saveCloudAccounts } from "./cloudAccountsStore";
import { getPlatformServices, setPlatformServices } from "@plainva/ui";
const provider = { provider: "webdav" as const, creds: { url: "https://example.invalid/files", user: "a", pass: "files-secret" } };
let source: MobileVault;
let remoteFiles: Map<string, string>;
let remote: ISyncTarget;
beforeEach(async () => {
  vi.stubGlobal("window", new EventTarget());
  setPlatformServices(getPlatformServices());
  state.settings.clear(); state.secrets.clear(); state.disks.clear(); state.active = "source";
  state.entries = [{ id: "source", name: "Source", provider: undefined }];
  state.switches = []; state.events = []; state.allocations = 0; state.failSecret = ""; state.accepted = true; state.afterReview = async () => {};
  await clearConnectQueue();
  const db = await realSqlite(); state.databases.set("source", db);
  source = { vaultId: "source", db, adapter: memoryDisk("source") } as MobileVault;
  state.disks.get("source")!.set("Note.md", "local notes");
  remoteFiles = new Map([["Note.md", "cloud notes"]]);
  remote = { pull: async () => ({ etagMap: new Map(remoteFiles) }), download: async (p: string) => remoteFiles.has(p) ? new TextEncoder().encode(remoteFiles.get(p)) : null } as unknown as ISyncTarget;
  const cache = new PimCacheRepository(db);
  await cache.upsertAccount({ id: "calendar", provider: "caldav", label: "Calendar", enabled: true, config: {} });
  await cache.replaceCalendars("calendar", [{ id: "cal", name: "Selected", readOnly: false }]);
  await cache.replaceTaskLists("calendar", [{ id: "tasks", name: "Not selected" }]);
  await cache.setTaskListSelected("calendar", "tasks", false);
  state.secrets.set("pim-source-calendar", { kind: "caldav", password: "calendar-secret" });
  await saveMailAccount("source", { id: "mail", label: "Mail", kind: "imap", host: "imap.invalid", port: 993, user: "a" }, "mail-secret");
  await saveCloudAccounts("source", [{ id: "account", family: "fastmail", label: "Account", services: { calendar: { pimAccountId: "calendar" }, mail: { mailAccountId: "mail" } } }]);
  await startConnectQueue("fastmail", ["files"], { vaultId: "source", cloudAccountId: "account" });
});
afterEach(async () => { for (const db of state.databases.values()) await db.close(); state.databases.clear(); vi.unstubAllGlobals(); });
async function connect() { const q = (await loadConnectQueue())!; return connectAccountFiles(source, provider, q.context, async () => remote, "Cloud"); }

describe("the account-to-files transfer before vault activation", () => {
  it("preserves files, real calendar selections and mail credentials before switching", async () => {
    const snapshot = await new PimCacheRepository(source.db!).snapshotAccount("calendar");
    await connect();
    const target = state.switches[0];
    expect(state.events.indexOf("review")).toBeLessThan(state.events.indexOf("copy"));
    expect(state.events[state.events.length - 1]).toBe("activate");
    expect([...state.disks.get(target)!.values()].sort()).toEqual(["cloud notes", "local notes"]);
    expect(state.disks.get("source")!.get("Note.md")).toBe("local notes");
    expect(await new PimCacheRepository(state.databases.get(target)!).snapshotAccount("calendar")).toEqual(snapshot);
    expect(await listMailAccounts(target)).toEqual(await listMailAccounts("source"));
    expect(await getMailPassword(target, "mail")).toBe("mail-secret");
    expect(state.secrets.get(`pim-${target}-calendar`)).toEqual(state.secrets.get("pim-source-calendar"));
    expect((await loadCloudAccounts(target))[0].services).toEqual({ files: { provider: "webdav" }, calendar: { pimAccountId: "calendar" }, mail: { mailAccountId: "mail" } });
  });
  it("cancels review without copying or publishing a vault", async () => {
    state.accepted = false;
    await connect();
    expect(state.events).toEqual(["review"]);
    expect(state.entries).toHaveLength(1);
    expect((await loadConnectQueue())?.outcomes.files?.state).toBe("cancelled");
  });
  it("reuses its prepared destination after a credential-storage interruption", async () => {
    state.failSecret = "pim";
    await expect(connect()).rejects.toThrow("storageFailed");
    expect(state.switches).toEqual([]); expect(state.entries).toHaveLength(1);
    const id = (await loadConnectQueue())!.preparedVaultId!;
    state.failSecret = "";
    await connect();
    expect(state.switches).toEqual([id]); expect(state.allocations).toBe(1);
    expect([...state.disks.get(id)!.values()].sort()).toEqual(["cloud notes", "local notes"]);
  });
  it("refuses a changed source while the review was open", async () => {
    state.afterReview = async () => { state.disks.get("source")!.set("Note.md", "edited during review"); };
    await expect(connect()).rejects.toThrow(/changed/);
    expect(state.switches).toEqual([]); expect(state.events).toEqual(["review"]);
  });
  it("does not publish after the user changed vaults during review", async () => {
    state.afterReview = async () => { state.active = "elsewhere"; state.entries.push({ id: "elsewhere", name: "Elsewhere", provider: undefined }); };
    await expect(connect()).rejects.toThrow("accountChanged");
    expect(state.switches).toEqual([]); expect(state.events).toEqual(["review"]);
  });
  it("serializes a double tap into one review, destination and activation", async () => {
    await Promise.all([connect(), connect()]);
    expect(state.allocations).toBe(1); expect(state.switches).toHaveLength(1);
    expect(state.events.filter(e => e === "review")).toHaveLength(1);
  });
  it("reuses the vault already bound to the same destination and preserves its unsynced file", async () => {
    state.entries.push({ id: "existing", name: "Existing cloud", provider: "webdav" });
    state.secrets.set("sync_provider_mobile_existing", provider);
    await saveCloudAccounts("existing", [{ id: "files-account", family: "fastmail", label: "Account", services: { files: { provider: "webdav" } } }]);
    memoryDisk("existing"); state.disks.get("existing")!.set("Note.md", "unsynced destination");
    await connect();
    expect(state.switches).toEqual(["existing"]); expect(state.allocations).toBe(0);
    expect([...state.disks.get("existing")!.values()].sort()).toEqual(["cloud notes", "local notes", "unsynced destination"]);
    expect((await loadCloudAccounts("existing"))[0].services.calendar?.pimAccountId).toBe("calendar");
  });
  it("refuses ambiguous existing destinations without selecting one arbitrarily", async () => {
    for (const id of ["one", "two"]) {
      state.entries.push({ id, name: id, provider: "webdav" });
      state.secrets.set(`sync_provider_mobile_${id}`, provider);
      await saveCloudAccounts(id, [{ id: "files", family: "fastmail", label: "Account", services: { files: { provider: "webdav" } } }]);
    }
    await expect(connect()).rejects.toThrow("transfer_ambiguous_destination");
    expect(state.switches).toEqual([]); expect(state.allocations).toBe(0);
  });
});
