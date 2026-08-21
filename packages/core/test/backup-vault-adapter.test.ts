import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter, DEFAULT_BACKUP_RETENTION } from "../src/vault/BackupVaultAdapter.js";

describe("BackupVaultAdapter", () => {
  let tempDir: string;
  let innerAdapter: LocalVaultAdapter;
  let clock: number;

  const makeAdapter = (policy: Partial<import("../src/vault/BackupVaultAdapter.js").BackupRetentionPolicy> = {}) =>
    new BackupVaultAdapter(innerAdapter, {
      policy: { minSnapshotIntervalSeconds: 0, ...policy },
      now: () => clock,
    });

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-backup-test-"));
    innerAdapter = new LocalVaultAdapter(tempDir);
    await innerAdapter.initialize();
    clock = 1_736_100_000_000;
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("has sensible retention defaults", () => {
    const adapter = new BackupVaultAdapter(innerAdapter);
    expect(adapter.getPolicy()).toEqual(DEFAULT_BACKUP_RETENTION);
    expect(DEFAULT_BACKUP_RETENTION.minSnapshotIntervalSeconds).toBe(120);
    expect(DEFAULT_BACKUP_RETENTION.maxBackupsPerFile).toBe(100);
    expect(DEFAULT_BACKUP_RETENTION.maxAgeDays).toBe(90);
  });

  it("honors the legacy maxBackupsPerFile option", () => {
    const adapter = new BackupVaultAdapter(innerAdapter, { maxBackupsPerFile: 3 });
    expect(adapter.getPolicy().maxBackupsPerFile).toBe(3);
  });

  it("skips the backup directory listing for a save within the snapshot interval (WP5 5a)", async () => {
    const adapter = makeAdapter({ minSnapshotIntervalSeconds: 120 });
    await innerAdapter.writeTextFile("note.md", "v1");
    clock += 1000;
    await adapter.writeTextFile("note.md", "v2"); // first snapshot: lists + records lastSnapshotAt

    const listSpy = vi.spyOn(innerAdapter, "listDir");
    clock += 1000; // still within the 120 s interval
    await adapter.writeTextFile("note.md", "v3");
    expect(listSpy).not.toHaveBeenCalled(); // fast path: no directory listing this save

    clock += 120_000 + 1; // interval elapsed -> a new snapshot (and listing) is due
    await adapter.writeTextFile("note.md", "v4");
    expect(listSpy).toHaveBeenCalled();
    listSpy.mockRestore();
  });

  it("should not create a backup on the first write (new file)", async () => {
    const adapter = makeAdapter();
    await adapter.writeTextFile("test.md", "hello");
    const exists = await innerAdapter.exists(".plainva/backups");
    expect(exists).toBe(false);
  });

  it("should create a backup when overwriting an existing file", async () => {
    const adapter = makeAdapter();
    await adapter.writeTextFile("test.md", "hello");
    clock += 1000;
    await adapter.writeTextFile("test.md", "world");

    const backups = await innerAdapter.listDir(".plainva/backups");
    expect(backups.length).toBe(1);
    expect(backups[0].name).toBe(`test.md.${clock}.bak`);

    expect(await innerAdapter.readTextFile(backups[0].path)).toBe("hello");
    expect(await innerAdapter.readTextFile("test.md")).toBe("world");
  });

  it("should rotate backups when exceeding the max count", async () => {
    const adapter = makeAdapter({ maxBackupsPerFile: 3 });
    await adapter.writeTextFile("rotate.md", "version1");
    for (let i = 2; i <= 6; i++) {
      clock += 1000;
      await adapter.writeTextFile("rotate.md", `version${i}`);
    }

    const backups = await innerAdapter.listDir(".plainva/backups");
    expect(backups.length).toBe(3);

    backups.sort((a, b) => a.name.localeCompare(b.name));
    const contents = await Promise.all(backups.map((b) => innerAdapter.readTextFile(b.path)));
    // Backups were created for v1..v5; the last 3 are kept.
    expect(contents).toEqual(["version3", "version4", "version5"]);
  });

  it("does not count backups of similarly named files against each other", async () => {
    const adapter = makeAdapter({ maxBackupsPerFile: 2 });
    await adapter.writeTextFile("A.md", "a1");
    await adapter.writeTextFile("A.md.foo", "f1");
    for (let i = 2; i <= 4; i++) {
      clock += 1000;
      await adapter.writeTextFile("A.md", `a${i}`);
      clock += 1000;
      await adapter.writeTextFile("A.md.foo", `f${i}`);
    }

    const backups = await innerAdapter.listDir(".plainva/backups");
    const aBackups = backups.filter((b) => /^A\.md\.\d+\.bak$/.test(b.name));
    const fooBackups = backups.filter((b) => /^A\.md\.foo\.\d+\.bak$/.test(b.name));
    // Each file keeps its own 2 newest backups; neither rotation eats the other's.
    expect(aBackups.length).toBe(2);
    expect(fooBackups.length).toBe(2);
  });

  it("skips snapshots within the snapshot interval", async () => {
    const adapter = makeAdapter({ minSnapshotIntervalSeconds: 60 });
    await adapter.writeTextFile("doc.md", "v1");
    clock += 1000;
    await adapter.writeTextFile("doc.md", "v2"); // first backup (no interval reference yet)
    clock += 10_000; // 10s < 60s
    await adapter.writeTextFile("doc.md", "v3"); // skipped
    clock += 10_000;
    await adapter.writeTextFile("doc.md", "v4"); // still skipped
    clock += 61_000; // beyond the interval
    await adapter.writeTextFile("doc.md", "v5"); // snapshot again

    const backups = await innerAdapter.listDir(".plainva/backups");
    const contents = await Promise.all(backups.map((b) => innerAdapter.readTextFile(b.path)));
    contents.sort();
    expect(contents).toEqual(["v1", "v4"]);
  });

  describe("deleting a folder (S4)", () => {
    // A phone has no trash. Deleting a folder there is final, and for every
    // note never edited on that device there was nothing to restore from —
    // the adapter only ever snapshotted non-directories. The desktop keeps
    // the old behaviour: it deletes into the OS trash and says so.
    const seedFolder = async () => {
      await innerAdapter.createDir("Projekte");
      await innerAdapter.createDir("Projekte/Sub");
      await innerAdapter.writeTextFile("Projekte/a.md", "A");
      await innerAdapter.writeTextFile("Projekte/Sub/b.md", "B");
      await innerAdapter.writeTextFile("keep.md", "K");
    };

    it("snapshots every file below the folder when asked to", async () => {
      const adapter = new BackupVaultAdapter(innerAdapter, {
        policy: { minSnapshotIntervalSeconds: 3600 },
        now: () => clock,
        snapshotRecursiveDeletes: true,
      });
      await seedFolder();

      await adapter.deleteItem("Projekte", true);

      expect(await innerAdapter.exists("Projekte")).toBe(false);
      const backups = await innerAdapter.listDir(".plainva/backups", true);
      const contents = await Promise.all(
        backups.filter((b) => !b.isDirectory).map((b) => innerAdapter.readTextFile(b.path))
      );
      // Both children are recoverable; the untouched sibling was not copied.
      expect(contents.sort()).toEqual(["A", "B"]);
    });

    it("leaves the desktop alone — off by default", async () => {
      const adapter = makeAdapter();
      await seedFolder();

      await adapter.deleteItem("Projekte", true);

      expect(await innerAdapter.exists("Projekte")).toBe(false);
      expect(await innerAdapter.exists(".plainva/backups")).toBe(false);
    });

    it("does not sweep a folder that is not being deleted recursively", async () => {
      // Without `recursive` the children are not going anywhere, so copying
      // them would be pure cost. (The local adapter refuses the call outright;
      // what matters here is that nothing was snapshotted on the way.)
      const adapter = new BackupVaultAdapter(innerAdapter, {
        now: () => clock,
        snapshotRecursiveDeletes: true,
      });
      await seedFolder();

      await adapter.deleteItem("Projekte").catch(() => {});

      expect(await innerAdapter.exists(".plainva/backups")).toBe(false);
    });
  });

  it("always snapshots on delete, regardless of the interval", async () => {
    const adapter = makeAdapter({ minSnapshotIntervalSeconds: 3600 });
    await adapter.writeTextFile("gone.md", "v1");
    clock += 1000;
    await adapter.writeTextFile("gone.md", "v2"); // backup of v1
    clock += 1000;
    await adapter.deleteItem("gone.md"); // must snapshot v2 despite the interval

    expect(await innerAdapter.exists("gone.md")).toBe(false);
    const backups = await innerAdapter.listDir(".plainva/backups");
    expect(backups.length).toBe(2);
    const contents = await Promise.all(backups.map((b) => innerAdapter.readTextFile(b.path)));
    contents.sort();
    expect(contents).toEqual(["v1", "v2"]);
  });

  it("forceBackup snapshots despite the interval and tolerates missing files", async () => {
    const adapter = makeAdapter({ minSnapshotIntervalSeconds: 3600 });
    await adapter.writeTextFile("f.md", "v1");
    clock += 1000;
    await adapter.writeTextFile("f.md", "v2"); // backup of v1
    clock += 1000;
    await adapter.forceBackup("f.md"); // backup of v2 despite interval
    const backups = await innerAdapter.listDir(".plainva/backups");
    expect(backups.length).toBe(2);

    await expect(adapter.forceBackup("missing.md")).resolves.toBeUndefined();
  });

  it("prunes snapshots older than maxAgeDays during rotation", async () => {
    const adapter = makeAdapter({ maxAgeDays: 1 });
    await adapter.writeTextFile("age.md", "v1");
    clock += 1000;
    await adapter.writeTextFile("age.md", "v2"); // backup of v1 at t
    clock += 2 * 86_400_000; // 2 days later
    await adapter.writeTextFile("age.md", "v3"); // backup of v2, prunes the v1 backup

    const backups = await innerAdapter.listDir(".plainva/backups");
    expect(backups.length).toBe(1);
    expect(await innerAdapter.readTextFile(backups[0].path)).toBe("v2");
  });

  it("applies updatePolicy at runtime", async () => {
    const adapter = makeAdapter({ minSnapshotIntervalSeconds: 3600 });
    await adapter.writeTextFile("p.md", "v1");
    clock += 1000;
    await adapter.writeTextFile("p.md", "v2"); // backup of v1
    clock += 1000;
    await adapter.writeTextFile("p.md", "v3"); // skipped (interval)
    adapter.updatePolicy({ minSnapshotIntervalSeconds: 0 });
    clock += 1000;
    await adapter.writeTextFile("p.md", "v4"); // snapshot again

    const backups = await innerAdapter.listDir(".plainva/backups");
    expect(backups.length).toBe(2);
    expect(adapter.getPolicy().minSnapshotIntervalSeconds).toBe(0);
  });

  it("never versions .plainva-internal files", async () => {
    const adapter = makeAdapter();
    await adapter.writeTextFile(".plainva/bookmarks.json", "[]");
    clock += 1000;
    await adapter.writeTextFile(".plainva/bookmarks.json", "[1]");
    expect(await innerAdapter.exists(".plainva/backups")).toBe(false);
  });

  it("should handle nested file backups properly", async () => {
    const adapter = makeAdapter();
    await adapter.writeTextFile("folder/nested.md", "old");
    clock += 1000;
    await adapter.writeTextFile("folder/nested.md", "new");

    const backups = await innerAdapter.listDir(".plainva/backups/folder");
    expect(backups.length).toBe(1);
    expect(backups[0].name).toBe(`nested.md.${clock}.bak`);
  });

  describe("rename carries backup history", () => {
    it("moves file snapshots to the new path", async () => {
      const adapter = makeAdapter();
      await adapter.writeTextFile("old name v1.2.md", "v1");
      clock += 1000;
      await adapter.writeTextFile("old name v1.2.md", "v2");
      clock += 1000;
      await adapter.renameItem("old name v1.2.md", "sub/new name.md");

      expect(await innerAdapter.readTextFile("sub/new name.md")).toBe("v2");
      const backups = await innerAdapter.listDir(".plainva/backups/sub");
      expect(backups.length).toBe(1);
      expect(backups[0].name).toMatch(/^new name\.md\.\d+\.bak$/);
      expect(await innerAdapter.readTextFile(backups[0].path)).toBe("v1");
      // Nothing left under the old name
      const rootBackups = await innerAdapter.listDir(".plainva/backups");
      expect(rootBackups.filter((b) => !b.isDirectory).length).toBe(0);
    });

    it("preserves the snapshot timestamps on carry", async () => {
      const adapter = makeAdapter();
      await adapter.writeTextFile("a.md", "v1");
      clock += 1000;
      const backupClock = clock;
      await adapter.writeTextFile("a.md", "v2");
      clock += 1000;
      await adapter.renameItem("a.md", "b.md");
      const backups = await innerAdapter.listDir(".plainva/backups");
      expect(backups.map((b) => b.name)).toEqual([`b.md.${backupClock}.bak`]);
    });

    it("moves a whole folder's backup tree", async () => {
      const adapter = makeAdapter();
      await adapter.writeTextFile("proj/x.md", "v1");
      clock += 1000;
      await adapter.writeTextFile("proj/x.md", "v2");
      clock += 1000;
      await adapter.renameItem("proj", "archive");

      expect(await innerAdapter.exists(".plainva/backups/proj")).toBe(false);
      const backups = await innerAdapter.listDir(".plainva/backups/archive");
      expect(backups.length).toBe(1);
      expect(backups[0].name).toMatch(/^x\.md\.\d+\.bak$/);
    });

    it("merges into an existing target backup dir (A -> B -> A)", async () => {
      const adapter = makeAdapter();
      await adapter.writeTextFile("a/x.md", "v1");
      clock += 1000;
      await adapter.writeTextFile("a/x.md", "v2"); // backup under a/
      clock += 1000;
      await adapter.renameItem("a", "b"); // carries to b/
      clock += 1000;
      await adapter.writeTextFile("b/x.md", "v3"); // second backup under b/
      clock += 1000;
      await adapter.renameItem("b", "a"); // target .plainva/backups/a is gone, but simulate leftovers:
      // (after the first carry, .plainva/backups/a no longer exists, so this rename
      // took the fast path; force the merge path with a third hop)
      clock += 1000;
      await innerAdapter.writeTextFile(".plainva/backups/b/stale.md.1736000000000.bak", "stale");
      await adapter.renameItem("a", "b"); // .plainva/backups/b exists -> merge

      const backups = await innerAdapter.listDir(".plainva/backups/b");
      const names = backups.filter((b) => !b.isDirectory).map((b) => b.name).sort();
      expect(names.some((n) => /^x\.md\.\d+\.bak$/.test(n))).toBe(true);
      expect(names).toContain("stale.md.1736000000000.bak");
      // Both carried snapshots of x.md survive the merge
      expect(names.filter((n) => /^x\.md\.\d+\.bak$/.test(n)).length).toBe(2);
    });

    it("rename works when no backups exist", async () => {
      const adapter = makeAdapter();
      await adapter.writeTextFile("plain.md", "v1");
      await adapter.renameItem("plain.md", "renamed.md");
      expect(await innerAdapter.readTextFile("renamed.md")).toBe("v1");
      expect(await innerAdapter.exists(".plainva/backups")).toBe(false);
    });
  });

  describe("snapshot failures never block the user write (P1.1)", () => {
    /** Inner adapter whose writes into .plainva/backups always fail (full disk, blocked dir, …). */
    const makeFailingBackupInner = () => {
      const failing = Object.create(innerAdapter) as LocalVaultAdapter;
      const failIfBackup = (p: string) => {
        if (p.startsWith(".plainva/backups")) throw new Error("disk full");
      };
      failing.writeTextFile = async (p: string, c: string) => {
        failIfBackup(p);
        return innerAdapter.writeTextFile(p, c);
      };
      failing.writeBinaryFile = async (p: string, c: Uint8Array) => {
        failIfBackup(p);
        return innerAdapter.writeBinaryFile(p, c);
      };
      return failing;
    };

    it("write succeeds and reports when the snapshot write fails", async () => {
      const errors: Array<{ path: string }> = [];
      const adapter = new BackupVaultAdapter(makeFailingBackupInner(), {
        policy: { minSnapshotIntervalSeconds: 0 },
        now: () => clock,
        onBackupError: (path) => errors.push({ path }),
      });

      await adapter.writeTextFile("note.md", "v1"); // new file, no snapshot attempted
      clock += 1000;
      await adapter.writeTextFile("note.md", "v2"); // snapshot fails, write must land

      expect(await innerAdapter.readTextFile("note.md")).toBe("v2");
      expect(errors).toEqual([{ path: "note.md" }]);
    });

    it("binary write succeeds when the snapshot write fails", async () => {
      const adapter = new BackupVaultAdapter(makeFailingBackupInner(), {
        policy: { minSnapshotIntervalSeconds: 0 },
        now: () => clock,
      });
      await adapter.writeBinaryFile("img.png", new Uint8Array([1]));
      clock += 1000;
      await adapter.writeBinaryFile("img.png", new Uint8Array([2]));
      expect(Array.from(await innerAdapter.readBinaryFile("img.png"))).toEqual([2]);
    });

    it("delete proceeds and reports when the pre-delete snapshot fails", async () => {
      const errors: string[] = [];
      const adapter = new BackupVaultAdapter(makeFailingBackupInner(), {
        policy: { minSnapshotIntervalSeconds: 0 },
        now: () => clock,
        onBackupError: (path) => errors.push(path),
      });
      await innerAdapter.writeTextFile("doomed.md", "content");
      await adapter.deleteItem("doomed.md");
      expect(await innerAdapter.exists("doomed.md")).toBe(false);
      expect(errors).toEqual(["doomed.md"]);
    });

    it("a throwing onBackupError callback does not break the write", async () => {
      const adapter = new BackupVaultAdapter(makeFailingBackupInner(), {
        policy: { minSnapshotIntervalSeconds: 0 },
        now: () => clock,
        onBackupError: () => {
          throw new Error("reporter broken");
        },
      });
      await adapter.writeTextFile("note.md", "v1");
      clock += 1000;
      await adapter.writeTextFile("note.md", "v2");
      expect(await innerAdapter.readTextFile("note.md")).toBe("v2");
    });
  });

  describe("size policy for big files (C21)", () => {
    /** A file the policy considers large, without writing megabytes in a test. */
    const big = "x".repeat(2048);

    it("keeps only the newest snapshot once a file is over the limit", async () => {
      const trimmed: Array<{ path: string; size: number }> = [];
      const adapter = new BackupVaultAdapter(innerAdapter, {
        policy: { minSnapshotIntervalSeconds: 0, maxSnapshotBytes: 1024 },
        now: () => clock,
        onLargeFileTrimmed: (path, size) => trimmed.push({ path, size }),
      });

      await innerAdapter.writeBinaryFile("clip.mp4", new TextEncoder().encode(big));
      for (let i = 0; i < 4; i++) {
        clock += 1000;
        await adapter.writeBinaryFile("clip.mp4", new TextEncoder().encode(big + i));
      }

      // Without the limit this is four snapshots of a large file; with it, one.
      const backups = await innerAdapter.listDir(".plainva/backups", false);
      expect(backups.filter((f) => f.name.includes("clip.mp4")).length).toBe(1);
      expect(trimmed[0]?.path).toBe("clip.mp4");
      expect(trimmed[0]?.size).toBeGreaterThan(1024);
    });

    it("leaves an ordinary note with its full history", async () => {
      const adapter = new BackupVaultAdapter(innerAdapter, {
        policy: { minSnapshotIntervalSeconds: 0, maxSnapshotBytes: 1024 },
        now: () => clock,
      });
      await innerAdapter.writeTextFile("note.md", "v0");
      for (let i = 0; i < 4; i++) {
        clock += 1000;
        await adapter.writeTextFile("note.md", "v" + (i + 1));
      }
      const backups = await innerAdapter.listDir(".plainva/backups", false);
      expect(backups.filter((f) => f.name.includes("note.md")).length).toBe(4);
    });

    it("a deletion is snapshotted in full however large the file is", async () => {
      const adapter = new BackupVaultAdapter(innerAdapter, {
        policy: { minSnapshotIntervalSeconds: 0, maxSnapshotBytes: 1024, maxBackupsPerFile: 100 },
        now: () => clock,
      });
      await innerAdapter.writeBinaryFile("clip.mp4", new TextEncoder().encode(big));
      clock += 1000;
      await adapter.writeBinaryFile("clip.mp4", new TextEncoder().encode(big + "a")); // trims to 1
      clock += 1000;
      await adapter.deleteItem("clip.mp4");

      // The write kept one; the deletion added its own and did NOT trim it away.
      // A deleted file has nothing left on disk — the snapshot is the only way back.
      const backups = await innerAdapter.listDir(".plainva/backups", false);
      expect(backups.filter((f) => f.name.includes("clip.mp4")).length).toBe(2);
    });

    it("says nothing and trims nothing when the size cannot be read", async () => {
      const adapter = new BackupVaultAdapter(innerAdapter, {
        policy: { minSnapshotIntervalSeconds: 0, maxSnapshotBytes: 1024 },
        now: () => clock,
      });
      vi.spyOn(innerAdapter, "getFileInfo").mockRejectedValue(new Error("no stat"));
      await innerAdapter.writeTextFile("note.md", "v0");
      for (let i = 0; i < 3; i++) {
        clock += 1000;
        await adapter.writeTextFile("note.md", "v" + (i + 1));
      }
      // Never fewer snapshots on a guess: without a size, the full history stands.
      const backups = await innerAdapter.listDir(".plainva/backups", false);
      expect(backups.filter((f) => f.name.includes("note.md")).length).toBe(3);
    });

    it("the default limit is above any note and below a video", () => {
      expect(DEFAULT_BACKUP_RETENTION.maxSnapshotBytes).toBe(5 * 1024 * 1024);
    });
  });
});
