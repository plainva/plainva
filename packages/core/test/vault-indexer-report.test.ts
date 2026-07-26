import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { VaultIndexer } from "../src/vault/VaultIndexer.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";
import type { IVaultAdapter, VaultListing } from "../src/vault/IVaultAdapter.ts";

/**
 * P1a. `indexVaultFull` used to return nothing, so "did the scan even see my
 * file?" was unanswerable without a debugger — exactly the state the maintainer
 * got stuck in ("a restart does not help either"). The counters only mean
 * anything against rows that actually persist, so this runs on real SQLite
 * (node:sqlite, Node >= 22.5 — the CI runs 22) rather than the query-recording
 * mock.
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

async function harness() {
  const { DatabaseSync } = (await import("node:sqlite")) as any;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-report-"));
  const vaultAdapter = new LocalVaultAdapter(tmpDir);
  await vaultAdapter.initialize();
  const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
  await initializeSchema(db);
  const indexer = new VaultIndexer(vaultAdapter, db);
  return {
    tmpDir,
    vaultAdapter,
    db,
    indexer,
    async dispose() {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

describe("indexVaultFull report", () => {
  it("counts new files as added, not as changed", async () => {
    const h = await harness();
    try {
      await h.vaultAdapter.writeTextFile("a.md", "# A");
      await h.vaultAdapter.writeTextFile("b.md", "# B");

      const first = await h.indexer.indexVaultFull();
      expect(first.added).toBe(2);
      expect(first.changed).toBe(0);
      expect(first.removed).toBe(0);
      expect(first.durationMs).toBeGreaterThanOrEqual(0);
    } finally {
      await h.dispose();
    }
  });

  it("counts a re-index of a known file as changed, and a no-op pass as nothing", async () => {
    const h = await harness();
    try {
      await h.vaultAdapter.writeTextFile("a.md", "# A");
      await h.indexer.indexVaultFull();

      const noop = await h.indexer.indexVaultFull();
      expect(noop).toMatchObject({ added: 0, changed: 0, removed: 0, skipped: [] });

      // A different mtime is what the pass keys on.
      await new Promise((r) => setTimeout(r, 12));
      await h.vaultAdapter.writeTextFile("a.md", "# A edited");

      const second = await h.indexer.indexVaultFull();
      expect(second.added).toBe(0);
      expect(second.changed).toBe(1);
    } finally {
      await h.dispose();
    }
  });

  it("counts files gone from disk as removed", async () => {
    const h = await harness();
    try {
      await h.vaultAdapter.writeTextFile("a.md", "# A");
      await h.vaultAdapter.writeTextFile("b.md", "# B");
      await h.indexer.indexVaultFull();

      await h.vaultAdapter.deleteItem("b.md");
      const third = await h.indexer.indexVaultFull();
      expect(third.removed).toBe(1);
      expect(third.added).toBe(0);
    } finally {
      await h.dispose();
    }
  });

  it("passes the walk's skipped entries through", async () => {
    // A folder the walk could not enter must never look like an empty folder.
    const h = await harness();
    try {
      const reporting = {
        ...h.vaultAdapter,
        listDir: h.vaultAdapter.listDir.bind(h.vaultAdapter),
        getFileInfo: h.vaultAdapter.getFileInfo.bind(h.vaultAdapter),
        readTextFile: h.vaultAdapter.readTextFile.bind(h.vaultAdapter),
        listDirReport: async (): Promise<VaultListing> => ({
          files: [],
          skipped: [{ path: "Netzlaufwerk", reason: "unreadable" as const }],
        }),
      } as unknown as IVaultAdapter;
      const result = await new VaultIndexer(reporting, h.db).indexVaultFull();
      expect(result.skipped).toEqual([{ path: "Netzlaufwerk", reason: "unreadable" }]);
    } finally {
      await h.dispose();
    }
  });

  it("falls back to listDir when the adapter cannot report skips", async () => {
    const h = await harness();
    try {
      await h.vaultAdapter.writeTextFile("a.md", "# A");
      // LocalVaultAdapter has no listDirReport — the pass must still work.
      expect((h.vaultAdapter as IVaultAdapter).listDirReport).toBeUndefined();
      const result = await h.indexer.indexVaultFull();
      expect(result.added).toBe(1);
      expect(result.skipped).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});
