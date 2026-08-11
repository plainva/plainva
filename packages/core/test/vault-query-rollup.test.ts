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
 * Rollup columns against a real vault and real SQLite (node:sqlite, Node >=
 * 22.5 — the CI runs 22): notes on disk, indexed for real, aggregated through
 * a reverse relation. A mock DB would prove the arithmetic but not the part
 * that actually breaks — that the links resolve, that the linked notes' own
 * properties are found, and that a column with no matches still gets a value.
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

async function buildVault() {
  const { DatabaseSync } = (await import("node:sqlite")) as any;
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-rollup-"));
  const vault = new LocalVaultAdapter(tmpDir);
  await vault.initialize();
  const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
  await initializeSchema(db);
  const indexer = new VaultIndexer(vault, db);
  const query = new VaultQueryService(db as never);

  const note = (front: string, title: string) => `---\ntype: Note\nokf_version: 0.1\n${front}---\n\n# ${title}\n`;

  await vault.writeTextFile("Projekte/Umsetzung.md", note("", "Umsetzung"));
  await vault.writeTextFile("Projekte/Leerlauf.md", note("", "Leerlauf"));

  // Four tasks on the busy project, none on the idle one.
  await vault.writeTextFile(
    "Aufgaben/A1.md",
    note("projekt: \"[[Umsetzung]]\"\nstatus: Offen\naufwand: 120\nFaellig: 2026-08-20\n", "A1")
  );
  await vault.writeTextFile(
    "Aufgaben/A2.md",
    note("projekt: \"[[Projekte/Umsetzung]]\"\nstatus: Erledigt\naufwand: 240\nfaellig: 2026-08-05\n", "A2")
  );
  await vault.writeTextFile(
    "Aufgaben/A3.md",
    note("projekt: \"[[Umsetzung|Das Projekt]]\"\nstatus: In Arbeit\naufwand: 60\n", "A3")
  );
  // No effort and no status at all — the "note without the property" case.
  await vault.writeTextFile("Aufgaben/A4.md", note("projekt: \"[[Umsetzung]]\"\n", "A4"));

  await indexer.indexVaultFull();
  return { db, query, tmpDir };
}

const PROJECT_BASE = (extra: Record<string, any> = {}) => ({
  filters: { and: ['file.folder == "Projekte"'] },
  columns: {
    aufgaben: { reverseOf: { base: "Aufgaben.base", property: "projekt" } },
    ...extra,
  },
  views: [{ type: "table", name: "Tabelle", order: ["file.name", ...Object.keys(extra)] }],
});

describe("queryDatabaseFiles: rollup columns", () => {
  it("counts, filters and measures through a reverse relation", async () => {
    const { db, query, tmpDir } = await buildVault();
    try {
      const rows = await query.queryDatabaseFiles(
        PROJECT_BASE({
          anzahl: { rollup: { through: "aufgaben", fn: "count" } },
          offen: {
            rollup: { through: "aufgaben", of: "status", fn: "countWhere", where: { op: "!=", value: "Erledigt" } },
          },
          fertig: {
            rollup: { through: "aufgaben", of: "status", fn: "percentWhere", where: { op: "==", value: "Erledigt" } },
          },
          aufwand: { rollup: { through: "aufgaben", of: "aufwand", fn: "sum" } },
          letzte: { rollup: { through: "aufgaben", of: "faellig", fn: "latest" } },
        })
      );
      const byName = new Map(rows.map((r: any) => [r["file.name"], r]));

      const busy = byName.get("Umsetzung")!;
      expect(busy.anzahl).toBe(4);
      // A4 has no status at all — "!= Erledigt" counts it, exactly as the
      // base filters would.
      expect(busy.offen).toBe(3);
      expect(busy.fertig).toBe(25);
      expect(busy.aufwand).toBe(420);
      // A1 spells the key "Faellig", A2 "faellig" — the same case-insensitive
      // fallback the main query applies must hold for the linked notes.
      expect(busy.letzte).toBe("2026-08-20");

      // A project without a single task still gets values — an absent column
      // would render as "no value" and look like a bug.
      const idle = byName.get("Leerlauf")!;
      expect(idle.anzahl).toBe(0);
      expect(idle.offen).toBe(0);
      expect(idle.fertig).toBe(0);
      // Nothing to measure is not zero.
      expect(idle.aufwand).toBeNull();
      expect(idle.letzte).toBeNull();
    } finally {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("follows bare, qualified and aliased wiki links alike", async () => {
    const { db, query, tmpDir } = await buildVault();
    try {
      const rows = await query.queryDatabaseFiles(
        PROJECT_BASE({ anzahl: { rollup: { through: "aufgaben", fn: "count" } } })
      );
      // A1 "[[Umsetzung]]", A2 "[[Projekte/Umsetzung]]", A3 "[[Umsetzung|Das Projekt]]", A4 bare.
      expect(rows.find((r: any) => r["file.name"] === "Umsetzung")!.anzahl).toBe(4);
    } finally {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("sorts and filters on a rollup, because it is enriched before both", async () => {
    const { db, query, tmpDir } = await buildVault();
    try {
      const config = PROJECT_BASE({ anzahl: { rollup: { through: "aufgaben", fn: "count" } } }) as any;
      config.views = [{ type: "table", name: "T", sort: [{ property: "anzahl", direction: "DESC" }] }];
      const sorted = await query.queryDatabaseFiles(config);
      expect(sorted.map((r: any) => r["file.name"])).toEqual(["Umsetzung", "Leerlauf"]);

      config.filters = { and: ['file.folder == "Projekte"', 'anzahl > "0"'] };
      const filtered = await query.queryDatabaseFiles(config);
      expect(filtered.map((r: any) => r["file.name"])).toEqual(["Umsetzung"]);
    } finally {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("leaves a rollup over a rollup empty instead of chaining derivations", async () => {
    const { db, query, tmpDir } = await buildVault();
    try {
      const rows = await query.queryDatabaseFiles(
        PROJECT_BASE({
          anzahl: { rollup: { through: "aufgaben", fn: "count" } },
          // `through` points at a computed column — refused on purpose.
          doppelt: { rollup: { through: "anzahl", fn: "count" } },
        })
      );
      const busy = rows.find((r: any) => r["file.name"] === "Umsetzung")!;
      expect(busy.anzahl).toBe(4);
      expect(busy.doppelt).toBeUndefined();
    } finally {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("aggregates a stored forward relation as well, not only reverse columns", async () => {
    const { db, query, tmpDir } = await buildVault();
    try {
      // The task base looks the other way: through the stored `projekt` link.
      const rows = await query.queryDatabaseFiles({
        filters: { and: ['file.folder == "Aufgaben"'] },
        columns: {
          projekt: { input: "link", relationBase: "Projekte.base" },
          projektname: { rollup: { through: "projekt", of: "file.name", fn: "unique" } },
        },
        views: [{ type: "table", name: "T" }],
      } as any);
      // Every task points at exactly one project.
      expect(rows.every((r: any) => r.projektname === 1)).toBe(true);
    } finally {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("ignores a malformed rollup rather than failing the query", async () => {
    const { db, query, tmpDir } = await buildVault();
    try {
      const rows = await query.queryDatabaseFiles(
        PROJECT_BASE({
          kaputt: { rollup: { through: "aufgaben", of: "status", fn: "wurzel" } },
          anzahl: { rollup: { through: "aufgaben", fn: "count" } },
        })
      );
      const busy = rows.find((r: any) => r["file.name"] === "Umsetzung")!;
      expect(busy.kaputt).toBeUndefined();
      expect(busy.anzahl).toBe(4);
    } finally {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
