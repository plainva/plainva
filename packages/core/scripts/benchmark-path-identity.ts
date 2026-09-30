/**
 * Path identity cost (ADR 0016): a full index and sync cycles over a
 * 3000-note vault, a third of it in accented folders — half of those stored
 * decomposed on disk, the way Finder writes them — against an in-memory
 * byte-exact WebDAV server. Creates a fresh directory; never touches a user
 * vault. Uses only APIs that existed before ADR 0016, so the same script
 * measures the old and the new code.
 *
 *   tsx scripts/benchmark-path-identity.ts [--json out.json]
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { initializeSchema } from "../src/db/Schema.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter } from "../src/vault/BackupVaultAdapter.js";
import { QueueingVaultAdapter } from "../src/vault/QueueingVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import { SyncEngine } from "../src/sync/SyncEngine.js";
import { SyncWorker } from "../src/sync/SyncWorker.js";
import { WebDavSyncTarget } from "../src/sync/WebDavSyncTarget.js";
import { byteExactDav } from "../test/helpers/byteExactDav.js";

class DatabasePort implements IDatabaseAdapter {
  constructor(readonly raw: DatabaseSync) {}
  async initialize() { await initializeSchema(this); }
  async close() { this.raw.close(); }
  async execute(sql: string, params: unknown[] = []) { this.raw.prepare(sql).run(...params as never[]); }
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> { return this.raw.prepare(sql).all(...params as never[]) as T[]; }
  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> { return (await this.query<T>(sql, params))[0] ?? null; }
  async transaction<T>(action: () => Promise<T>) {
    this.raw.exec("SAVEPOINT operation");
    try { const value = await action(); this.raw.exec("RELEASE operation"); return value; }
    catch (error) { this.raw.exec("ROLLBACK TO operation; RELEASE operation"); throw error; }
  }
}

const args = process.argv.slice(2);
const argument = (name: string) => args[args.indexOf(name) + 1];
const COUNT = 3000;
const GROUPS = 12;
// Groups 0–3 carry accents: 0 and 1 composed on disk, 2 and 3 decomposed.
const groupName = (g: number): string => {
  if (g >= 4) return `Group${g}`;
  const name = ["Überblick", "Neutralität", "Äpfel", "Größen"][g]!.normalize("NFC");
  return g < 2 ? name : name.normalize("NFD");
};

for (const log of ["log", "warn", "info"] as const) console[log] = () => undefined;
const out = (line: unknown) => process.stdout.write(`${JSON.stringify(line)}\n`);

const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-identity-bench-"));
const vaultPath = path.join(root, "vault");
await fs.mkdir(vaultPath);
for (let g = 0; g < GROUPS; g++) await fs.mkdir(path.join(vaultPath, groupName(g)));
const contentFor = (i: number) => `# Record ${i}\n\n${Array.from({ length: 6 }, (_, n) => `Paragraph ${n}: context for [[Record_${(i + 1) % COUNT}]] and #topic${i % 17}.`).join("\n\n")}\n`;
for (let i = 0; i < COUNT; i++) await fs.writeFile(path.join(vaultPath, groupName(i % GROUPS), `Record_${i}.md`), contentFor(i));

const measures: { name: string; ms: number; value?: unknown }[] = [];
const measure = async (name: string, action: () => Promise<unknown>) => {
  const start = performance.now();
  const value = await action();
  const item = { name, ms: Number((performance.now() - start).toFixed(1)), value };
  measures.push(item);
  out(item);
};

const db = new DatabasePort(new DatabaseSync(path.join(root, "index.sqlite")));
await db.initialize();
const raw = new LocalVaultAdapter(vaultPath);
const backup = new BackupVaultAdapter(raw);
const queue = new SyncQueue(db);
const repo = new SyncStateRepository(db);
const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
const indexer = new VaultIndexer(raw, db, {
  onNewLocalFile: (p) => void queue.queueWrite(p),
  onExternalModification: (p) => void queue.queueWrite(p),
  onLocalFileDeleted: (p) => void queue.queueDelete(p),
});
const dav = byteExactDav();
const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch);
const worker = new SyncWorker(new SyncEngine(queue, target, app, repo), target, repo, backup, queue, 60_000);
(worker as unknown as { isRunning: boolean }).isRunning = true;
const settle = () => new Promise((r) => setTimeout(r, 0));

await measure("cold full index", () => indexer.indexVaultFull());
await settle();
await measure("first sync cycle (uploads everything)", async () => { await worker.runCycle(); return (await queue.getPendingOperations()).length; });
await measure("warm full index (unchanged)", () => indexer.indexVaultFull());
await settle();
await measure("steady sync cycle (full listing, nothing to do)", async () => { await worker.runCycle(); return dav.log.length; });
for (let i = 0; i < 60; i++) await fs.writeFile(path.join(vaultPath, groupName(i % GROUPS), `Record_${i}.md`), `${contentFor(i)}\nedited\n`);
await measure("full index after 60 edits", () => indexer.indexVaultFull());
await settle();
await measure("sync cycle pushing 60 edits", async () => { await worker.runCycle(); return (await queue.getPendingOperations()).length; });

const remoteFolders = [...dav.folders].filter(Boolean).sort();
const result = {
  meta: { date: new Date().toISOString(), node: process.version, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, notes: COUNT, root },
  measures,
  remoteFolders: remoteFolders.length,
  remoteFiles: dav.files.size,
  requests: dav.log.length,
};
out(result);
if (args.includes("--json")) await fs.writeFile(path.resolve(argument("--json")), JSON.stringify(result, null, 2) + "\n");
await db.close();
await fs.rm(root, { recursive: true, force: true });
