import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import {
  BackupVaultAdapter,
  ConflictAwareVaultAdapter,
  QueueingVaultAdapter,
  SyncEngine,
  SyncQueue,
  SyncStateRepository,
  SyncRootMissingError,
  SyncWorker,
  WebDavSyncTarget,
  dropboxFolderIdentity,
  dropboxRootPath,
} from "@plainva/core";
import { rootCreationAllowed, syncStateBindingDecision, syncStateBindingFor } from "@plainva/ui";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";

/**
 * Third review of plan "Verbinden", finding 1. Removing an account cleared the
 * vault's sync queue and its per-file records, so connecting the SAME folder
 * again compared every file without a base - and made a conflict copy of each
 * one that differed. The queue and records now belong to the target and are
 * checked when a file sync starts: the same folder keeps them, another folder
 * drops them before the worker runs. Real core here: worker, engine, queue,
 * the adapter chain, SQLite and a folder on disk; only the remote is in memory.
 */

const settings = new Map<string, unknown>();
vi.mock("./settingsStore", () => ({
  getSettingsStore: async () => ({
    get: async <T,>(key: string) => (settings.get(key) as T | undefined) ?? null,
    set: async (key: string, value: unknown) => { settings.set(key, structuredClone(value)); },
    delete: async (key: string) => settings.delete(key),
    save: async () => undefined,
  }),
}));
vi.mock("./cloudAccounts", () => ({ loadCloudAccounts: async () => [] }));

import { bindVaultSyncState, syncedBeforeForVault } from "./filesSwitch";

type Remote = Map<string, { text: string; etag: string }>;

async function sha(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function walk(root: string, dir = root): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(root, full)));
    else out.push(relative(root, full).split(sep).join("/"));
  }
  return out;
}

function targetFor(remote: Remote, pushes: string[]): any {
  let seq = 10;
  return {
    async pull() { return { etagMap: new Map([...remote].map(([p, f]) => [p, f.etag])) }; },
    async download(p: string) { const f = remote.get(p); return f ? new TextEncoder().encode(f.text) : null; },
    async probeExists({ path }: { path: string }) { return remote.has(path) ? "present" : "absent"; },
    async push(op: any) {
      pushes.push(`${op.operation} ${op.file_path}`);
      if (op.operation === "write") {
        const etag = `"w${++seq}"`;
        remote.set(op.file_path, { text: new TextDecoder().decode(op.content), etag });
        return { etag };
      }
      if (op.operation === "delete") { remote.delete(op.file_path); return undefined; }
      return undefined;
    },
  };
}

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });
beforeEach(() => settings.clear());

const FILES = { "A.md": "one\n", "B.md": "two\n", "C.md": "three\n" };
const FOLDER_A = syncStateBindingFor({ provider: "webdav", webdav: { url: "https://dav.example/files/anna/vault/", user: "anna" } });
const FOLDER_B = syncStateBindingFor({ provider: "webdav", webdav: { url: "https://dav.example/files/anna/other", user: "anna" } });

/** A vault synced with folder A: identical here and there, with a merge base per file. */
async function syncedVault() {
  const root = await mkdtemp(join(tmpdir(), "plainva-binding-"));
  const db = await realSqlite();
  cleanups.push(async () => { await db.close(); await rm(root, { recursive: true, force: true }); });
  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
  const folderA: Remote = new Map();
  for (const [p, text] of Object.entries(FILES)) {
    await raw.writeTextFile(p, text);
    folderA.set(p, { text, etag: '"e1"' });
    const h = await sha(text);
    await db.execute(
      `INSERT INTO sync_state (path, local_sha256, remote_etag, base_sha256, base_etag, last_sync_ts, base_text) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [p, h, '"e1"', h, '"e1"', Date.now(), text],
    );
  }
  return {
    raw, app, queue, repo, folderA,
    /** A file sync starting against `remote`, as a fresh vault open builds it. */
    async cycle(remote: Remote) {
      const pushes: string[] = [];
      const target = targetFor(remote, pushes);
      const worker = new SyncWorker(new SyncEngine(queue, target, app, repo), target, repo, backup, queue, 60_000, {});
      (worker as any).isRunning = true;
      await worker.runCycle();
      return pushes;
    },
    async conflictCopies() { return (await walk(root)).filter((p) => p.includes(".CONFLICT")); },
    async queued() { return (await db.query<{ operation: string; file_path: string }>(`SELECT operation, file_path FROM offline_queue ORDER BY id`)).map((r) => `${r.operation} ${r.file_path}`); },
  };
}

describe("the sync state belongs to the folder, not the account (third review, finding 1)", () => {
  it("connecting the same folder again keeps the records: no conflict copies", async () => {
    const vault = await syncedVault();
    expect(await bindVaultSyncState("/v", FOLDER_A, { queue: vault.queue, records: vault.repo })).toBe("adopt");
    // Meanwhile: A changed on another device, B here.
    vault.folderA.set("A.md", { text: "one\nfrom elsewhere\n", etag: '"e2"' });
    await vault.app.writeTextFile("B.md", "two\nfrom here\n");

    // The account is removed and connected again with the same folder.
    expect(await bindVaultSyncState("/v", FOLDER_A, { queue: vault.queue, records: vault.repo })).toBe("keep");
    await vault.cycle(vault.folderA);

    expect(await vault.conflictCopies()).toEqual([]);
    expect(await vault.raw.readTextFile("A.md")).toBe("one\nfrom elsewhere\n");
    expect(vault.folderA.get("B.md")?.text).toBe("two\nfrom here\n");
  });

  it("what clearing on removal did: the same folder, a conflict copy per changed file", async () => {
    // The control for the case above - the behaviour this replaces.
    const vault = await syncedVault();
    vault.folderA.set("A.md", { text: "one\nfrom elsewhere\n", etag: '"e2"' });
    await vault.app.writeTextFile("B.md", "two\nfrom here\n");
    await vault.queue.clearAll();
    await vault.repo.clearAll();
    await vault.cycle(vault.folderA);
    expect((await vault.conflictCopies()).length).toBeGreaterThan(0);
  });

  it("another folder drops the queue and the records before the sync starts: nothing stale is pushed there", async () => {
    const vault = await syncedVault();
    await bindVaultSyncState("/v", FOLDER_A, { queue: vault.queue, records: vault.repo });
    // Deleted here while connected to folder A: a DELETE waits in the queue.
    await vault.app.deleteItem("C.md");
    expect(await vault.queued()).toContain("delete C.md");

    // Connected to another folder, which has a C.md of its own.
    const folderB: Remote = new Map([["C.md", { text: "someone else's\n", etag: '"b1"' }]]);
    expect(await bindVaultSyncState("/v", FOLDER_B, { queue: vault.queue, records: vault.repo })).toBe("reset");
    expect(await vault.queued()).toEqual([]);
    const pushes = await vault.cycle(folderB);

    expect(pushes.filter((p) => p.startsWith("delete"))).toEqual([]);
    expect(folderB.get("C.md")?.text).toBe("someone else's\n");
  });

  it("a reconnect before the reload loses nothing: what waited is sent", async () => {
    const vault = await syncedVault();
    await bindVaultSyncState("/v", FOLDER_A, { queue: vault.queue, records: vault.repo });
    await vault.app.writeTextFile("B.md", "two\nwaiting\n");
    // Removed and connected again before the vault was opened anew.
    expect(await bindVaultSyncState("/v", FOLDER_A, { queue: vault.queue, records: vault.repo })).toBe("keep");
    await vault.cycle(vault.folderA);
    expect(vault.folderA.get("B.md")?.text).toBe("two\nwaiting\n");
    expect(await vault.queued()).toEqual([]);
    expect(await vault.conflictCopies()).toEqual([]);
  });

  it("removing the files of an account clears nothing on the desktop", () => {
    const actions = readFileSync(join(__dirname, "cloudAccountsActions.ts"), "utf8");
    const disable = actions.slice(actions.indexOf("export async function disableAccountService("), actions.indexOf("\n}\n", actions.indexOf("export async function disableAccountService(")));
    expect(disable).not.toMatch(/clearAll|ClearSyncState/);
    const vault = readFileSync(join(__dirname, "..", "contexts", "VaultContext.tsx"), "utf8");
    expect(vault).toMatch(/bindVaultSyncState\(path, binding, \{ queue: syncQueue, records: syncRepo \}\)/);
  });
});

describe("a Dropbox vault reopened after its default folder was written out (fourth review, finding 1)", () => {
  it("is the same target: no conflict copies, and the queued deletion is sent", async () => {
    const vault = await syncedVault();
    // First start: the folder setting is still empty, the target uses /Plainva.
    expect(await bindVaultSyncState("/v", syncStateBindingFor({ provider: "dropbox", folder: { path: "" } }), { queue: vault.queue, records: vault.repo })).toBe("adopt");
    // Meanwhile: C deleted here, B changed here, A changed on another device.
    await vault.app.deleteItem("C.md");
    await vault.app.writeTextFile("B.md", "two\nfrom here\n");
    vault.folderA.set("A.md", { text: "one\nfrom elsewhere\n", etag: '"e2"' });

    // The wizard (or the migration in readSyncRootFolder) wrote the default out.
    expect(await bindVaultSyncState("/v", syncStateBindingFor({ provider: "dropbox", folder: { path: "/Plainva" } }), { queue: vault.queue, records: vault.repo })).toBe("keep");
    const pushes = await vault.cycle(vault.folderA);

    expect(await vault.conflictCopies()).toEqual([]);
    expect(pushes).toContain("delete C.md");
    expect(vault.folderA.has("C.md")).toBe(false);
    expect(await vault.raw.exists("C.md")).toBe(false);
    expect(vault.folderA.get("B.md")?.text).toBe("two\nfrom here\n");
    expect(await vault.raw.readTextFile("A.md")).toBe("one\nfrom elsewhere\n");
  });
});

/** Two spellings of one target, per provider: every row has to keep. */
const SAME_TARGET: Array<[string, Parameters<typeof syncStateBindingFor>[0], Parameters<typeof syncStateBindingFor>[0]]> = [
  ["Dropbox: empty and the written-out default", { provider: "dropbox", folder: { path: "" } }, { provider: "dropbox", folder: { path: "/Plainva" } }],
  ["Dropbox: no setting and the default without a slash", { provider: "dropbox" }, { provider: "dropbox", folder: { path: "Plainva" } }],
  ["Dropbox: slashes and case", { provider: "dropbox", folder: { path: "/Notes/Vault/" } }, { provider: "dropbox", folder: { path: "notes//VAULT" } }],
  ["Dropbox: backslashes", { provider: "dropbox", folder: { path: "\\Notes\\Vault" } }, { provider: "dropbox", folder: { path: "/Notes/Vault" } }],
  ["OneDrive: empty and the default", { provider: "onedrive", folder: { path: "" } }, { provider: "onedrive", folder: { path: "Plainva" } }],
  ["OneDrive: slashes and case", { provider: "onedrive", folder: { path: "/Plainva/" } }, { provider: "onedrive", folder: { path: "plainva" } }],
  ["OneDrive: nested with doubled slashes", { provider: "onedrive", folder: { path: "Notes/Vault" } }, { provider: "onedrive", folder: { path: "notes//vault/" } }],
  ["Drive: empty and the default", { provider: "drive", folder: { path: "" } }, { provider: "drive", folder: { path: "Plainva" } }],
  ["Drive: slashes", { provider: "drive", folder: { path: "/Notes/Vault/" } }, { provider: "drive", folder: { path: "Notes//Vault" } }],
  ["Drive: the folder id learned since", { provider: "drive", folder: { path: "Plainva" } }, { provider: "drive", folder: { path: "Plainva", id: "f1" } }],
  ["Drive: the same id under a renamed folder", { provider: "drive", folder: { path: "Old", id: "f1" } }, { provider: "drive", folder: { path: "New", id: "f1" } }],
  ["S3: endpoint case, default port and slash", { provider: "s3", s3: { endpoint: "HTTPS://S3.Example.com:443/", bucket: "notes", prefix: "vault" } }, { provider: "s3", s3: { endpoint: "https://s3.example.com", bucket: "notes", prefix: "/vault/" } }],
  ["S3: an empty prefix and a slash", { provider: "s3", s3: { endpoint: "http://127.0.0.1:9000", bucket: "notes", prefix: "" } }, { provider: "s3", s3: { endpoint: "http://127.0.0.1:9000/", bucket: "notes", prefix: "/" } }],
  ["WebDAV: scheme and host case, default port, trailing slash", { provider: "webdav", webdav: { url: "HTTPS://Cloud.Example.com:443/files/vault/", user: "anna" } }, { provider: "webdav", webdav: { url: "https://cloud.example.com/files/vault", user: "anna" } }],
  ["WebDAV: user case", { provider: "webdav", webdav: { url: "https://cloud.example.com/dav/", user: "Anna" } }, { provider: "webdav", webdav: { url: "https://cloud.example.com/dav/", user: "anna" } }],
  ["WebDAV: the two Nextcloud endpoints of one files root", { provider: "webdav", webdav: { url: "https://cloud.example.com/remote.php/webdav/Vault/", user: "Anna" } }, { provider: "webdav", webdav: { url: "https://cloud.example.com/remote.php/dav/files/anna/Vault", user: "anna" } }],
  ["WebDAV: the dav endpoint without a user given", { provider: "webdav", webdav: { url: "https://cloud.example.com/remote.php/dav/files/Anna/Vault/" } }, { provider: "webdav", webdav: { url: "https://cloud.example.com/remote.php/webdav/Vault", user: "anna" } }],
  ["WebDAV: an encoded and a plain space", { provider: "webdav", webdav: { url: "https://cloud.example.com/remote.php/webdav/My%20Vault", user: "anna" } }, { provider: "webdav", webdav: { url: "https://cloud.example.com/remote.php/webdav/My Vault/", user: "anna" } }],
];

/** Two targets that really differ: these, and only these, reset. */
const OTHER_TARGET: Array<[string, Parameters<typeof syncStateBindingFor>[0], Parameters<typeof syncStateBindingFor>[0]]> = [
  ["Dropbox: another folder", { provider: "dropbox", folder: { path: "/Plainva" } }, { provider: "dropbox", folder: { path: "/Other" } }],
  ["Drive: another folder id", { provider: "drive", folder: { path: "Plainva", id: "f1" } }, { provider: "drive", folder: { path: "Plainva", id: "f2" } }],
  ["Drive: case is a name in Drive", { provider: "drive", folder: { path: "Plainva" } }, { provider: "drive", folder: { path: "plainva" } }],
  ["Drive: another account, same folder name", { provider: "drive", folder: { path: "Plainva" }, identity: { issuer: "google", subject: "anna" } }, { provider: "drive", folder: { path: "Plainva" }, identity: { issuer: "google", subject: "bert" } }],
  ["S3: another bucket", { provider: "s3", s3: { endpoint: "https://s3.example.com", bucket: "notes" } }, { provider: "s3", s3: { endpoint: "https://s3.example.com", bucket: "other" } }],
  ["WebDAV: another server", { provider: "webdav", webdav: { url: "https://cloud.example.com/dav/", user: "anna" } }, { provider: "webdav", webdav: { url: "https://other.example.com/dav/", user: "anna" } }],
  ["WebDAV: another user", { provider: "webdav", webdav: { url: "https://cloud.example.com/remote.php/webdav/", user: "anna" } }, { provider: "webdav", webdav: { url: "https://cloud.example.com/remote.php/webdav/", user: "bert" } }],
  ["another provider", { provider: "dropbox" }, { provider: "onedrive" }],
];

describe("one target or another (fourth review, finding 1)", () => {
  it.each(SAME_TARGET)("keeps - %s", (_name, a, b) => {
    expect(syncStateBindingDecision(syncStateBindingFor(a), syncStateBindingFor(b))).toBe("keep");
    expect(syncStateBindingDecision(syncStateBindingFor(b), syncStateBindingFor(a))).toBe("keep");
  });

  it.each(OTHER_TARGET)("resets - %s", (_name, a, b) => {
    expect(syncStateBindingDecision(syncStateBindingFor(a), syncStateBindingFor(b))).toBe("reset");
  });

  it("keeps where a side cannot name its folder, and takes a binding of another form again", () => {
    const known = syncStateBindingFor({ provider: "webdav", webdav: { url: "https://cloud.example.com/dav/", user: "anna" } });
    const unreadable = syncStateBindingFor({ provider: "webdav", webdav: { url: "not a url", user: "anna" } });
    expect(syncStateBindingDecision(known, unreadable)).toBe("keep");
    expect(syncStateBindingDecision(unreadable, known)).toBe("keep");
    expect(syncStateBindingDecision({ provider: "webdav" }, known)).toBe("adopt");
    expect(syncStateBindingDecision({ v: 2, provider: "webdav" }, known)).toBe("keep");
    expect(syncStateBindingDecision(null, known)).toBe("adopt");
  });

  it("names the folder the way the target resolves it", () => {
    expect(syncStateBindingFor({ provider: "dropbox", folder: { path: "" } }).root).toBe(dropboxFolderIdentity("/Plainva"));
    expect(dropboxRootPath("")).toBe("/Plainva");
  });

  it("never lets a reset allow creating the folder", () => {
    const vault = readFileSync(join(__dirname, "..", "contexts", "VaultContext.tsx"), "utf8");
    const phone = readFileSync(join(__dirname, "..", "..", "..", "mobile", "src", "services", "syncService.ts"), "utf8");
    for (const source of [vault, phone]) expect(source).not.toMatch(/allowRootCreation = true/);
  });
});

describe("a vault that synced before stays one, whatever its records say (fifth review, finding 2)", () => {
  it("after a reset and a cycle that confirmed nothing, the next start creates no folder: the folder is missing, said as such", async () => {
    const vault = await syncedVault();
    // Synced with folder A: the fact is taken from the records the first time it is asked.
    expect(await syncedBeforeForVault("/v", vault.repo)).toBe(true);
    // Connected to folder B: the records go.
    expect(await bindVaultSyncState("/v", FOLDER_A, { queue: vault.queue, records: vault.repo })).toBe("adopt");
    expect(await bindVaultSyncState("/v", FOLDER_B, { queue: vault.queue, records: vault.repo })).toBe("reset");
    expect(await vault.repo.hasConfirmedRemoteFiles()).toBe(false);
    // Its first cycle found nothing up there to confirm (the folder briefly gone).
    await vault.cycle(new Map()).catch(() => undefined);
    expect(await vault.repo.hasConfirmedRemoteFiles()).toBe(false);

    // The next start: the vault synced before, so the folder may not be created.
    const synced = await syncedBeforeForVault("/v", vault.repo);
    expect(synced).toBe(true);
    const target = new WebDavSyncTarget({ url: "https://dav.example/files/anna/other/", user: "anna", pass: "x" }, (async () => new Response("", { status: 404 })) as unknown as typeof fetch);
    target.allowRootCreation = rootCreationAllowed(synced);
    await expect(target.pull()).rejects.toBeInstanceOf(SyncRootMissingError);
  });

  it("a vault that never synced may create its folder", async () => {
    expect(await syncedBeforeForVault("/new", { hasConfirmedRemoteFiles: async () => false })).toBe(false);
    expect(rootCreationAllowed(false)).toBe(true);
  });

  it("is what the desktop asks before it builds a target, and records on the first cycle", () => {
    const source = readFileSync(join(__dirname, "..", "contexts", "VaultContext.tsx"), "utf8");
    expect(source).toMatch(/const hasSyncedBefore = !rootCreationAllowed\(await syncedBeforeForVault\(path, syncRepo\)/);
    expect(source).toMatch(/onFirstCycleComplete = \(skipped\) => \{\s*\/\/[^\n]*\n\s*void markVaultSyncedBefore\(path\)/);
    expect(source).not.toMatch(/hasSyncedBefore = await syncRepo\.hasConfirmedRemoteFiles/);
  });
});
