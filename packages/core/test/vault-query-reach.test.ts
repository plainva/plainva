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

async function withVault(run: (query: VaultQueryService) => Promise<void>, extra: Record<string, string> = {}) {
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
    for (const [path, text] of Object.entries(extra)) await vault.writeTextFile(path, text);
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

/** The reach of a reader who may not see `Private/`, asked for many notes at once as the query asks. */
const visible = (paths: readonly string[]) => new Set(paths.filter((path) => !path.startsWith("Private/")));

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

  it("sorts and filters a note's own values as the reader sees them: a withheld link, a hidden key, a title (review of R19, wave 2)", async () => {
    for (const rule of ["in-reach", "any-kept-back"] as const) {
      const rows = async (hidden: string) => {
        let out: string[][] = [];
        await withVault(
          async (query) => {
            const config = { filters: { and: ['file.folder == "Board"'] }, views: [{ type: "table", name: "T", sort: [{ property: "owner", direction: "ASC" }, { property: "file.path", direction: "ASC" }] }] } as any;
            const withhold = { rule, hiddenKeys: ["mood"] };
            const sorted = await query.queryDatabaseFiles(config, { reach: visible, withhold });
            config.filters = { and: ['file.folder == "Board"', 'contains(owner, "Z")'] };
            const containsZ = await query.queryDatabaseFiles(config, { reach: visible, withhold });
            config.filters = { and: ['file.folder == "Board"', "mood > 3"] };
            const moody = await query.queryDatabaseFiles(config, { reach: visible, withhold });
            config.filters = { and: ['file.folder == "Board"'] };
            config.views = [{ type: "table", name: "T", sort: [{ property: "file.name", direction: "ASC" }, { property: "file.path", direction: "ASC" }] }];
            const byName = await query.queryDatabaseFiles(config, { reach: visible, withhold });
            out = [sorted, containsZ, moody, byName].map((list) => list.map((r: any) => `${r["file.path"]}=${r["file.name"]}|${r.owner ?? ""}|${r.mood ?? ""}`));
          },
          {
            [`Private/${hidden}.md`]: note("", hidden),
            "Board/A.md": note(`owner: "[[${hidden}]]"\nmood: 5\n`, "A"),
            "Board/B.md": note('owner: "[[Projects/Idle]]"\nmood: 1\n', "B"),
            "Board/C.md": `---\ntitle: "[[${hidden}]]"\n---\n# C\n`,
          },
        );
        return out;
      };
      // One hidden name sorts before every visible value, one after it: the answers are the same.
      const [aaron, zora] = [await rows("Aaron"), await rows("Zora")];
      expect(JSON.stringify(aaron), rule).not.toMatch(/Aaron|Zora/);
      expect(aaron, rule).toEqual(zora);
    }
  });

  it("asks once per note, in one question for many, and a reach that cannot answer fails the query", async () => {
    await withVault(async (query) => {
      const questions: string[][] = [];
      await query.queryDatabaseFiles(BASE(), {
        reach: async (paths) => {
          questions.push([...paths]);
          return visible(paths);
        },
      });
      const asked = questions.flat();
      expect(new Set(asked).size).toBe(asked.length);
      // One question for the reverse column's sources, one for what their links could mean, one for the rollups'.
      expect(questions.length).toBeLessThanOrEqual(4);
      // "Could not tell" is never "out of reach": the query fails, it does not answer with fewer notes.
      await expect(query.queryDatabaseFiles(BASE(), { reach: () => Promise.reject(new Error("no answer")) })).rejects.toThrow("no answer");
    });
  });

  it("a source is named alike whether a note of its name lies outside or not, and is named by its path (review of R19, wave 2)", async () => {
    const named = async (twin: boolean) => {
      let tasks: unknown;
      await withVault(async (query) => {
        tasks = (await query.queryDatabaseFiles(BASE(), { reach: visible })).find((r: any) => r["file.name"] === "Offer").tasks;
      }, twin ? { "Private/Task.md": "# a private note of the same name\n" } : {});
      return tasks;
    };
    expect(await named(false)).toEqual(["[[Projects/Task|Task]]"]);
    expect(await named(true)).toEqual(await named(false));
  });

  it("a link is resolved among the notes in reach: a note of the same name outside changes nothing (review of R19, wave 2)", async () => {
    const config = {
      filters: { and: ['file.folder == "Board"'] },
      columns: { rel: { input: "link" }, n: { rollup: { through: "rel", fn: "count" } }, h: { rollup: { through: "rel", of: "hours", fn: "sum" } } },
      views: [{ type: "table", name: "T" }],
    };
    // The reader is given `Board/` only; the twin lies at the vault's root, where the rule finds it first.
    const board = (paths: readonly string[]) => new Set(paths.filter((path) => path.startsWith("Board/")));
    const measured = async (twin: boolean, narrow: boolean) => {
      let row: any;
      await withVault(async (query) => {
        row = (await query.queryDatabaseFiles(config, narrow ? { reach: board } : {})).find((r: any) => r["file.path"] === "Board/Card.md");
      }, { "Board/Card.md": note('rel: "[[Plan]]"\n', "Card"), "Board/sub/Plan.md": note("hours: 3\n", "Plan"), ...(twin ? { "Plan.md": note("hours: 9000\n", "Plan") } : {}) });
      return { n: row.n, h: row.h };
    };
    // The vault's own view follows the link to the twin: the case the reader must not see a trace of.
    expect(await measured(true, false)).toEqual({ n: 1, h: 9000 });
    expect(await measured(false, true)).toEqual({ n: 1, h: 3 });
    expect(await measured(true, true)).toEqual({ n: 1, h: 3 });
  });

  it("backlinks and neighbours are resolved among the notes in reach: a note of the same name outside changes nothing (review of R19, wave 2)", async () => {
    const board = (paths: readonly string[]) => new Set(paths.filter((path) => path.startsWith("Board/")));
    const seen = async (twin: boolean, narrow: boolean) => {
      let out: { backlinks: string[]; neighbours: string[] } = { backlinks: [], neighbours: [] };
      await withVault(async (query) => {
        const options = narrow ? { reach: board } : {};
        out = {
          backlinks: (await query.getBacklinks("Board/sub/Plan.md", options)).map((link) => link.source_path),
          neighbours: (await query.getLinkNeighbors("Board/Card.md", 30, options)).map((n) => n.path),
        };
      }, { "Board/Card.md": note("", "Card") + "See [[Plan]].\n", "Board/sub/Plan.md": note("", "Plan"), ...(twin ? { "Plan.md": note("", "Plan") } : {}) });
      return out;
    };
    // The vault's own view follows the link to the twin at the root: the case a narrower reader must not see.
    expect(await seen(true, false)).toEqual({ backlinks: [], neighbours: ["Plan.md"] });
    expect(await seen(false, true)).toEqual({ backlinks: ["Board/Card.md"], neighbours: ["Board/sub/Plan.md"] });
    expect(await seen(true, true)).toEqual(await seen(false, true));
  });

  it("a filter on a link (`file.hasLink`) is no condition the query answers: the rows stand as without it", async () => {
    await withVault(async (query) => {
      const plain = (await query.queryDatabaseFiles(BASE(), { reach: visible })).map((r: any) => r["file.path"]).sort();
      const filtered = { ...BASE(), filters: { and: ['file.folder == "Projects"', 'file.hasLink("Private/Client")'] } };
      expect((await query.queryDatabaseFiles(filtered, { reach: visible })).map((r: any) => r["file.path"]).sort()).toEqual(plain);
      expect((await query.queryDatabaseFiles(filtered)).map((r: any) => r["file.path"]).sort()).toEqual(plain);
    });
  });

  it("computes no formula: a row carries the notes' own properties, never a value made of others", async () => {
    await withVault(async (query) => {
      const rows = await query.queryDatabaseFiles({ ...BASE(), formulas: { double: "hours * 2" }, properties: { "formula.double": {} } } as any, { reach: visible });
      for (const row of rows) expect(Object.keys(row).some((key) => key.startsWith("formula."))).toBe(false);
    });
  });

  it("a search asks for hits in the reader's folders alone, compared exactly as they are spelled", async () => {
    await withVault(async (query) => {
      const paths = async (q: string, within?: readonly string[] | null) => (await query.searchFullText(q, 50, 0, false, null, within)).map((hit) => hit.path);
      expect(await paths("Salary")).toEqual(["Private/Salary.md"]);
      expect(await paths("Salary", ["Projects"])).toEqual([]);
      expect(await paths("Task", ["Projects"])).toEqual(["Projects/Task.md"]);
      // Another spelling is another folder; a LIKE wildcard is a character of a name; nothing is no folder.
      expect(await paths("Task", ["projects"])).toEqual([]);
      expect(await paths("Task", ["Pro_ects"])).toEqual([]);
      expect(await paths("Task", ["Proj"])).toEqual([]);
      expect(await paths("Task", [])).toEqual([]);
      expect(await paths("Task", [""])).toEqual(["Projects/Task.md"]);
      expect(await paths("Task", null)).toEqual(["Projects/Task.md"]);
    });
  });
});
