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
 * OKF 0.2 trust signals in the index (plan P3a, the `.base` checkpoint):
 * real SQLite via node:sqlite. The object-valued families (`generated`,
 * `sources`) must survive indexing as ONE property each — serialised, not
 * exploded into `generated.by`-style rows and not dropped — and the scalar
 * families (`status`, `stale_after`) must stay usable as `.base` columns and
 * filters. A note that carries the families is therefore "not broken" in a
 * database view: it renders, its rows filter, nothing throws.
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

const TRUST_NOTE = [
  "---",
  "type: Note",
  "status: draft",
  "stale_after: 2027-01-01",
  "generated:",
  "  by: plainva-import/0.6.7",
  "  at: 2026-08-01T10:00:00Z",
  "verified:",
  "  - by: human:marco",
  "    at: 2026-08-02T09:00:00Z",
  "sources:",
  "  - resource: https://example.org/spec",
  "    title: Spec",
  "---",
  "",
  "# Trust",
  "",
].join("\n");

const PLAIN_NOTE = "---\ntype: Note\n---\n\n# Plain\n";

describe("OKF 0.2 trust signals in the index", () => {
  it("keeps object-valued families as one property each and lets .base filter on the scalar ones", async () => {
    const { DatabaseSync } = (await import("node:sqlite")) as any;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-trust-"));
    const vaultAdapter = new LocalVaultAdapter(tmpDir);
    await vaultAdapter.initialize();
    const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);
    const indexer = new VaultIndexer(vaultAdapter, db);
    const query = new VaultQueryService(db as never);

    try {
      await vaultAdapter.writeTextFile("Trust.md", TRUST_NOTE);
      await vaultAdapter.writeTextFile("Plain.md", PLAIN_NOTE);
      await indexer.indexVaultFull();

      const props = await db.query<{ key: string; value: string | null }>(
        "SELECT p.key, p.value FROM properties p JOIN files f ON f.id = p.file_id WHERE f.path = ? ORDER BY p.key",
        ["Trust.md"]
      );
      const byKey = new Map(props.map((p) => [p.key, p.value]));

      // Scalars stay scalars — the `.base` column reads them directly.
      expect(byKey.get("status")).toBe("draft");
      expect(byKey.get("stale_after")).toBe("2027-01-01");

      // Objects and lists of objects survive as ONE serialised property each:
      // no `generated.by` rows, nothing dropped. (The phone's table view
      // shows exactly this string — "not broken" is the checkpoint.)
      expect(byKey.has("generated")).toBe(true);
      expect(byKey.has("sources")).toBe(true);
      expect(byKey.has("verified")).toBe(true);
      expect(props.some((p) => p.key.startsWith("generated."))).toBe(false);
      const generated = JSON.parse(byKey.get("generated") ?? "null");
      expect(generated).toMatchObject({ by: "plainva-import/0.6.7" });
      const sources = JSON.parse(byKey.get("sources") ?? "null");
      expect(Array.isArray(sources)).toBe(true);
      expect(sources[0]).toMatchObject({ resource: "https://example.org/spec", title: "Spec" });

      // A lifecycle filter in a `.base` works like any other property filter.
      const drafts = await query.queryDatabaseFiles({
        filters: { and: ['note.status == "draft"'] },
        views: [{}],
      });
      expect(drafts.map((r: any) => r["file.path"])).toEqual(["Trust.md"]);

      // And a view that lists the families as columns does not throw.
      const all = await query.queryDatabaseFiles({
        views: [{ order: ["note.status", "note.stale_after", "note.generated", "note.sources"] }],
      });
      expect(all.map((r: any) => r["file.path"]).sort()).toEqual(["Plain.md", "Trust.md"]);
    } finally {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
