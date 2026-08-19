import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { VaultIndexer } from "../src/vault/VaultIndexer.ts";
import { VaultQueryService } from "../src/vault/VaultQueryService.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";

/**
 * The anchor index behind task adoption.
 *
 * Runs on real SQLite rather than the query-recording mock for one reason: the
 * whole point is HOW the indexer stores a nested frontmatter namespace. A mock
 * would answer with whatever shape this test assumed, which is precisely the
 * thing that must be verified.
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
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-anchors-"));
  const vaultAdapter = new LocalVaultAdapter(tmpDir);
  await vaultAdapter.initialize();
  const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
  await initializeSchema(db);
  const indexer = new VaultIndexer(vaultAdapter, db);
  const query = new VaultQueryService(db);
  return {
    vaultAdapter,
    indexer,
    query,
    async dispose() {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

const note = (pim: string, body = "# Task") => `---\ntype: task\nokf_version: "1"\nplainva:\n  pim:\n${pim}\n---\n\n${body}\n`;

describe("getTaskAnchors", () => {
  it("finds an anchor through the nested plainva namespace", async () => {
    const h = await harness();
    try {
      await h.vaultAdapter.writeTextFile(
        "Tasks/Steuern einreichen.md",
        note(`    kind: task\n    uid: u-1\n    list: l-1\n    provider: google`)
      );
      await h.indexer.indexVaultFull();

      const byUid = await h.query.getTaskAnchors();
      const hits = byUid.get("u-1");
      expect(hits).toHaveLength(1);
      expect(hits![0]!.path).toBe("Tasks/Steuern einreichen.md");
      expect(hits![0]!.list).toBe("l-1");
      expect(hits![0]!.provider).toBe("google");
    } finally {
      await h.dispose();
    }
  });

  it("keeps a legacy account id readable without letting it decide anything", async () => {
    const h = await harness();
    try {
      await h.vaultAdapter.writeTextFile(
        "Tasks/Alt.md",
        note(`    kind: task\n    uid: u-2\n    list: l-1\n    account: abc12345`)
      );
      await h.indexer.indexVaultFull();

      const rec = (await h.query.getTaskAnchors()).get("u-2")![0]!;
      expect(rec.account).toBe("abc12345");
      expect(rec.provider).toBeUndefined();
    } finally {
      await h.dispose();
    }
  });

  it("groups every note that claims the same task", async () => {
    const h = await harness();
    try {
      const anchor = `    kind: task\n    uid: dupe\n    list: l-1`;
      await h.vaultAdapter.writeTextFile("Tasks/Steuern einreichen.md", note(anchor));
      await h.vaultAdapter.writeTextFile("Tasks/Steuern einreichen 2.md", note(anchor));
      await h.indexer.indexVaultFull();

      const hits = (await h.query.getTaskAnchors()).get("dupe")!;
      expect(hits.map((r) => r.path).sort()).toEqual([
        "Tasks/Steuern einreichen 2.md",
        "Tasks/Steuern einreichen.md",
      ]);
    } finally {
      await h.dispose();
    }
  });

  it("ignores notes whose plainva namespace is not a task anchor", async () => {
    const h = await harness();
    try {
      // A time-blocked task carries `plainva.blocks` and an icon — neither is
      // an anchor, and reading them as one would adopt arbitrary notes.
      await h.vaultAdapter.writeTextFile(
        "Notes/Andere.md",
        `---\ntype: note\nplainva:\n  icon: "📌"\n  blocks:\n    - uid: ev-1\n---\n\n# Andere\n`
      );
      await h.vaultAdapter.writeTextFile("Notes/Nackt.md", `# Ohne Frontmatter\n`);
      await h.indexer.indexVaultFull();

      expect((await h.query.getTaskAnchors()).size).toBe(0);
    } finally {
      await h.dispose();
    }
  });

  it("never mistakes a meeting note's anchor for a task", async () => {
    const h = await harness();
    try {
      // Meeting notes write the SAME `plainva.pim` key, with a calendar
      // instead of a list and no `kind` at all (meetingNote.ts). Adopting one
      // would start reconciling an appointment note as a task.
      await h.vaultAdapter.writeTextFile(
        "Meetings/Jour fixe.md",
        note(`    uid: shared-uid\n    account: abc12345\n    calendar: cal-1`)
      );
      // And the same shape WITH a list — so the guard that survives is the
      // explicit "kind: task", not the accident that meetings carry no list.
      await h.vaultAdapter.writeTextFile(
        "Meetings/Anders.md",
        note(`    kind: event\n    uid: shared-uid\n    list: l-1`)
      );
      await h.indexer.indexVaultFull();

      expect((await h.query.getTaskAnchors()).get("shared-uid")).toBeUndefined();
    } finally {
      await h.dispose();
    }
  });

  it("skips an anchor that is missing its list", async () => {
    const h = await harness();
    try {
      await h.vaultAdapter.writeTextFile("Tasks/Halb.md", note(`    kind: task\n    uid: u-3`));
      await h.indexer.indexVaultFull();

      expect((await h.query.getTaskAnchors()).get("u-3")).toBeUndefined();
    } finally {
      await h.dispose();
    }
  });
});
