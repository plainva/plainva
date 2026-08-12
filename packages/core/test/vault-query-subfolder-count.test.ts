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
 * Folder rows counted only their direct children (S21).
 *
 * The phone listed one level per folder, so a folder holding nothing but
 * subfolders reported "0 notes" next to a chevron that leads to hundreds. The
 * fix reads the index instead — which makes the SQL itself the thing that has
 * to be right, so this runs against real SQLite (node:sqlite, Node >= 22.5)
 * rather than a mock that would only echo the query back.
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

const note = (title: string) => `---\ntype: Note\nokf_version: 0.1\n---\n\n# ${title}\n`;

describe("countNotesPerSubfolder", () => {
  it("counts every note below a subfolder, not just its direct children", async () => {
    const { DatabaseSync } = (await import("node:sqlite")) as any;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-count-"));
    const vault = new LocalVaultAdapter(tmpDir);
    await vault.initialize();
    const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);
    const indexer = new VaultIndexer(vault, db);
    const query = new VaultQueryService(db as never);

    try {
      // The reported case: a folder whose own listing holds no note at all.
      await vault.writeTextFile("Projekte/Alpha/Plan.md", note("Plan"));
      await vault.writeTextFile("Projekte/Alpha/Tief/Notiz.md", note("Notiz"));
      await vault.writeTextFile("Projekte/Beta/Eins.md", note("Eins"));
      // A note DIRECTLY in the browsed folder belongs to no subfolder.
      await vault.writeTextFile("Projekte/Lose.md", note("Lose"));
      // Attachments and databases are not notes — same predicate as listNotes.
      await vault.writeTextFile("Projekte/Alpha/Tabelle.base", "views: []\n");
      await vault.writeBinaryFile?.("Projekte/Alpha/bild.png", new Uint8Array([1, 2, 3]));
      await indexer.indexVaultFull();

      const counts = await query.countNotesPerSubfolder("Projekte");
      // Alpha holds one note directly and one two levels down.
      expect(counts.get("Alpha")).toBe(2);
      expect(counts.get("Beta")).toBe(1);
      // "Lose.md" is a note OF Projekte, not of any subfolder.
      expect(counts.get("Lose")).toBeUndefined();

      // From the root the top-level folder is what gets counted.
      const fromRoot = await query.countNotesPerSubfolder("");
      expect(fromRoot.get("Projekte")).toBe(4);
    } finally {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("does not let one folder's name leak into another's count", async () => {
    // "Projekt" is a prefix of "Projekte": a LIKE without the trailing slash
    // would fold the two together, and the segment split would then cut at the
    // wrong place.
    const { DatabaseSync } = (await import("node:sqlite")) as any;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-count2-"));
    const vault = new LocalVaultAdapter(tmpDir);
    await vault.initialize();
    const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);
    const indexer = new VaultIndexer(vault, db);
    const query = new VaultQueryService(db as never);

    try {
      await vault.writeTextFile("Projekt/A.md", note("A"));
      await vault.writeTextFile("Projekte/B.md", note("B"));
      await vault.writeTextFile("Projekte/C.md", note("C"));
      // A literal underscore is a LIKE wildcard unless it is escaped.
      await vault.writeTextFile("Pro_jekt/D.md", note("D"));
      await indexer.indexVaultFull();

      const root = await query.countNotesPerSubfolder("");
      expect(root.get("Projekt")).toBe(1);
      expect(root.get("Projekte")).toBe(2);
      expect(root.get("Pro_jekt")).toBe(1);

      const inUnderscore = await query.countNotesPerSubfolder("Pro_jekt");
      expect(inUnderscore.size).toBe(0);
    } finally {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
