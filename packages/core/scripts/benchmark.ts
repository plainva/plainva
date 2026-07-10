/**
 * Core benchmark (hardening plan P1): indexer full pass, incremental pass and
 * FTS search against a real SQLite — the UI-free hot paths.
 *
 * SQLite backend: `node:sqlite` (the previous better-sqlite3 dependency does
 * not build under pnpm 10 — its install script is blocked, so the benchmark
 * had silently become dead code). `node:sqlite` ships with Node >= 22.5; the
 * availability gate below fails fast with a clear message on older runtimes.
 *
 * What this does NOT measure (the in-app perf panel covers those): Tauri IPC,
 * the SQL plugin, WebView rendering, watcher behavior, network vaults, React.
 *
 * Usage:
 *   pnpm --filter @plainva/core run benchmark -- --files 5000 --profile small
 *   pnpm --filter @plainva/core run benchmark -- --vault C:/tmp/plainva-vault-5k --runs 5 --json out.json
 *
 * --files N        generate a synthetic vault with N notes (default 1000)
 * --profile P      small | large | linked  (shape of the generated notes)
 * --vault PATH     use an existing vault instead of generating one
 * --runs N         repetitions for median/p95 (default 5)
 * --json FILE      write the results as JSON
 */
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { initializeSchema } from "../src/db/Schema.js";

// ---- node:sqlite availability gate (Node >= 22.5) --------------------------
interface NodeSqliteDatabase {
  prepare(sql: string): { run(...params: unknown[]): unknown; all(...params: unknown[]): unknown[] };
  exec(sql: string): void;
  close(): void;
}
let DatabaseSync: new (path: string) => NodeSqliteDatabase;
try {
  ({ DatabaseSync } = (await import("node:sqlite")) as unknown as {
    DatabaseSync: new (path: string) => NodeSqliteDatabase;
  });
} catch {
  console.error(
    `This benchmark needs the built-in node:sqlite module (Node >= 22.5; stable since 22.13).\n` +
      `You are running ${process.version}. Upgrade Node or run it on the CI runner.`
  );
  process.exit(2);
}

class NodeSqliteAdapter implements IDatabaseAdapter {
  constructor(private db: NodeSqliteDatabase) {}
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(...(params as never[]));
  }
  async query<T = unknown>(sql: string, params: unknown[] = []): Promise<T[]> {
    return this.db.prepare(sql).all(...(params as never[])) as T[];
  }
  async queryOne<T = unknown>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = this.db.prepare(sql).all(...(params as never[])) as T[];
    return rows[0] ?? null;
  }
  async transaction<T>(callback: (tx: IDatabaseAdapter) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const result = await callback(this);
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

// ---- CLI -------------------------------------------------------------------
interface Args {
  files: number;
  profile: "small" | "large" | "linked";
  vault: string | null;
  runs: number;
  json: string | null;
}
function parseArgs(argv: string[]): Args {
  const args: Args = { files: 1000, profile: "small", vault: null, runs: 5, json: null };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i];
    switch (argv[i]) {
      case "--files": args.files = Number(next()); break;
      case "--profile": args.profile = next() as Args["profile"]; break;
      case "--vault": args.vault = next(); break;
      case "--runs": args.runs = Math.max(1, Number(next())); break;
      case "--json": args.json = next(); break;
    }
  }
  if (!["small", "large", "linked"].includes(args.profile)) {
    throw new Error(`unknown profile: ${args.profile}`);
  }
  return args;
}

// ---- fixture generation (profiles per hardening plan P1.3) ------------------
function noteBody(i: number, total: number, profile: Args["profile"]): string {
  const link = (k: number) => `[[Note_${((i + k) % total) + 1}]]`;
  if (profile === "large") {
    // few, very large notes: long prose, some structure
    return `# Large Note ${i}\n\n${Array.from({ length: 400 }, (_, k) => `Paragraph ${k}: The quick brown fox jumps over the lazy dog, again and again, building a genuinely large document body for parser and FTS load.`).join("\n\n")}\n\n${link(1)} ${link(7)}\n`;
  }
  if (profile === "linked") {
    // link- and frontmatter-heavy: many wiki links, rich properties
    return `# Linked Note ${i}\n\n${Array.from({ length: 40 }, (_, k) => link(k * 3 + 1)).join(" ")}\n\nShort body with #tag${i % 17} and context.\n`;
  }
  return `# Standard Note ${i}\n\nJust a regular note with a link to ${link(1)}.\n\n- [ ] a task\n- some text with #tag${i % 9}\n`;
}

function noteFrontmatter(i: number, profile: Args["profile"]): string {
  if (profile === "linked") {
    return `---\ntype: Note\nokf_version: "0.1"\ntitle: Linked Note ${i}\ntags: [benchmark, linked, group${i % 12}]\nstatus: ${["open", "doing", "done"][i % 3]}\nprio: ${i % 5}\nrelated: "[[Note_${(i % 30) + 1}]]"\n---\n`;
  }
  return `---\ntype: Note\nokf_version: "0.1"\ntitle: Note ${i}\ntags: [benchmark]\n---\n`;
}

async function generateVault(dir: string, files: number, profile: Args["profile"]): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  const folders = ["Projects", "Areas", "Resources", "Archive", "Inbox", "Deep/Nested/Struct"];
  for (const f of folders) await fs.mkdir(path.join(dir, f), { recursive: true });
  for (let i = 1; i <= files; i++) {
    const folder = folders[i % folders.length];
    await fs.writeFile(
      path.join(dir, folder, `Note_${i}.md`),
      noteFrontmatter(i, profile) + noteBody(i, files, profile)
    );
  }
}

// ---- measurement helpers -----------------------------------------------------
function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function p95(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(s.length * 0.95) - 1)];
}

interface Measurement {
  name: string;
  runs: number[];
  medianMs: number;
  p95Ms: number;
}

async function measure(name: string, runs: number, fn: () => Promise<void>): Promise<Measurement> {
  const times: number[] = [];
  for (let r = 0; r < runs; r++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  const m: Measurement = { name, runs: times.map((t) => Math.round(t * 100) / 100), medianMs: Math.round(median(times) * 100) / 100, p95Ms: Math.round(p95(times) * 100) / 100 };
  console.log(`${name}: median ${m.medianMs} ms, p95 ${m.p95Ms} ms (${runs} runs)`);
  return m;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const vaultDir = args.vault ?? path.join(os.tmpdir(), `plainva-bench-${args.profile}-${args.files}`);
  if (!args.vault) {
    console.log(`Generating ${args.files} notes (${args.profile}) at ${vaultDir}…`);
    await generateVault(vaultDir, args.files, args.profile);
  }

  const dbDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-bench-db-"));
  const results: Measurement[] = [];
  const meta = {
    node: process.version,
    platform: `${os.platform()} ${os.release()}`,
    files: args.files,
    profile: args.profile,
    vault: vaultDir,
    date: new Date().toISOString(),
  };
  console.log(`\n--- Plainva core benchmark (${meta.files} files, ${meta.profile}) ---`);

  // COLD full index: fresh DB per run.
  results.push(
    await measure("full index (cold)", args.runs, async () => {
      const dbPath = path.join(dbDir, `cold-${Math.random().toString(36).slice(2)}.db`);
      const raw = new DatabaseSync(dbPath);
      const db = new NodeSqliteAdapter(raw);
      await initializeSchema(db);
      const indexer = new VaultIndexer(new LocalVaultAdapter(vaultDir), db);
      await indexer.indexVaultFull();
      raw.close();
    })
  );

  // WARM setup for the remaining measurements: one persistent DB.
  const warmRaw = new DatabaseSync(path.join(dbDir, "warm.db"));
  const warmDb = new NodeSqliteAdapter(warmRaw);
  await initializeSchema(warmDb);
  const adapter = new LocalVaultAdapter(vaultDir);
  const warmIndexer = new VaultIndexer(adapter, warmDb);
  await warmIndexer.indexVaultFull();
  const queryService = new VaultQueryService(warmDb);

  // WARM full pass (mtime-based skip): the "app restart with warm index" cost.
  results.push(await measure("full index (warm, no changes)", args.runs, () => warmIndexer.indexVaultFull()));

  // Incremental: touch one file, index it.
  const touched = "Inbox/Note_5.md";
  results.push(
    await measure("incremental (1 changed file)", args.runs, async () => {
      const abs = path.join(vaultDir, touched);
      await fs.appendFile(abs, `\nedit ${Math.random()}\n`);
      const info = await adapter.getFileInfo(touched);
      await warmIndexer.indexFile(info);
    })
  );

  // FTS searches (prefix grammar like the sidebar).
  for (const term of ["Standard", "quick brown", "tag3"]) {
    results.push(
      await measure(`search "${term}"`, args.runs, async () => {
        await queryService.searchFullText(term, 50);
      })
    );
  }
  warmRaw.close();

  const payload = { meta, results };
  if (args.json) {
    await fs.writeFile(args.json, JSON.stringify(payload, null, 2) + "\n");
    console.log(`\nResults written to ${args.json}`);
  }
  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
