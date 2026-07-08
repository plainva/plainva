import * as fs from "node:fs/promises";
import * as path from "node:path";
import { performance } from "node:perf_hooks";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import Database from "better-sqlite3";
import { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { initializeSchema } from "../src/db/Schema.js";

const VAULT_PATH = path.resolve(process.cwd(), "test-benchmark-vault");
const FILE_COUNT = 500;

class BetterSqliteAdapter implements IDatabaseAdapter {
  constructor(private db: ReturnType<typeof Database>) {}
  async execute(sql: string, params: unknown[] = []): Promise<void> {
    this.db.prepare(sql).run(params);
  }
  async query(sql: string, params: unknown[] = []): Promise<unknown[]> {
    return this.db.prepare(sql).all(params);
  }
  async transaction<T>(callback: (tx: IDatabaseAdapter) => Promise<T>): Promise<T> {
    this.db.prepare("BEGIN").run();
    try {
      const result = await callback(this);
      this.db.prepare("COMMIT").run();
      return result;
    } catch (e) {
      this.db.prepare("ROLLBACK").run();
      throw e;
    }
  }
}

async function generateTestVault() {
  console.log(`Generating test vault at ${VAULT_PATH}...`);
  await fs.rm(VAULT_PATH, { recursive: true, force: true });
  await fs.mkdir(VAULT_PATH, { recursive: true });
  
  // Create folders
  const folders = ["Projects", "Areas", "Resources", "Archives", "Inbox"];
  for (const folder of folders) {
    await fs.mkdir(path.join(VAULT_PATH, folder));
  }

  // Generate files
  for (let i = 1; i <= FILE_COUNT; i++) {
    const isEdgeCase = i % 50 === 0; // Every 50th file is an edge case
    let content: string;
    const folder = folders[i % folders.length];
    const filename = `Note_${i}.md`;
    const fullPath = path.join(VAULT_PATH, folder, filename);

    if (isEdgeCase) {
      // Huge file, deep links, complex frontmatter
      content = `---
title: Edge Case Note ${i}
tags: [edge-case, benchmark, heavy]
properties:
  count: ${i}
  active: true
  score: 9.99
---
# Edge Case ${i}

This is a very long file with many links.
${Array.from({ length: 100 }, (_, k) => `[[Note_${(i + k) % FILE_COUNT + 1}]]`).join(" ")}

${Array.from({ length: 500 }, (_, k) => `Paragraph ${k}: The quick brown fox jumps over the lazy dog.`).join("\n\n")}
`;
    } else {
      // Standard file
      content = `---
title: Standard Note ${i}
tags: [test, auto-generated]
properties:
  count: ${i}
---
# Standard Note ${i}

Just a regular note with a link to [[Note_${(i + 1) % FILE_COUNT + 1}]].
`;
    }

    await fs.writeFile(fullPath, content);
  }
  console.log(`Successfully generated ${FILE_COUNT} files.`);
}

async function runBenchmark() {
  await generateTestVault();

  console.log("\n--- Starting Benchmark ---");

  // 1. Init DB
  const dbPath = path.join(VAULT_PATH, ".plainva", "index.db");
  await fs.mkdir(path.dirname(dbPath), { recursive: true });
  const rawDb = new Database(dbPath);
  const db = new BetterSqliteAdapter(rawDb);
  await initializeSchema(db);

  const adapter = new LocalVaultAdapter(VAULT_PATH);
  const indexer = new VaultIndexer(adapter, db);
  const queryService = new VaultQueryService(db);

  // 2. Full Sync Benchmark
  console.log("Running Full Sync...");
  const t0 = performance.now();
  await indexer.indexVaultFull();
  const t1 = performance.now();
  console.log(`Full Sync (${FILE_COUNT} files) took ${(t1 - t0).toFixed(2)} ms`);

  // 3. Search / Query Benchmark
  console.log("\nRunning Queries...");
  
  const q0 = performance.now();
  const query1 = await queryService.searchFullText("Standard");
  const q1 = performance.now();
  console.log(`Keyword Search 'Standard' (${query1.length} results) took ${(q1 - q0).toFixed(2)} ms`);

  const q2 = performance.now();
  const dbFolderConfig = {
    filters: {
      and: ['file.folder == "Projects/"']
    },
    views: [
      {
        sort: [{ property: "file.mtime", direction: "desc" }]
      }
    ]
  };
  const query2 = await queryService.queryDatabaseFiles(dbFolderConfig);
  const q3 = performance.now();
  console.log(`DB Folder Query 'Projects' (${query2.length} results) took ${(q3 - q2).toFixed(2)} ms`);

  const q4 = performance.now();
  const query3 = await queryService.queryDatabaseFiles({
    filters: { and: ['file.hasTag("edge-case")'] },
    views: [{ sort: [{ property: "count", direction: "desc" }] }]
  });
  const q5 = performance.now();
  console.log(`Tag Query '#edge-case' sorted by 'count' (${query3.length} results) took ${(q5 - q4).toFixed(2)} ms`);

  console.log("\n--- Benchmark Complete ---");
}

runBenchmark().catch(console.error);
