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
 * A database read by someone who may not see the whole vault — an assistant run that keeps a folder from the cloud,
 * an app over MCP given one folder (review of R19, wave 2). A reverse column and a rollup reach into other notes; with
 * `reach` they reach only into the notes that reader may see, and the filters and the sort that run on them see the
 * same values. Real vault, real SQLite, as in `vault-query-rollup.test.ts`.
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

const note = (front: string, title: string) => `---\ntype: Note\n${front}---\n\n# ${title}\n`;

async function withVault(run: (query: VaultQueryService) => Promise<void>) {
  const { DatabaseSync } = (await import("node:sqlite")) as any;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-reach-"));
  const vault = new LocalVaultAdapter(tmpDir);
  await vault.initialize();
  const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
  await initializeSchema(db);
  try {
    await vault.writeTextFile("Projects/Offer.md", note('client: "[[Private/Client]]"\n', "Offer"));
    await vault.writeTextFile("Projects/Idle.md", note("", "Idle"));
    await vault.writeTextFile("Projects/Task.md", note('project: "[[Offer]]"\nhours: 3\n', "Task"));
    // Notes the reader may not see: one points at a project, one is pointed at.
    await vault.writeTextFile("Private/Salary.md", note('project: "[[Offer]]"\nhours: 9000\n', "Salary"));
    await vault.writeTextFile("Private/Client.md", note("revenue: 50000\n", "Client"));
    await new VaultIndexer(vault, db).indexVaultFull();
    await run(new VaultQueryService(db as never));
  } finally {
    await db.close();
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
}

const BASE = (extra: Record<string, unknown> = {}) => ({
  filters: { and: ['file.folder == "Projects"'] },
  columns: {
    tasks: { reverseOf: { base: "Tasks.base", property: "project" } },
    count: { rollup: { through: "tasks", fn: "count" } },
    hours: { rollup: { through: "tasks", of: "hours", fn: "sum" } },
    client: { input: "link" },
    revenue: { rollup: { through: "client", of: "revenue", fn: "sum" } },
    ...extra,
  },
  views: [{ type: "table", name: "T" }],
});

const visible = (path: string) => !path.startsWith("Private/");

describe("queryDatabaseFiles: what a narrower reader may see (reach)", () => {
  it("computes reverse columns and rollups only from the notes in reach", async () => {
    await withVault(async (query) => {
      const all = await query.queryDatabaseFiles(BASE());
      const offerAll = all.find((r: any) => r["file.name"] === "Offer");
      // The vault's own view counts every note: the case the reader must not get.
      expect(offerAll.count).toBe(2);
      expect(offerAll.hours).toBe(9003);
      expect(offerAll.revenue).toBe(50000);
      expect(offerAll.tasks).toHaveLength(2);

      const narrow = await query.queryDatabaseFiles(BASE(), { reach: visible });
      const offer = narrow.find((r: any) => r["file.name"] === "Offer");
      expect(offer.count).toBe(1);
      expect(offer.hours).toBe(3);
      expect(offer.tasks).toHaveLength(1);
      expect(offer.tasks[0]).toContain("Task");
      expect(JSON.stringify(offer)).not.toMatch(/Salary|9000|9003|50000/);
      // A relation into a note out of reach is no relation: nothing to measure, as for a project without one.
      expect(offer.revenue).toBeNull();
    });
  });

  it("filters and sorts on the values the reader may see, so a row's presence tells nothing of the rest", async () => {
    await withVault(async (query) => {
      const config = BASE() as any;
      // Rows whose hidden tasks carry the hours: in the vault's view, Offer has more than 100.
      config.filters = { and: ['file.folder == "Projects"', 'hours > "100"'] };
      expect((await query.queryDatabaseFiles(config)).map((r: any) => r["file.name"])).toEqual(["Offer"]);
      expect(await query.queryDatabaseFiles(config, { reach: visible })).toEqual([]);

      config.filters = { and: ['file.folder == "Projects"'] };
      config.views = [{ type: "table", name: "T", sort: [{ property: "revenue", direction: "DESC" }, { property: "file.name", direction: "DESC" }] }];
      expect((await query.queryDatabaseFiles(config))[0]["file.name"]).toBe("Offer");
      // Out of reach, the client's revenue does not lift Offer above Idle: both have none, and the name decides.
      const sorted = (await query.queryDatabaseFiles(config, { reach: visible })).map((r: any) => r["file.name"]);
      expect(sorted).toEqual(["Task", "Offer", "Idle"]);
    });
  });

  it("asks once per note, and a note it cannot answer for is out of reach", async () => {
    await withVault(async (query) => {
      const asked: string[] = [];
      const rows = await query.queryDatabaseFiles(BASE(), {
        reach: async (path) => {
          asked.push(path);
          if (path === "Private/Client.md") throw new Error("no answer");
          return path !== "Private/Salary.md";
        },
      });
      const offer = rows.find((r: any) => r["file.name"] === "Offer");
      expect(offer.revenue).toBeNull();
      expect(offer.hours).toBe(3);
      expect(asked.filter((p) => p === "Private/Salary.md")).toHaveLength(1);
      expect(asked).toContain("Private/Client.md");
    });
  });

  it("computes no formula: a row carries the notes' own properties, never a value made of others", async () => {
    await withVault(async (query) => {
      const rows = await query.queryDatabaseFiles({ ...BASE(), formulas: { double: "hours * 2" }, properties: { "formula.double": {} } } as any, { reach: visible });
      for (const row of rows) expect(Object.keys(row).some((key) => key.startsWith("formula."))).toBe(false);
    });
  });
});
