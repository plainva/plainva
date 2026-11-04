import { beforeAll, describe, expect, it } from "vitest";
import { realSqlite } from "./helpers/realSqlite.js";
import { MemoryVaultAdapter } from "./helpers/memoryVault.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";
import { VaultIndexer } from "../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../src/vault/VaultQueryService.js";
import { GraphService } from "../src/vault/GraphService.js";
import { isHiddenPath, isInternalPath, visiblePathSql } from "../src/vault/internalPath.js";

/**
 * Dot files and dot folders (decision E8, Sammelplan § 3.121): a file such as
 * `.notizen.md` or `.attachments/scan.md` is part of the vault — the index
 * holds it, because the sync learns local changes from the index and content
 * encryption re-encrypts from the same table — but no surface the user reads
 * shows it, as in Obsidian. A link to it still leads to it.
 */

describe("the one rule", () => {
  it("hides a path with any segment that starts with a dot", () => {
    for (const path of [".notizen.md", ".attachments/scan.png", "Projects/.drafts/plan.md", "a/b/.hidden", "._AppleDouble.md"]) {
      expect(isHiddenPath(path), path).toBe(true);
    }
    for (const path of ["Note.md", "Projects/plan.md", "notes.plainva.png", "v1.2/notes.md", "Folder/file.CONFLICT-1.md", "plainva://graph"]) {
      expect(isHiddenPath(path), path).toBe(false);
    }
    expect(isHiddenPath("Projects\\.drafts\\plan.md")).toBe(true);
  });

  it("is wider than the internal rule: every internal dot folder is hidden, not every hidden file is internal", () => {
    for (const path of [".plainva/vault.db", ".obsidian/app.json", ".git/config", "deep/.trash/x.md"]) {
      expect(isInternalPath(path), path).toBe(true);
      expect(isHiddenPath(path), path).toBe(true);
    }
    expect(isInternalPath(".notizen.md")).toBe(false);
    expect(isHiddenPath(".notizen.md")).toBe(true);
  });

  it("says the same in SQL as in code", async () => {
    const db = await realSqlite();
    const paths = [".notizen.md", ".attachments/scan.png", "Projects/.drafts/plan.md", "Note.md", "Projects/plan.md", "notes.plainva.png", "v1.2/notes.md"];
    await db.execute("CREATE TABLE p (path TEXT)");
    for (const path of paths) await db.execute("INSERT INTO p (path) VALUES (?)", [path]);
    const visible = (await db.query<{ path: string }>(`SELECT path FROM p WHERE ${visiblePathSql("path")}`)).map((r) => r.path).sort();
    expect(visible).toEqual(paths.filter((p) => !isHiddenPath(p)).sort());
  });
});

const BASE = "views:\n  - type: table\n    name: All\n";
const NOTES: Record<string, string> = {
  "Note.md": "# Note\n\nSee [[.notizen]] and [[Hidden plan]] and [[Visible]]. Keyword kiwi. #fruit\n\n- [ ] visible task\n",
  "Visible.md": "# Visible\n\nkiwi here too, linking [[Note]]. #fruit\n",
  ".notizen.md": "# Notizen\n\nkiwi in a dot file, linking [[Note]]. #fruit #secret\n\n- [ ] hidden task\n",
  ".attachments/Hidden plan.md": "# Hidden plan\n\nkiwi in a dot folder, linking [[Note]].\n",
  "All.base": BASE,
};

async function indexed() {
  const db = await realSqlite();
  const files = new MemoryVaultAdapter(1_000);
  for (const [path, text] of Object.entries(NOTES)) await files.writeTextFile(path, text);
  await new VaultIndexer(files, db).indexVaultFull();
  return { db, files, query: new VaultQueryService(db) };
}

describe("hidden files stay in the index and out of every list", () => {
  let db: IDatabaseAdapter;
  let query: VaultQueryService;
  beforeAll(async () => ({ db, query } = await indexed()));

  it("the index holds them — the sync and the encryption read it", async () => {
    const rows = (await db.query<{ path: string }>("SELECT path FROM files")).map((r) => r.path);
    expect(rows).toEqual(expect.arrayContaining([".notizen.md", ".attachments/Hidden plan.md"]));
  });

  it("search finds no hidden file, also by path", async () => {
    expect((await query.searchFullText("kiwi")).map((r) => r.path).sort()).toEqual(["Note.md", "Visible.md"]);
    expect((await query.searchFullText("path:attachments")).map((r) => r.path)).toEqual([]);
    expect((await query.searchFilesByTitle("Hidden")).map((r) => r.path)).toEqual([]);
    expect((await query.getRecentFiles(50)).map((r) => r.path).filter(isHiddenPath)).toEqual([]);
  });

  it("a backlinks list leaves out links from hidden files; a rename still sees them", async () => {
    expect((await query.getBacklinks("Note.md", { visibleOnly: true })).map((l) => l.source_path)).toEqual(["Visible.md"]);
    expect((await query.getBacklinks("Note.md")).map((l) => l.source_path).sort()).toEqual([".attachments/Hidden plan.md", ".notizen.md", "Visible.md"]);
  });

  it("a link to a hidden file still leads to it", async () => {
    expect(await query.resolveNotePath(".notizen", "Note.md")).toBe(".notizen.md");
    expect(await query.resolveNotePath("Hidden plan", "Note.md")).toBe(".attachments/Hidden plan.md");
  });

  it("tags, tasks, database rows and find & replace leave hidden notes out", async () => {
    expect(await query.getAllTags()).toEqual([{ tag: "fruit", count: 2 }]);
    expect((await query.getFilesByTag("fruit")).map((r) => r.path).sort()).toEqual(["Note.md", "Visible.md"]);
    expect((await query.listTasks()).map((t) => t.path)).toEqual(["Note.md"]);
    expect((await query.queryDatabaseFiles({})).map((r: Record<string, unknown>) => r["file.path"]).sort()).toEqual(["Note.md", "Visible.md"]);
    expect((await query.findInVault("kiwi")).map((r) => r.path).sort()).toEqual(["Note.md", "Visible.md"]);
  });

  it("folder counts and the notes edited in a window count no hidden note", async () => {
    const counts = await query.countNotesPerSubfolder("");
    expect([...counts.keys()]).toEqual([]);
    expect((await query.listNotesModifiedBetween(0, Number.MAX_SAFE_INTEGER)).map((r) => r.path).filter(isHiddenPath)).toEqual([]);
  });

  it("the graph has no hidden node, and a link to a hidden file is neither an edge nor broken", async () => {
    const graph = await new GraphService(db).loadGraph({ includeAttachments: true });
    expect([...graph.nodes.keys()].sort()).toEqual(["Note.md", "Visible.md"]);
    expect(graph.edges.filter((e) => isHiddenPath(e.source) || isHiddenPath(e.target))).toEqual([]);
    expect(graph.broken.map((b) => b.target)).toEqual([]);
  });
});
