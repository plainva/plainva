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
 * Integration regression (real SQLite via node:sqlite, Node >= 22.5 - the CI
 * runs 22): a folder whose name carries combining characters is indexed in the
 * form the file system reports - decomposed (NFD) on macOS - while the `.base`
 * sourcing it stores the visually identical composed (NFC) name. SQLite and
 * JavaScript both compare byte for byte, so the base rendered and stayed
 * empty (contributor report #65: `母/クレジットカード管理` on iCloud Drive).
 *
 * Both query paths have to agree, which is why this test asks twice: the SQL
 * pushdown handles a flat and-list, and the in-memory evaluator takes over for
 * nested groups and mixed or-lists. Fixing only the first left a base that
 * worked until someone added a filter group.
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

const FOLDER_NFC = "母/クレジットカード管理".normalize("NFC");
const FOLDER_NFD = FOLDER_NFC.normalize("NFD");
const NOTE_NFD = `${FOLDER_NFD}/Rechnung.md`;
const FRONTMATTER = "---\ntype: Note\nokf_version: 0.1\n---\n\n# Rechnung\n";

describe("queryDatabaseFiles: Unicode normalization of folder sources", () => {
  it("matches a decomposed path from a composed .base source, in SQL and in memory", async () => {
    const { DatabaseSync } = (await import("node:sqlite")) as any;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-nfd-"));
    const vaultAdapter = new LocalVaultAdapter(tmpDir);
    await vaultAdapter.initialize();
    const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);
    const indexer = new VaultIndexer(vaultAdapter, db);
    const query = new VaultQueryService(db as never);

    try {
      await vaultAdapter.writeTextFile(NOTE_NFD, FRONTMATTER);
      // A neighbour outside the source, so a too-broad fold would show up here.
      await vaultAdapter.writeTextFile("Andere/Fremd.md", FRONTMATTER);
      await indexer.indexVaultFull();

      // Guards: without these the test could pass vacuously - either because
      // the two forms happen to be equal, or because the file system folded
      // the name on write and we would be comparing NFC against NFC.
      expect(FOLDER_NFD).not.toBe(FOLDER_NFC);
      const indexed = await db.query<{ path: string }>("SELECT path FROM files", []);
      expect(indexed.map((r) => r.path)).toContain(NOTE_NFD);

      const flat = await query.queryDatabaseFiles({
        filters: { and: [`file.folder == "${FOLDER_NFC}"`] },
        views: [{}],
      });
      expect(flat.map((r: any) => r["file.path"])).toEqual([NOTE_NFD]);

      // A nested group is residual: SQL applies no folder clause at all here,
      // so the in-memory predicate decides on its own.
      const nested = await query.queryDatabaseFiles({
        filters: { and: [{ or: [`file.folder == "${FOLDER_NFC}"`] }] },
        views: [{}],
      });
      expect(nested.map((r: any) => r["file.path"])).toEqual([NOTE_NFD]);
    } finally {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
