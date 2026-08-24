import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { VaultIndexer, isInternalPath } from "../src/vault/VaultIndexer.ts";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { initializeSchema } from "../src/db/Schema.ts";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.ts";

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
  async transaction<T>(fn: (adapter: IDatabaseAdapter) => Promise<T>): Promise<T> { return fn(this); }
  async initialize(): Promise<void> {}
  async close(): Promise<void> { this.db.close(); }
}

/**
 * Issue #70: a vault that is also a git repo carries tooling next to the notes.
 * The exclusion list knew `.git` and `node_modules` but not a Python venv or a
 * linter cache, so Plainva walked into `tools/.venv` and `.rumdl_cache` and
 * tripped over what it found there.
 */


describe("isInternalPath", () => {
  it("excludes developer tooling that sits next to notes", () => {
    for (const p of [
      "tools/.venv/lib64/x.py",          // the venv from issue #70
      ".rumdl_cache/.gitignore",         // the linter cache from issue #70
      "src/__pycache__/mod.pyc",
      ".mypy_cache/3.12/x.json",
      ".pytest_cache/v/cache/lastfailed",
      ".ruff_cache/content",
      ".tox/py312/x",
      ".idea/workspace.xml",
      ".vscode/settings.json",
      ".turbo/daemon/x.log",
      ".cache/anything",
    ]) {
      expect(isInternalPath(p), p).toBe(true);
    }
  });

  it("still excludes what it always did", () => {
    for (const p of [".plainva/backups/x", ".git/HEAD", "node_modules/pkg/i.js",
                     ".obsidian/app.json", ".trash/x.md", ".smart-env/y", ".stfolder-1/z"]) {
      expect(isInternalPath(p), p).toBe(true);
    }
  });

  it("leaves the user's own folders alone", () => {
    // The pattern rule is anchored on a leading dot on PURPOSE: these are notes,
    // not tooling, and a substring rule would have swallowed them.
    for (const p of [
      "Projekte/Build/plan.md",          // a project stage, not a build dir
      "Kunden/Target/brief.md",          // a target audience
      "venv/notes.md",                   // no leading dot -> user's folder
      "read_cache/article.md",           // no leading dot -> user's folder
      "Archiv/node_modules_alt/x.md",    // whole-segment match, not substring
      ".env-notes.md",                   // a user's own dot-FILE stays visible
      "notes/.attachments/img.png",      // issue #70: their own attachment folder
    ]) {
      expect(isInternalPath(p), p).toBe(false);
    }
  });
});

describe("a path that became internal is not reported as a deletion", () => {
  it("de-indexes it silently, while a real deletion still reports", async () => {
    const { DatabaseSync } = (await import("node:sqlite")) as any;
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-internal-"));
    const vaultAdapter = new LocalVaultAdapter(tmpDir);
    await vaultAdapter.initialize();
    const db = new NodeSqliteAdapter(new DatabaseSync(":memory:"));
    await initializeSchema(db);

    const deleted: string[] = [];
    const indexer = new VaultIndexer(vaultAdapter, db, {
      onLocalFileDeleted: (p: string) => deleted.push(p),
    });

    try {
      await vaultAdapter.writeTextFile("notes/keep.md", "# keep");
      await vaultAdapter.writeTextFile("notes/gone.md", "# gone");
      await indexer.indexVaultFull();
      deleted.length = 0;
      // Indexed under the OLD rules, i.e. what an existing vault carries today.
      // A row an EXISTING vault carries: indexed before .venv was excluded. The
      // id is sha256(path) because that is what the indexer writes and what its
      // delete keys on — a made-up id would make this test pass for the wrong reason.
      const legacyPath = "tools/.venv/lib/site.md";
      const legacyId = createHash("sha256").update(legacyPath).digest("hex");
      await db.execute(
        "INSERT INTO files (id, path, title, mode, mtime_local, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
        [legacyId, legacyPath, "site", "note", 1, 10]
      );

      // The user deletes one note for real; the venv only became invisible.
      await fs.rm(path.join(tmpDir, "notes", "gone.md"));

      const report = await indexer.indexVaultFull();

      // Both leave the index: one vanished from disk, one became internal.
      const rows = await db.query<{ path: string }>("SELECT path FROM files ORDER BY path");
      expect(rows.map((r) => r.path)).toEqual(["notes/keep.md"]);
      expect(report.removed).toBe(2);

      // Only the vanished one may reach the sync layer. Reporting the venv would
      // queue a remote delete per file and trip the mass-deletion guard.
      expect(deleted).toEqual(["notes/gone.md"]);
    } finally {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
