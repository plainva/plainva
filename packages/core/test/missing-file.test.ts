import { describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { VaultIndexer } from "../src/vault/VaultIndexer.ts";
import { readIndexedIdentity, resolveMissingFile, searchMissingFile } from "../src/vault/missingFile.ts";
import { realSqlite } from "./helpers/realSqlite.ts";

/**
 * Issue #110 (E9): the tab of a note moved outside Plainva said "This file no
 * longer exists" while the file sat two folders further. The note is found by
 * its content hash; exactly one candidate written at the same time is
 * followed, anything less certain is offered, none leaves the missing state —
 * with the stale index row already gone.
 */

async function harness() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-missing-"));
  const vault = new LocalVaultAdapter(tmpDir);
  await vault.initialize();
  const db = await realSqlite();
  const deleted: string[] = [];
  const indexer = new VaultIndexer(vault, db, { onLocalFileDeleted: (p) => deleted.push(p) });
  const rows = async () => (await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path);
  const deps = { exists: (p: string) => vault.exists(p), db, indexer };
  return {
    tmpDir, vault, db, indexer, deps, rows, deleted,
    move: (from: string, to: string) => fs.rename(path.join(tmpDir, from), path.join(tmpDir, to)),
    dispose: async () => { await db.close(); await fs.rm(tmpDir, { recursive: true, force: true }); },
  };
}

describe("resolveMissingFile", () => {
  it("follows the one file with the same content, even when nobody indexed it yet", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("4 blog/taken");
      await h.vault.writeTextFile("4 blog/link-50.md", "# The Markdown Link no. 50\n");
      await h.indexer.indexVaultFull();
      // Moved in Finder; the watcher lost the old side and nothing ran since.
      await h.move("4 blog/link-50.md", "4 blog/taken/link-50.md");

      const outcome = await resolveMissingFile("4 blog/link-50.md", h.deps);
      expect(outcome).toEqual({ kind: "moved", to: "4 blog/taken/link-50.md" });
      expect(await h.rows()).toEqual(["4 blog/taken/link-50.md"]);
    } finally {
      await h.dispose();
    }
  });

  it("follows a rename inside the same folder — the parent reconcile indexes it", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("4 blog");
      await h.vault.writeTextFile("4 blog/link-50.md", "# The Markdown Link no. 50\n");
      await h.vault.writeTextFile("4 blog/index.md", "# Blog\n");
      await h.indexer.indexVaultFull();
      await h.move("4 blog/link-50.md", "4 blog/2026-09-23-link-50.md");

      const outcome = await resolveMissingFile("4 blog/link-50.md", h.deps);
      expect(outcome).toEqual({ kind: "moved", to: "4 blog/2026-09-23-link-50.md" });
      expect(await h.rows()).toEqual(["4 blog/2026-09-23-link-50.md", "4 blog/index.md"]);
    } finally {
      await h.dispose();
    }
  });

  it("offers, but never follows, a single look-alike written at another time", async () => {
    // Two untouched notes from one template carry the same content. Deleting
    // one outside Plainva is not a move: the tab must not open the other and
    // call it "moved" — the reader is asked instead.
    const h = await harness();
    try {
      await h.vault.createDir("daily");
      await h.vault.writeTextFile("daily/2026-09-20.md", "## Tasks\n- [ ] \n");
      await h.vault.writeTextFile("daily/2026-09-21.md", "## Tasks\n- [ ] \n");
      await fs.utimes(path.join(h.tmpDir, "daily/2026-09-20.md"), new Date("2026-09-20T07:00:00Z"), new Date("2026-09-20T07:00:00Z"));
      await fs.utimes(path.join(h.tmpDir, "daily/2026-09-21.md"), new Date("2026-09-21T07:00:00Z"), new Date("2026-09-21T07:00:00Z"));
      await h.indexer.indexVaultFull();
      await fs.rm(path.join(h.tmpDir, "daily/2026-09-20.md"));

      const outcome = await resolveMissingFile("daily/2026-09-20.md", h.deps);
      expect(outcome).toEqual({ kind: "ambiguous", candidates: ["daily/2026-09-21.md"] });
      // The stale row is gone all the same; the look-alike is untouched.
      expect(await h.rows()).toEqual(["daily/2026-09-21.md"]);
      expect(await fs.readFile(path.join(h.tmpDir, "daily/2026-09-21.md"), "utf8")).toBe("## Tasks\n- [ ] \n");
    } finally {
      await h.dispose();
    }
  });

  it("asks instead of guessing when an older copy carries the same content", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("a");
      await h.vault.createDir("b");
      await h.vault.writeTextFile("a/note.md", "# Same\n");
      await h.vault.writeTextFile("b/copy.md", "# Same\n");
      // The copy is a day older than the note it copies.
      await fs.utimes(path.join(h.tmpDir, "b/copy.md"), new Date("2026-09-22T08:00:00Z"), new Date("2026-09-22T08:00:00Z"));
      await fs.utimes(path.join(h.tmpDir, "a/note.md"), new Date("2026-09-23T08:00:00Z"), new Date("2026-09-23T08:00:00Z"));
      await h.indexer.indexVaultFull();
      await h.move("a/note.md", "b/note.md");

      const outcome = await resolveMissingFile("a/note.md", h.deps);
      expect(outcome).toEqual({ kind: "ambiguous", candidates: ["b/copy.md", "b/note.md"] });
    } finally {
      await h.dispose();
    }
  });

  it("removes the stale row without a click once the file is proven missing", async () => {
    const h = await harness();
    try {
      await h.vault.writeTextFile("gone.md", "# Gone\n");
      await h.vault.writeTextFile("other.md", "# Other\n");
      await h.indexer.indexVaultFull();
      await fs.rm(path.join(h.tmpDir, "gone.md"));

      expect(await resolveMissingFile("gone.md", h.deps)).toEqual({ kind: "gone" });
      expect(await h.rows()).toEqual(["other.md"]);
      expect(h.deleted).toEqual(["gone.md"]);
    } finally {
      await h.dispose();
    }
  });

  it("never matches on an empty note — every empty note shares that hash", async () => {
    const h = await harness();
    try {
      await h.vault.writeTextFile("empty-1.md", "");
      await h.vault.writeTextFile("empty-2.md", "");
      await h.indexer.indexVaultFull();
      await fs.rm(path.join(h.tmpDir, "empty-1.md"));
      expect(await resolveMissingFile("empty-1.md", h.deps)).toEqual({ kind: "gone" });
    } finally {
      await h.dispose();
    }
  });

  it("touches nothing when the file is there, or when the disk cannot answer", async () => {
    const h = await harness();
    try {
      await h.vault.writeTextFile("here.md", "# Here\n");
      await h.indexer.indexVaultFull();
      const reconcile = vi.spyOn(h.indexer, "reconcileFolder");
      expect(await resolveMissingFile("here.md", h.deps)).toEqual({ kind: "present" });
      const failing = { ...h.deps, exists: async () => { throw new Error("EACCES"); } };
      expect(await resolveMissingFile("here.md", failing)).toEqual({ kind: "present" });
      expect(reconcile).not.toHaveBeenCalled();
      expect(await h.rows()).toEqual(["here.md"]);
    } finally {
      await h.dispose();
    }
  });
});

describe("searchMissingFile", () => {
  it("follows a note that is open while it moves: what the tab knew stands in for the row the watcher removed", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("4 blog/taken");
      await h.vault.writeTextFile("4 blog/link-50.md", "# The Markdown Link no. 50\n");
      await h.vault.writeTextFile("4 blog/taken/keep.md", "# Keep\n");
      await h.indexer.indexVaultFull();
      // The open tab remembers the identity of what it loaded.
      const known = await readIndexedIdentity(h.db, "4 blog/link-50.md");
      await h.move("4 blog/link-50.md", "4 blog/taken/link-50.md");
      // The watcher reported both sides: the row is gone, the new place indexed.
      await h.indexer.indexPath("4 blog/link-50.md");
      await h.indexer.indexPath("4 blog/taken/link-50.md");
      expect(await readIndexedIdentity(h.db, "4 blog/link-50.md")).toBeNull();
      const full = vi.spyOn(h.indexer, "indexVaultFull");

      const search = await searchMissingFile("4 blog/link-50.md", h.deps, known);
      expect(search.first).toEqual({ kind: "moved", to: "4 blog/taken/link-50.md" });
      // Certain at once: no full reconcile in front of the answer, nor behind it.
      expect(search.settled).toBeNull();
      expect(full).not.toHaveBeenCalled();
      // Without the remembered identity there is nothing to look for.
      expect(await resolveMissingFile("4 blog/link-50.md", h.deps)).toEqual({ kind: "gone" });
    } finally {
      await h.dispose();
    }
  });

  it("answers from the parent folder at once and settles after the full reconcile", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("4 blog/taken");
      await h.vault.writeTextFile("4 blog/link-50.md", "# The Markdown Link no. 50\n");
      await h.indexer.indexVaultFull();
      await h.move("4 blog/link-50.md", "4 blog/taken/link-50.md");
      let fullDone = false;
      const full = h.indexer.indexVaultFull.bind(h.indexer);
      vi.spyOn(h.indexer, "indexVaultFull").mockImplementation(async () => {
        const report = await full();
        fullDone = true;
        return report;
      });

      const search = await searchMissingFile("4 blog/link-50.md", h.deps);
      // Nobody indexed the new place yet: the first answer does not wait for
      // the vault-wide pass that finds it.
      expect(search.first).toEqual({ kind: "gone" });
      expect(fullDone).toBe(false);
      expect(await search.settled).toEqual({ kind: "moved", to: "4 blog/taken/link-50.md" });
      expect(fullDone).toBe(true);
    } finally {
      await h.dispose();
    }
  });
});
