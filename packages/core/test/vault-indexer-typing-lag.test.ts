import { describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import { readFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.ts";
import { VaultIndexer, formatFullScan, scanChangedNothing, type FullScanInfo } from "../src/vault/VaultIndexer.ts";
import { INTERNAL_PATH_RULES, isInternalPath, isInternalSegment } from "../src/vault/internalPath.ts";
import { createYielder } from "../src/vault/yielder.ts";
import { realSqlite } from "./helpers/realSqlite.ts";

/**
 * Issue #122 — "Saving makes typing really hard".
 *
 * Every autosave of a note in a subfolder ran a full scan of the vault a
 * second later: Windows reports the parent folder of a written file as
 * modified, and the indexer answered ANY folder path with "needs-full-scan".
 * The scan then reloaded the tree and every view hanging on it, changed or
 * not. What the index has to say for the fix to hold is pinned here; the
 * watcher batch and the queue are pinned in the desktop package.
 */

/** Counts what the indexer asks of the disk. */
class CountingAdapter extends LocalVaultAdapter {
  stats = 0;
  reads = 0;
  async getFileInfo(p: string) {
    this.stats++;
    return super.getFileInfo(p);
  }
  async readTextFile(p: string) {
    this.reads++;
    return super.readTextFile(p);
  }
  async readBinaryFile(p: string) {
    this.reads++;
    return super.readBinaryFile(p);
  }
}

async function harness() {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-typing-lag-"));
  const vault = new CountingAdapter(tmpDir);
  await vault.initialize();
  const db = await realSqlite();
  const deleted: string[] = [];
  const scans: FullScanInfo[] = [];
  const indexer = new VaultIndexer(vault, db, {
    onLocalFileDeleted: (p) => deleted.push(p),
    onFullScan: (info) => scans.push(info),
  });
  const rows = async () => (await db.query<{ path: string }>("SELECT path FROM files ORDER BY path")).map((r) => r.path);
  return {
    tmpDir, vault, db, indexer, deleted, scans, rows,
    async dispose() {
      await db.close();
      await fs.rm(tmpDir, { recursive: true, force: true });
    },
  };
}

describe("a folder path is not one case but two (inspectPath)", () => {
  it("tells a folder that exists from one that vanished with indexed files below it", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("Projects/Sub");
      await h.vault.createDir("Projects/Old");
      await h.vault.writeTextFile("Projects/Sub/note.md", "# Note\n");
      await h.vault.writeTextFile("Projects/Old/gone.md", "# Gone\n");
      await h.indexer.indexVaultFull();

      expect(await h.indexer.inspectPath("Projects/Sub")).toBe("directory");
      expect(await h.indexer.inspectPath("Projects/Sub/note.md")).toBe("unchanged");

      await fs.rm(path.join(h.tmpDir, "Projects/Old"), { recursive: true });
      expect(await h.indexer.inspectPath("Projects/Old")).toBe("folder-gone");
      // A vanished path nothing is indexed under is nobody's business.
      expect(await h.indexer.inspectPath("Projects/Never")).toBe("unchanged");

      // The older question keeps its older answer for both.
      expect(await h.indexer.indexPath("Projects/Sub")).toBe("needs-full-scan");
      expect(await h.indexer.indexPath("Projects/Old")).toBe("needs-full-scan");
      // Nothing was removed on the way: that is the full scan's job, with its reports.
      expect(await h.rows()).toEqual(["Projects/Old/gone.md", "Projects/Sub/note.md"]);
      expect(h.deleted).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});

describe("the app's own temp file of an atomic save", () => {
  it("is internal by rule, on every platform's spelling of it — and a user's dot-file is not", () => {
    for (const p of [
      "Projects/Sub/.plainva-tmp-412-7-note.md",   // desktop: pid, counter, name
      ".plainva-tmp-1234567890.tmp",               // Android: createTempFile
      "a/.plainva-tmp-6F9619FF-8B86-D011-B42D-00C04FC964FF", // iOS: a UUID
    ]) expect(isInternalPath(p), p).toBe(true);
    for (const p of [".env-notes.md", "Projects/.hidden.md", "plainva-tmp-notes.md", "x/.plainva-temp.md", "._notes.md"]) {
      expect(isInternalPath(p), p).toBe(false);
    }
  });

  it("costs neither a look at the disk nor a query", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("Projects/Sub");
      await fs.writeFile(path.join(h.tmpDir, "Projects/Sub/.plainva-tmp-412-7-note.md"), "half a note");
      h.vault.stats = 0;
      expect(await h.indexer.inspectPath("Projects/Sub/.plainva-tmp-412-7-note.md")).toBe("unchanged");
      expect(h.vault.stats).toBe(0);
      expect(h.vault.reads).toBe(0);
    } finally {
      await h.dispose();
    }
  });

  it("a leftover after a hard kill is never indexed, and one an older version indexed leaves without a deletion", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("Projects");
      await h.vault.writeTextFile("Projects/note.md", "# Note\n");
      await h.vault.writeTextFile("Projects/.env-notes.md", "# A user's own dot-file\n");
      await fs.writeFile(path.join(h.tmpDir, "Projects/.plainva-tmp-412-7-note.md"), "half a note");
      await h.indexer.indexVaultFull();
      expect(await h.rows()).toEqual(["Projects/.env-notes.md", "Projects/note.md"]);

      // What a version before this rule left in the index.
      await h.db.execute(
        `INSERT INTO files (id, path, title, sha256, mtime_local, ctime, size_bytes, is_cached, mode, sync_state)
         VALUES ('stale', 'Projects/.plainva-tmp-412-7-note.md', 't', 'h', 1, 1, 1, 1, 'obsidian', 'synced')`,
      );
      const report = await h.indexer.indexVaultFull();
      expect(report.removed).toBe(1);
      expect(await h.rows()).toEqual(["Projects/.env-notes.md", "Projects/note.md"]);
      // Forgotten, not deleted: nothing may reach the sync layer as a deletion.
      expect(h.deleted).toEqual([]);
    } finally {
      await h.dispose();
    }
  });
});

describe("a full scan says what it changed", () => {
  it("an unchanged vault: nothing added, changed or removed, folders as they were, no file read", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("Projects/Sub");
      await h.vault.createDir("Empty");
      await h.vault.writeTextFile("Projects/Sub/note.md", "# Note\n");
      await h.vault.writeTextFile("top.md", "# Top\n");
      await fs.writeFile(path.join(h.tmpDir, "Projects/picture.png"), new Uint8Array([1, 2, 3]));

      const first = await h.indexer.indexVaultFull("open");
      expect(first.added).toBe(3);
      expect(first.walked).toBe(3);
      // Nothing to compare with yet: unknown counts as changed.
      expect(first.foldersChanged).toBe(true);
      expect(scanChangedNothing(first)).toBe(false);

      h.vault.reads = 0;
      const second = await h.indexer.indexVaultFull("automatic refresh");
      expect(second).toMatchObject({ added: 0, changed: 0, removed: 0, walked: 3, foldersChanged: false });
      expect(scanChangedNothing(second)).toBe(true);
      expect(h.vault.reads, "an unchanged scan reads no file").toBe(0);

      expect(h.scans.map((s) => s.trigger)).toEqual(["open", "automatic refresh"]);
    } finally {
      await h.dispose();
    }
  });

  it("notices a folder that appeared or went, empty or not", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("Projects");
      await h.vault.writeTextFile("Projects/note.md", "# Note\n");
      await h.indexer.indexVaultFull();

      await h.vault.createDir("Projects/New");
      const appeared = await h.indexer.indexVaultFull();
      expect(appeared).toMatchObject({ added: 0, changed: 0, removed: 0, foldersChanged: true });
      expect((await h.indexer.indexVaultFull()).foldersChanged).toBe(false);

      await fs.rm(path.join(h.tmpDir, "Projects/New"), { recursive: true });
      expect((await h.indexer.indexVaultFull()).foldersChanged).toBe(true);
      expect((await h.indexer.indexVaultFull()).foldersChanged).toBe(false);
    } finally {
      await h.dispose();
    }
  });

  it("counts a changed file as changed, and only that", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("Projects");
      await h.vault.writeTextFile("Projects/note.md", "# Note\n");
      await h.vault.writeTextFile("Projects/other.md", "# Other\n");
      await h.indexer.indexVaultFull();
      const stamp = new Date(Date.now() + 5000);
      await fs.writeFile(path.join(h.tmpDir, "Projects/note.md"), "# Note, edited elsewhere\n");
      await fs.utimes(path.join(h.tmpDir, "Projects/note.md"), stamp, stamp);
      h.vault.reads = 0;
      const report = await h.indexer.indexVaultFull();
      expect(report).toMatchObject({ added: 0, changed: 1, removed: 0, foldersChanged: false });
      expect(h.vault.reads).toBe(1);
    } finally {
      await h.dispose();
    }
  });

  it("writes one diagnostics line with counts and no name of anything", () => {
    const line = formatFullScan({
      trigger: "watcher: folder created or renamed", added: 2, changed: 1, removed: 0,
      skipped: [{ path: "Secret Folder/private", reason: "unreadable" }], durationMs: 412.4, walked: 20120, foldersChanged: true,
    });
    expect(line).toBe("full scan (watcher: folder created or renamed): 20120 files walked in 412 ms — 2 added, 1 changed, 0 removed, folders changed, 1 skipped");
    expect(line).not.toContain("Secret");
    expect(formatFullScan({ trigger: "automatic refresh", added: 0, changed: 0, removed: 0, skipped: [], durationMs: 80, walked: 5000, foldersChanged: false }))
      .toBe("full scan (automatic refresh): 5000 files walked in 80 ms — nothing changed");
  });
});

describe("a flat look at one folder", () => {
  it("finds nothing to do in a folder that was merely reported as modified", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("Projects/Sub/Deeper");
      await h.vault.writeTextFile("Projects/Sub/note.md", "# Note\n");
      await h.vault.writeTextFile("Projects/Sub/Deeper/deep.md", "# Deep\n");
      await h.indexer.indexVaultFull();
      h.vault.reads = 0;
      const report = await h.indexer.reconcileFolder("Projects/Sub", { recursive: false });
      expect(report).toMatchObject({ indexed: [], removed: [], foldersRemoved: false, foldersChanged: false });
      expect(h.vault.reads).toBe(0);
    } finally {
      await h.dispose();
    }
  });

  it("indexes a file another program put there, and removes one it took away", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("Projects/Sub");
      await h.vault.writeTextFile("Projects/Sub/note.md", "# Note\n");
      await h.indexer.indexVaultFull();
      await fs.writeFile(path.join(h.tmpDir, "Projects/Sub/from-elsewhere.md"), "# Elsewhere\n");
      await fs.rm(path.join(h.tmpDir, "Projects/Sub/note.md"));
      const report = await h.indexer.reconcileFolder("Projects/Sub", { recursive: false });
      expect(report.indexed).toEqual(["Projects/Sub/from-elsewhere.md"]);
      expect(report.removed).toEqual(["Projects/Sub/note.md"]);
      expect(h.deleted).toEqual(["Projects/Sub/note.md"]);
    } finally {
      await h.dispose();
    }
  });

  it("notices an EMPTY subfolder that was deleted — no file event will ever say so", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("Projects/Sub/Empty/Nested");
      await h.vault.createDir("Projects/Sub/Kept/Inner");
      await h.vault.writeTextFile("Projects/Sub/note.md", "# Note\n");
      await h.indexer.indexVaultFull();
      await fs.rm(path.join(h.tmpDir, "Projects/Sub/Empty"), { recursive: true });

      const report = await h.indexer.reconcileFolder("Projects/Sub", { recursive: false });
      expect(report.foldersChanged).toBe(true);
      expect(report.foldersRemoved).toBe(false);
      expect(report.removed).toEqual([]);
      // Seen once: the folder list is current again, here and for the next full scan.
      expect((await h.indexer.reconcileFolder("Projects/Sub", { recursive: false })).foldersChanged).toBe(false);
      expect((await h.indexer.indexVaultFull()).foldersChanged).toBe(false);
    } finally {
      await h.dispose();
    }
  });

  it("notices a subfolder nobody announced", async () => {
    const h = await harness();
    try {
      await h.vault.createDir("Projects");
      await h.vault.writeTextFile("Projects/note.md", "# Note\n");
      await h.indexer.indexVaultFull();
      await h.vault.createDir("Projects/Arrived");
      expect((await h.indexer.reconcileFolder("Projects", { recursive: false })).foldersChanged).toBe(true);
      expect((await h.indexer.reconcileFolder("Projects", { recursive: false })).foldersChanged).toBe(false);
    } finally {
      await h.dispose();
    }
  });
});

describe("the internal-path rules are data, shared with the native walk", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("../src/vault/internalPathRules.fixture.json", import.meta.url), "utf8"),
  ) as { rules: typeof INTERNAL_PATH_RULES; internal: string[]; user: string[] };

  it("the fixture the Rust test reads carries exactly the rules in use", () => {
    expect(fixture.rules).toEqual(INTERNAL_PATH_RULES);
  });

  it("reaches the verdicts the fixture names", () => {
    for (const name of fixture.internal) expect(isInternalSegment(name), JSON.stringify(name)).toBe(true);
    for (const name of fixture.user) expect(isInternalSegment(name), JSON.stringify(name)).toBe(false);
  });
});

describe("createYielder", () => {
  it("is free while the loop is young and lets go once it has run for its budget", async () => {
    const pause = createYielder(5, 4);
    for (let i = 0; i < 40; i++) expect(pause()).toBeUndefined();
    const until = performance.now() + 12;
    while (performance.now() < until) { /* a loop that holds the thread */ }
    let yielded: Promise<void> | void = undefined;
    for (let i = 0; i < 4 && !yielded; i++) yielded = pause();
    expect(yielded).toBeInstanceOf(Promise);
    await yielded;
    for (let i = 0; i < 8; i++) expect(pause()).toBeUndefined();
  });
});
