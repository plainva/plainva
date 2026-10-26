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
  SyncWorker,
} from "@plainva/core";
import { sameSyncTarget, syncStateBindingDecision, syncStateBindingFor } from "@plainva/ui";
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

import { bindVaultSyncState } from "./filesSwitch";

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

describe("one target or another", () => {
  it("is the folder id where both sides know one, else the folder", () => {
    const named = syncStateBindingFor({ provider: "drive", folder: { path: "Plainva" } });
    const withId = syncStateBindingFor({ provider: "drive", folder: { path: "Plainva", id: "f1" } });
    const otherId = syncStateBindingFor({ provider: "drive", folder: { path: "Plainva", id: "f2" } });
    expect(sameSyncTarget(named, withId)).toBe(true);
    expect(sameSyncTarget(withId, otherId)).toBe(false);
    // An empty setting is the default folder.
    expect(sameSyncTarget(syncStateBindingFor({ provider: "onedrive", folder: { path: "" } }), syncStateBindingFor({ provider: "onedrive", folder: { path: "/plainva/" } }))).toBe(true);
  });

  it("is another target for another account with a folder of the same name, or another provider", () => {
    const anna = syncStateBindingFor({ provider: "drive", folder: { path: "Plainva" }, identity: { issuer: "google", subject: "anna" } });
    const bert = syncStateBindingFor({ provider: "drive", folder: { path: "Plainva" }, identity: { issuer: "google", subject: "bert" } });
    expect(syncStateBindingDecision(anna, bert)).toBe("reset");
    expect(syncStateBindingDecision(anna, { ...anna, provider: "onedrive" })).toBe("reset");
    expect(syncStateBindingDecision(null, anna)).toBe("adopt");
    expect(syncStateBindingDecision(anna, anna)).toBe("keep");
  });
});
