import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { VaultIndexer } from "../src/vault/VaultIndexer.ts";
import { VaultQueryService } from "../src/vault/VaultQueryService.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";

/**
 * Integration regression (real SQLite via node:sqlite, Node >= 22.5 — the CI
 * runs 22): a note may carry a base column's property under a different
 * CASING than the column key ("Frist" vs. column "frist"). Frontmatter keys
 * keep the note's exact casing in the index, every view reads the COLUMN key,
 * and the properties panel capitalizes bare keys for display — so the note
 * looked correct while the base showed "no value" (maintainer find
 * 2026-07-17). queryDatabaseFiles now maps props onto the schema's column
 * keys case-insensitively; exact matches always win.
 */

class NodeSqliteAdapter implements IDatabaseAdapter {
  constructor(private db: any) {}
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
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async initialize(): Promise<void> {}
  async close(): Promise<void> {
    this.db.close();
  }
}

const TASK_DB_CONFIG = {
  filters: { and: ['file.folder == "Aufgaben"'] },
  columns: {
    status: { input: "status", options: [{ value: "Offen" }, { value: "In Arbeit" }, { value: "Erledigt" }] },
    frist: { input: "date" },
  },
  views: [{ type: "table", name: "Tabelle", order: ["file.name", "status", "frist"] }],
};

describe("queryDatabaseFiles: property-key casing", () => {
  it("maps differently-cased note keys onto the schema's column keys (exact match wins)", async () => {
    const { DatabaseSync } = (await import("node:sqlite")) as any;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-case-"));
    const vaultAdapter = new LocalVaultAdapter(tmpDir);
    await vaultAdapter.initialize();
    const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);
    const indexer = new VaultIndexer(vaultAdapter, db);
    const query = new VaultQueryService(db as never);

    try {
      // Capitalized note keys (the maintainer case), lowercase column keys.
      await vaultAdapter.writeTextFile(
        "Aufgaben/Capitalized.md",
        "---\ntype: Note\nokf_version: 0.1\nFrist: 2026-07-20\nStatus: Offen\n---\n\n# Capitalized\n"
      );
      // Exact-cased keys keep working unchanged.
      await vaultAdapter.writeTextFile(
        "Aufgaben/Exact.md",
        "---\ntype: Note\nokf_version: 0.1\nfrist: 2026-07-21\nstatus: In Arbeit\n---\n\n# Exact\n"
      );
      // BOTH spellings present: the exact column key must win over the variant.
      await vaultAdapter.writeTextFile(
        "Aufgaben/Both.md",
        "---\ntype: Note\nokf_version: 0.1\nstatus: Erledigt\nStatus: Offen\n---\n\n# Both\n"
      );
      await indexer.indexVaultFull();

      const rows = await query.queryDatabaseFiles(TASK_DB_CONFIG);
      const byName = new Map(rows.map((r: any) => [r["file.name"], r]));

      const capitalized = byName.get("Capitalized")!;
      expect(capitalized.status).toBe("Offen");
      expect(capitalized.frist).toBe("2026-07-20");
      // The original casing stays on the row too (nothing is renamed away).
      expect(capitalized.Status).toBe("Offen");

      const exact = byName.get("Exact")!;
      expect(exact.status).toBe("In Arbeit");
      expect(exact.frist).toBe("2026-07-21");

      const both = byName.get("Both")!;
      expect(both.status).toBe("Erledigt");
    } finally {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
