/** Reproducible disk/SQLite workload. Creates a fresh directory; never edits a user vault. */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { performance } from "node:perf_hooks";
import { DatabaseSync } from "node:sqlite";
import { initializeSchema } from "../src/db/Schema.js";
import type { BatchStatement, IDatabaseAdapter, SqlStatements } from "../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";

class DatabasePort implements IDatabaseAdapter {
  constructor(readonly raw: DatabaseSync) {}
  async initialize() { await initializeSchema(this); }
  async close() { this.raw.close(); }
  async execute(sql: string, params: unknown[] = []) { this.raw.prepare(sql).run(...params as never[]); }
  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> { return this.raw.prepare(sql).all(...params as never[]) as T[]; }
  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> { return (await this.query<T>(sql, params))[0] ?? null; }
  async transaction<T>(action: (tx: SqlStatements) => Promise<T>) {
    this.raw.exec("SAVEPOINT operation");
    try { const value = await action(this); this.raw.exec("RELEASE operation"); return value; }
    catch (error) { this.raw.exec("ROLLBACK TO operation; RELEASE operation"); throw error; }
  }
  async runBatch(statements: BatchStatement[]) {
    this.raw.exec("SAVEPOINT batch");
    try { for (const statement of statements) await this.execute(statement.sql, statement.params); this.raw.exec("RELEASE batch"); }
    catch (error) { this.raw.exec("ROLLBACK TO batch; RELEASE batch"); throw error; }
  }
}

const args = process.argv.slice(2);
const argument = (name: string) => args[args.indexOf(name) + 1];
const count = 3000;
const root = args.includes("--directory") ? path.resolve(argument("--directory")) : await fs.mkdtemp(path.join(os.tmpdir(), "plainva-large-vault-"));
if (args.includes("--directory")) await fs.mkdir(root); // EEXIST is intentional.
const vaultPath = path.join(root, "vault");
await fs.mkdir(vaultPath);
const contentFor = (i: number) => `---\ntype: ${i % 3 === 0 ? "Task" : "Note"}\ntitle: Record ${i}\ntags: [fixture, group${i % 12}]\nstatus: ${["open", "doing", "done"][i % 3]}\n---\n# Record ${i}\n\n## Goals\nProjectstart for the current project. Müller checks the source.\n\n${Array.from({ length: 6 }, (_, n) => `Paragraph ${n}: deterministic context for [[Group${(i + 1) % 12}/Record_${(i + 1) % count}.md]] and #topic${i % 17}.`).join("\n\n")}\n\n## Next steps\nProjectstart continues here.\n\n- [ ] First task 📅 2026-10-01\n- [x] Second task\n- [ ] Third task\n\n![[Attachments/pixel_${i % 120}.png]]\n`;
for (let group = 0; group < 12; group++) await fs.mkdir(path.join(vaultPath, `Group${group}`));
await fs.mkdir(path.join(vaultPath, "Attachments"));
for (let i = 0; i < count; i++) await fs.writeFile(path.join(vaultPath, `Group${i % 12}`, `Record_${i}.md`), contentFor(i));
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
for (let i = 0; i < 120; i++) await fs.writeFile(path.join(vaultPath, "Attachments", `pixel_${i}.png`), pixel);
const base = { filters: { and: ['file.folder == "Group0"'] }, views: [{ type: "board", name: "Tasks", groupBy: "status", order: ["file.name", "file.tasks"] }] };
for (const [name, type] of [["Tasks", "board"], ["Records", "table"], ["Notes", "pinboard"]]) await fs.writeFile(path.join(vaultPath, `${name}.base`), JSON.stringify({ ...base, views: [{ ...base.views[0], type, name }] }, null, 2));

const measures: { name: string; ms: number; rss: number; heap: number; value?: unknown }[] = [];
const measure = async (name: string, action: () => Promise<unknown>) => {
  const start = performance.now();
  const value = await action();
  const memory = process.memoryUsage();
  const item = { name, ms: Number((performance.now() - start).toFixed(2)), rss: memory.rss, heap: memory.heapUsed, value };
  measures.push(item); console.log(JSON.stringify(item));
};
const dbPath = path.join(root, "index.sqlite");
const db = new DatabasePort(new DatabaseSync(dbPath));
await measure("database open and schema", () => db.initialize());
const adapter = new LocalVaultAdapter(vaultPath);
const indexer = new VaultIndexer(adapter, db);
await measure("cold full index", () => indexer.indexVaultFull());
const shape: Record<string, number> = {};
for (const table of ["files", "fts_notes", "links", "tags", "properties"]) shape[table] = (await db.queryOne<{ n: number }>(`SELECT COUNT(*) n FROM ${table}`))!.n;
if (shape.files !== 3123 || shape.fts_notes !== 3000) throw new Error(`Incomplete fixture: ${JSON.stringify(shape)}`);
await measure("warm unchanged index", () => indexer.indexVaultFull());
const service = new VaultQueryService(db);
await measure("baseline first 50 file results", async () => (await service.searchFullText("Projectstart", 50)).length);
await measure("first occurrence page (limit 40, at most 16 notes)", async () => { const page = await service.searchOccurrencesPage("Projectstart"); return { displayed: page.hits.length, hasMore: page.next !== null }; });
const first = await service.searchOccurrencesPage("Projectstart");
await measure("next occurrence page", async () => { const page = await service.searchOccurrencesPage("Projectstart", { cursor: first.next }); return { displayed: page.hits.length, hasMore: page.next !== null }; });
await measure("all task scan", async () => { const rows = await service.listTasks(); if (rows.length !== 9000) throw new Error("Incomplete task scan"); return rows.length; });
await measure("task board query", async () => { const rows = await service.queryDatabaseFiles(base); if (rows.length !== 250) throw new Error(`Incomplete board: ${rows.length}`); return rows.length; });
await db.close();
const switches: { cycle: number; rss: number; heap: number }[] = [];
for (let cycle = 0; cycle < 12; cycle++) {
  const reopened = new DatabasePort(new DatabaseSync(dbPath));
  const query = new VaultQueryService(reopened);
  await query.searchOccurrencesPage("Projectstart");
  await reopened.close();
  global.gc?.();
  const memory = process.memoryUsage();
  switches.push({ cycle, rss: memory.rss, heap: memory.heapUsed });
}
const result = {
  meta: { date: new Date().toISOString(), node: process.version, os: `${os.platform()} ${os.release()}`, cpu: os.cpus()[0].model, logicalCpus: os.cpus().length, totalMemory: os.totalmem(), exposedGc: Boolean(global.gc), fixture: { notes: 3000, attachments: 120, databases: 3, root } },
  shape, measures, switches, peakRssKiB: process.resourceUsage().maxRSS,
  boundary: "Disk and SQLite core workload; excludes Tauri IPC, WebView rendering, native memory and process startup. Switching reopens the index and runs the first search page.",
};
const output = args.includes("--json") ? path.resolve(argument("--json")) : path.join(root, "measurement.json");
await fs.writeFile(output, JSON.stringify(result, null, 2) + "\n");
console.log(`Measurement: ${output}`);
console.log(`Fixture: ${vaultPath}`);
