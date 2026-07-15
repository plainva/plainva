import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { MockDatabaseAdapter } from "./mocks/MockDatabaseAdapter.ts";
import { VaultIndexer } from "../src/vault/VaultIndexer.ts";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { BatchStatement } from "../src/db/IDatabaseAdapter.ts";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// An adapter that CAN run a native-style atomic batch: it records the batched
// statements instead of taking the per-statement execute() path.
class BatchingMockAdapter extends MockDatabaseAdapter {
  batched: { sql: string; params: unknown[] }[] = [];
  async runBatch(statements: BatchStatement[]): Promise<void> {
    for (const s of statements) {
      this.batched.push({ sql: s.sql, params: (s.params ?? []) as unknown[] });
    }
  }
}

const isWrite = (sql: string) => /^\s*(INSERT|DELETE)/i.test(sql);
const key = (s: { sql: string; params: unknown[] }) => JSON.stringify(s);

describe("VaultIndexer cold-scan batching", () => {
  let tmpDir: string;
  let vaultAdapter: LocalVaultAdapter;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-indexer-batch-"));
    vaultAdapter = new LocalVaultAdapter(tmpDir);
    await vaultAdapter.initialize();
    // A mix that exercises files, fts, links, tags, properties and sync_state.
    await vaultAdapter.writeTextFile("a.md", "---\ntitle: A\nstatus: open\n---\n# A\nSee [[b]] #urgent");
    await vaultAdapter.writeTextFile("sub/b.md", "# B\nplain #done body");
    await vaultAdapter.writeTextFile("c.md", "no frontmatter, links [[a]] and [[b]]");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("routes the SAME write statements, in the same order, through runBatch as the per-statement path", async () => {
    // Per-statement path (no runBatch): the writes land in `queries`. This path is
    // the one the rest of the indexer suite already pins as correct.
    const plain = new MockDatabaseAdapter();
    await plain.initialize();
    await new VaultIndexer(vaultAdapter, plain).indexVaultFull();
    const plainWrites = plain.queries
      .filter((q) => isWrite(q.query))
      .map((q) => ({ sql: q.query, params: q.params as unknown[] }));

    // Batched path (runBatch present): the SAME writes must land in `batched`.
    const batching = new BatchingMockAdapter();
    await batching.initialize();
    await new VaultIndexer(vaultAdapter, batching).indexVaultFull();

    // Every write, in the exact same order — the batch changes delivery, not content.
    expect(batching.batched.map(key)).toEqual(plainWrites.map(key));
    expect(batching.batched.length).toBeGreaterThan(3);
    // And with runBatch present, no write went out one-at-a-time via execute().
    expect(batching.queries.filter((q) => isWrite(q.query))).toHaveLength(0);
  });
});
