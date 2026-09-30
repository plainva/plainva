import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { VaultIndexer } from "../src/vault/VaultIndexer.ts";
import { SyncQueue } from "../src/sync/SyncQueue.ts";
import type { VaultListing } from "../src/vault/IVaultAdapter.ts";
import { realSqlite } from "./helpers/realSqlite.ts";

/**
 * Issue #110: a file moved in another app stayed at its old place in the tree,
 * and its tab said "This file no longer exists". Three holes, each closed here:
 *
 *  - the full scan deleted vanished rows by sha256(path) — a row moved inside
 *    Plainva earlier keeps the id of its OLD path, so the delete missed it and
 *    the row survived every scan (the class of #34, closed on the full scan);
 *  - a folder refresh only ever indexed what IS there, never what vanished
 *    (`reconcileFolder`);
 *  - operating-system bookkeeping was indexed like the user's files (E10).
 *
 * And the rule that holds throughout (plan § 6): no new exclusion rule may
 * reach the sync layer as a deletion. Only a file that genuinely vanished is
 * reported, exactly once — that is how an external move propagates.
 */

const APPLE_DOUBLE = new Uint8Array([0x00, 0x05, 0x16, 0x07, 0x00, 0x02, 0x00, 0x00, 0x4d, 0x61, 0x63]);
const sha = (p: string) => createHash("sha256").update(p).digest("hex");

/** A listing that could not read ONE entry — reported on that entry alone. */
class SkippingAdapter extends LocalVaultAdapter {
  unreadable: string[] = [];
  async listDirReport(dir = "", recursive = false): Promise<VaultListing> {
    const files = (await this.listDir(dir, recursive)).filter((f) => !this.unreadable.includes(f.path));
    return { files, skipped: this.unreadable.map((p) => ({ path: p, reason: "unreadable" as const })) };
  }
}

async function harness(prefix: string) {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const vault = new SkippingAdapter(tmpDir);
  await vault.initialize();
  const db = await realSqlite();
  const deleted: string[] = [];
  const created: string[] = [];
  const indexer = new VaultIndexer(vault, db, {
    onLocalFileDeleted: (p) => deleted.push(p),
    onNewLocalFile: (p) => created.push(p),
  });
  const rows = async () => (await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path);
  const move = (from: string, to: string) => fs.rename(path.join(tmpDir, from), path.join(tmpDir, to));
  return {
    tmpDir, vault, db, indexer, deleted, created, rows, move, queue: new SyncQueue(db),
    async dispose() {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

describe("full scan after a move outside Plainva (#110, E8)", () => {
  it("removes a row whose id went stale inside Plainva once the file moved on outside", async () => {
    const h = await harness("plainva-ext-move-");
    try {
      await h.vault.createDir("4 blog/taken");
      await h.vault.writeTextFile("4 blog/draft.md", "# The Markdown Link no. 50\n");
      await h.indexer.indexVaultFull();

      // Inside Plainva: renamed. queueRename rewrites the path and keeps the
      // id of the OLD path (SyncQueue.ts, it is the cascade parent).
      await h.vault.renameItem("4 blog/draft.md", "4 blog/link-50.md");
      await h.queue.queueRename("4 blog/draft.md", "4 blog/link-50.md");
      const stale = await h.db.queryOne<{ id: string }>("SELECT id FROM files WHERE path = ?", ["4 blog/link-50.md"]);
      expect(stale?.id, "precondition: the row carries the old id").toBe(sha("4 blog/draft.md"));

      // Outside Plainva, before anything re-indexed it: moved into a subfolder.
      await h.move("4 blog/link-50.md", "4 blog/taken/link-50.md");
      h.deleted.length = 0;
      h.created.length = 0;

      await h.indexer.indexVaultFull();
      expect(await h.rows()).toEqual(["4 blog/taken/link-50.md"]);

      // Once more: a second scan must find nothing left to do.
      h.deleted.length = 0;
      const again = await h.indexer.indexVaultFull();
      expect(again.removed).toBe(0);
      expect(h.deleted).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("reports only the path that really vanished to the sync layer — once", async () => {
    const h = await harness("plainva-ext-move-report-");
    try {
      await h.vault.createDir("a");
      await h.vault.writeTextFile("a/one.md", "# One\n");
      await h.vault.writeTextFile("a/two.md", "# Two\n");
      await h.indexer.indexVaultFull();
      await h.vault.renameItem("a/one.md", "a/uno.md");
      await h.queue.queueRename("a/one.md", "a/uno.md");
      await h.vault.createDir("b");
      await h.move("a/uno.md", "b/uno.md");
      h.deleted.length = 0;

      await h.indexer.indexVaultFull();
      await h.indexer.indexVaultFull();

      // The old place is reported once (the remote copy there goes, the new
      // one is uploaded as new) — never the note that is still there.
      expect(h.deleted).toEqual(["a/uno.md"]);
      expect(await h.rows()).toEqual(["a/two.md", "b/uno.md"]);
    } finally {
      await h.dispose();
    }
  });

  it("keeps protecting exactly the entry the walk could not read, and nothing beside it", async () => {
    const h = await harness("plainva-ext-move-skip-");
    try {
      await h.vault.createDir("docs");
      await h.vault.writeTextFile("docs/odd.md", "# Odd\n");
      await h.vault.writeTextFile("docs/moved.md", "# Moved\n");
      await h.indexer.indexVaultFull();
      await fs.rm(path.join(h.tmpDir, "docs", "moved.md"));
      h.vault.unreadable = ["docs/odd.md"];
      h.deleted.length = 0;

      await h.indexer.indexVaultFull();
      expect(await h.rows()).toEqual(["docs/odd.md"]);
      expect(h.deleted).toEqual(["docs/moved.md"]);
    } finally {
      await h.dispose();
    }
  });
});

describe("operating-system bookkeeping (#110, E10)", () => {
  it("is never indexed; a row an older version wrote leaves without a deletion", async () => {
    const h = await harness("plainva-junk-");
    try {
      await h.vault.createDir("notes");
      await h.vault.writeTextFile("notes/x.md", "# X\n");
      await h.vault.writeBinaryFile("notes/.DS_Store", new Uint8Array([0, 0, 0, 1, 66, 117, 100, 49]));
      await h.vault.writeTextFile("notes/Thumbs.db", "junk");
      await h.vault.writeBinaryFile("notes/._x.md", APPLE_DOUBLE);
      // A user's own note that only looks like AppleDouble by name.
      await h.vault.writeTextFile("notes/._notes.md", "# Mine\n");

      // Rows an EXISTING vault carries from before the rule.
      for (const p of ["notes/.DS_Store", "notes/._x.md"]) {
        await h.db.execute(
          "INSERT INTO files (id, path, title, mode, mtime_local, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
          [sha(p), p, p, "attachment", 1, 8],
        );
      }

      await h.indexer.indexVaultFull();
      expect(await h.rows()).toEqual(["notes/._notes.md", "notes/x.md"]);
      // Forgotten, not deleted: nothing reached the sync layer, so the copies
      // an older version uploaded stay in the cloud.
      expect(h.deleted).toEqual([]);
      expect(h.created.sort()).toEqual(["notes/._notes.md", "notes/x.md"]);
    } finally {
      await h.dispose();
    }
  });

  it("indexPath skips an AppleDouble sidecar and still indexes the user's `._` note", async () => {
    const h = await harness("plainva-junk-path-");
    try {
      await h.vault.writeTextFile("x.md", "# X\n");
      await h.vault.writeBinaryFile("._x.md", APPLE_DOUBLE);
      await h.vault.writeTextFile("._mine.md", "# Mine\n");
      await h.vault.writeBinaryFile(".DS_Store", new Uint8Array([1, 2, 3]));
      expect(await h.indexer.indexPath("._x.md")).toBe("unchanged");
      expect(await h.indexer.indexPath(".DS_Store")).toBe("unchanged");
      expect(await h.indexer.indexPath("._mine.md")).toBe("indexed");
      expect(await h.rows()).toEqual(["._mine.md"]);
    } finally {
      await h.dispose();
    }
  });

  it("a vanished sidecar beside its note is forgotten, not reported", async () => {
    const h = await harness("plainva-junk-vanished-");
    try {
      await h.vault.writeTextFile("x.md", "# X\n");
      await h.db.execute(
        "INSERT INTO files (id, path, title, mode, mtime_local, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
        [sha("._x.md"), "._x.md", "._x", "attachment", 1, 8],
      );
      await h.indexer.indexVaultFull();
      expect(await h.rows()).toEqual(["x.md"]);
      expect(h.deleted).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});

describe("reconcileFolder (#110, E8)", () => {
  it("removes what vanished from the folder, indexes what arrived, and leaves the rest", async () => {
    const h = await harness("plainva-reconcile-");
    try {
      await h.vault.createDir("4 blog/taken");
      await h.vault.createDir("4 blog/drafts");
      await h.vault.writeTextFile("4 blog/index.md", "# Blog\n");
      await h.vault.writeTextFile("4 blog/link-50.md", "# 50\n");
      await h.vault.writeTextFile("4 blog/drafts/d.md", "# D\n");
      await h.vault.writeTextFile("elsewhere.md", "# E\n");
      await h.indexer.indexVaultFull();

      // Outside Plainva: moved into the subfolder, and a draft file vanished.
      await h.move("4 blog/link-50.md", "4 blog/taken/link-50.md");
      await fs.rm(path.join(h.tmpDir, "4 blog", "drafts", "d.md"));
      h.deleted.length = 0;

      const flat = await h.indexer.reconcileFolder("4 blog", { recursive: false });
      expect(flat.removed).toEqual(["4 blog/link-50.md"]);
      expect(flat.indexed).toEqual([]);
      // The subfolders still exist: a flat pass leaves their rows to their own events.
      expect(await h.rows()).toEqual(["4 blog/drafts/d.md", "4 blog/index.md", "elsewhere.md"]);

      const deep = await h.indexer.reconcileFolder("4 blog");
      expect(deep.removed).toEqual(["4 blog/drafts/d.md"]);
      expect(deep.indexed).toEqual(["4 blog/taken/link-50.md"]);
      expect(await h.rows()).toEqual(["4 blog/index.md", "4 blog/taken/link-50.md", "elsewhere.md"]);
      expect(h.deleted).toEqual(["4 blog/link-50.md", "4 blog/drafts/d.md"]);
    } finally {
      await h.dispose();
    }
  });

  it("a flat pass removes the rows of a subfolder that is gone", async () => {
    const h = await harness("plainva-reconcile-sub-");
    try {
      await h.vault.createDir("p/old");
      await h.vault.writeTextFile("p/old/a.md", "# A\n");
      await h.vault.writeTextFile("p/old/b.md", "# B\n");
      await h.indexer.indexVaultFull();
      await h.move("p/old", "p-new");

      const report = await h.indexer.reconcileFolder("p", { recursive: false });
      expect(report.foldersRemoved).toBe(true);
      expect(report.removed.sort()).toEqual(["p/old/a.md", "p/old/b.md"]);
      expect(await h.rows()).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("never reaches into a sibling whose name differs only in case, or shares a prefix", async () => {
    const h = await harness("plainva-reconcile-case-");
    try {
      await h.vault.createDir("Notes");
      await h.vault.writeTextFile("Notes/a.md", "# A\n");
      await h.indexer.indexVaultFull();
      // Rows of folders that are NOT this one. On a case-sensitive disk
      // "notes" is a different folder; LIKE would fold the case.
      for (const p of ["notes/other.md", "Notes2/c.md", "Notes_x/d.md"]) {
        await h.db.execute(
          "INSERT INTO files (id, path, title, mode, mtime_local, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
          [sha(p), p, p, "obsidian", 1, 8],
        );
      }
      await h.indexer.reconcileFolder("Notes");
      await h.indexer.reconcileFolder("Notes", { recursive: false });
      expect(await h.rows()).toEqual(["Notes/a.md", "Notes2/c.md", "Notes_x/d.md", "notes/other.md"]);
      expect(h.deleted).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("judges nothing in a folder it could not read, and only the unreadable entry otherwise", async () => {
    const h = await harness("plainva-reconcile-unreadable-");
    try {
      await h.vault.createDir("d");
      await h.vault.writeTextFile("d/a.md", "# A\n");
      await h.vault.writeTextFile("d/b.md", "# B\n");
      await h.indexer.indexVaultFull();
      await fs.rm(path.join(h.tmpDir, "d", "a.md"));
      await fs.rm(path.join(h.tmpDir, "d", "b.md"));

      h.vault.unreadable = ["d"];
      await h.indexer.reconcileFolder("d");
      expect(await h.rows()).toEqual(["d/a.md", "d/b.md"]);

      h.vault.unreadable = ["d/a.md"];
      await h.indexer.reconcileFolder("d");
      expect(await h.rows()).toEqual(["d/a.md"]);
      expect(h.deleted).toEqual(["d/b.md"]);
    } finally {
      await h.dispose();
    }
  });

  it("treats a folder that is proven gone as empty", async () => {
    const h = await harness("plainva-reconcile-gone-");
    try {
      await h.vault.createDir("gone");
      await h.vault.writeTextFile("gone/a.md", "# A\n");
      await h.indexer.indexVaultFull();
      await fs.rm(path.join(h.tmpDir, "gone"), { recursive: true });
      h.vault.unreadable = ["gone"];
      const report = await h.indexer.reconcileFolder("gone", { recursive: false });
      expect(report.removed).toEqual(["gone/a.md"]);
      expect(await h.rows()).toEqual([]);
    } finally {
      await h.dispose();
    }
  });

  it("forgets bookkeeping silently here too", async () => {
    const h = await harness("plainva-reconcile-junk-");
    try {
      await h.vault.writeTextFile("x.md", "# X\n");
      await h.vault.writeBinaryFile("._x.md", APPLE_DOUBLE);
      await h.db.execute(
        "INSERT INTO files (id, path, title, mode, mtime_local, size_bytes) VALUES (?, ?, ?, ?, ?, ?)",
        [sha("._x.md"), "._x.md", "._x", "attachment", 1, 8],
      );
      const report = await h.indexer.reconcileFolder("", { recursive: false });
      expect(report.removed).toEqual(["._x.md"]);
      expect(report.indexed).toEqual(["x.md"]);
      expect(h.deleted).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});
