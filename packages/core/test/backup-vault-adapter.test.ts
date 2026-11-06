import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter, DEFAULT_BACKUP_RETENTION } from "../src/vault/BackupVaultAdapter.js";
import { SnapshotBeforeDeleteError, deleteWithSafetyNet, isSnapshotBeforeDeleteError, type VaultFileInfo } from "../src/vault/IVaultAdapter.js";

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
    // the adapter only ever snapshotted non-directories. A storage without a
    // trash (this local adapter, the phone's) now snapshots every file below;
    // one with a trash (the desktop) lets the trash take the folder (D1).
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

    it("does not delete a folder with a folder below it could not cover, and names it (issue 125, D1)", async () => {
      // A walk that names what it could not list — the phone's picked folder
      // since issue 125 — instead of failing as a whole: a folder it named was
      // not covered. Without a trash that is a deletion without a net: it
      // stops, and says what has no copy; only `withoutSnapshot` goes on.
      const reported: string[] = [];
      const reporting = innerAdapter as typeof innerAdapter & { listDirReport?: (p?: string, r?: boolean) => Promise<{ files: VaultFileInfo[]; skipped: { path: string; reason: "cycle" | "unreadable" }[] }> };
      const listDir = innerAdapter.listDir.bind(innerAdapter);
      reporting.listDirReport = async (p = "", r = false) => ({
        files: (await listDir(p, r)).filter((f) => !f.path.startsWith("Projekte/Sub")),
        skipped: [{ path: "Projekte/Sub", reason: "unreadable" }, { path: "Projekte/Loop", reason: "cycle" }],
      });
      const adapter = new BackupVaultAdapter(innerAdapter, {
        policy: { minSnapshotIntervalSeconds: 3600 },
        now: () => clock,
        onBackupError: (path) => void reported.push(path),
      });
      await seedFolder();

      const refusal = await adapter.deleteItem("Projekte", true).then(() => null, (e: unknown) => e);
      expect(refusal).toBeInstanceOf(SnapshotBeforeDeleteError);
      expect((refusal as SnapshotBeforeDeleteError).uncovered).toEqual(["Projekte/Sub"]);
      expect((refusal as SnapshotBeforeDeleteError).net).toBe("no-trash");
      expect(await innerAdapter.exists("Projekte/a.md")).toBe(true);
      // The question replaces the notice: nothing says "saved" for a deletion.
      expect(reported).toEqual([]);

      await adapter.deleteItem("Projekte", true, { confirmed: true, withoutSnapshot: true });
      expect(await innerAdapter.exists("Projekte")).toBe(false);
      const backups = await innerAdapter.listDir(".plainva/backups", true);
      const contents = await Promise.all(backups.filter((b) => !b.isDirectory).map((b) => innerAdapter.readTextFile(b.path)));
      // The snapshot was still taken where it could be: twice, once per attempt.
      expect(new Set(contents)).toEqual(new Set(["A"]));
      delete reporting.listDirReport;
    });

    it("asks for the folder's own files, not what its links point at — and a cut loop is no gap", async () => {
      // The delete removes a link and leaves what it points at; the snapshot
      // covers what the delete removes. A walk that cut a loop left nothing
      // of the folder out, so nobody is told of one.
      const reported: string[] = [];
      const asked: unknown[] = [];
      const reporting = innerAdapter as typeof innerAdapter & { listDirReport?: (p?: string, r?: boolean, o?: unknown) => Promise<{ files: VaultFileInfo[]; skipped: { path: string; reason: "cycle" | "unreadable" }[] }> };
      const listDir = innerAdapter.listDir.bind(innerAdapter);
      reporting.listDirReport = async (p = "", r = false, o) => {
        asked.push(o);
        return { files: await listDir(p, r), skipped: [{ path: "Projekte/Loop", reason: "cycle" }] };
      };
      const adapter = new BackupVaultAdapter(innerAdapter, {
        policy: { minSnapshotIntervalSeconds: 3600 },
        now: () => clock,
        onBackupError: (path) => void reported.push(path),
      });
      await seedFolder();

      await adapter.deleteItem("Projekte", true);

      expect(asked).toEqual([{ followLinks: false, dotEntries: true }]);
      expect(reported).toEqual([]);
      const backups = await innerAdapter.listDir(".plainva/backups", true);
      const contents = await Promise.all(backups.filter((b) => !b.isDirectory).map((b) => innerAdapter.readTextFile(b.path)));
      expect(contents.sort()).toEqual(["A", "B"]);
      delete reporting.listDirReport;
    });

    it("snapshots dot-named files too, but never the app's own .plainva tree", async () => {
      // The delete takes `.git` and another program's settings along, so the
      // safety copy holds them (finding 2026-11-02); `.plainva` stays out.
      const reporting = innerAdapter as typeof innerAdapter & { listDirReport?: (p?: string, r?: boolean, o?: unknown) => Promise<{ files: VaultFileInfo[]; skipped: { path: string; reason: "cycle" | "unreadable" }[] }> };
      const hidden: VaultFileInfo[] = [
        { path: "Projekte/.git/config", name: "config", isDirectory: false, size: 1, mtime: 1 },
        { path: "Projekte/Sub/.obsidian/app.json", name: "app.json", isDirectory: false, size: 1, mtime: 1 },
        { path: "Projekte/.plainva/backups/old.md", name: "old.md", isDirectory: false, size: 1, mtime: 1 },
      ];
      const listDir = innerAdapter.listDir.bind(innerAdapter);
      reporting.listDirReport = async (p = "", r = false) => ({ files: [...(await listDir(p, r)), ...hidden], skipped: [] });
      const adapter = new BackupVaultAdapter(innerAdapter, {
        policy: { minSnapshotIntervalSeconds: 3600 },
        now: () => clock,
      });
      await seedFolder();
      for (const h of hidden) await innerAdapter.writeTextFile(h.path, "hidden");

      await adapter.deleteItem("Projekte", true);

      const backups = await innerAdapter.listDir(".plainva/backups", true);
      const contents = await Promise.all(backups.filter((b) => !b.isDirectory).map((b) => innerAdapter.readTextFile(b.path)));
      // A, B and the two dot files; the `.plainva/backups/old.md` copy is not snapshotted.
      expect(contents.sort()).toEqual(["A", "B", "hidden", "hidden"]);
      delete reporting.listDirReport;
    });

    it("measures what lies below from the folder: one under a dot-named folder keeps its files", async () => {
      const adapter = new BackupVaultAdapter(innerAdapter, {
        policy: { minSnapshotIntervalSeconds: 3600 },
        now: () => clock,
      });
      await innerAdapter.createDir(".archive/x");
      await innerAdapter.writeTextFile(".archive/x/a.md", "A");
      await innerAdapter.createDir(".archive/y");
      await innerAdapter.writeTextFile(".archive/y/b.md", "B");

      await adapter.deleteItem(".archive/x", true);
      // Named the way a caller may name it: measured from the folder's identity all the same.
      await adapter.deleteItem(".archive/y/", true);

      expect(await innerAdapter.exists(".archive/x")).toBe(false);
      const backups = await innerAdapter.listDir(".plainva/backups", true);
      const contents = await Promise.all(backups.filter((b) => !b.isDirectory).map((b) => innerAdapter.readTextFile(b.path)));
      expect(contents.sort()).toEqual(["A", "B"]);
    });

    it("does not delete a folder it cannot list at all (D1)", async () => {
      const listing = vi.spyOn(innerAdapter, "listDir").mockRejectedValueOnce(new Error("no listing"));
      const adapter = makeAdapter();
      await seedFolder();

      const refusal = await adapter.deleteItem("Projekte", true).then(() => null, (e: unknown) => e);
      expect(isSnapshotBeforeDeleteError(refusal)).toBe(true);
      expect(refusal).toMatchObject({ uncovered: ["Projekte"], total: 0, folder: true });
      expect(await innerAdapter.exists("Projekte/Sub/b.md")).toBe(true);
      listing.mockRestore();
    });

    it("lets a working trash take the folder: no snapshot of its files is needed (desktop)", async () => {
      const trashed: string[] = [];
      const withTrash = Object.assign(Object.create(innerAdapter) as LocalVaultAdapter, {
        moveToTrash: async (p: string) => {
          trashed.push(p);
          await innerAdapter.deleteItem(p, true);
          return true;
        },
      });
      const adapter = new BackupVaultAdapter(withTrash, { policy: { minSnapshotIntervalSeconds: 0 }, now: () => clock });
      await seedFolder();

      await adapter.deleteItem("Projekte", true, { confirmed: true });

      expect(trashed).toEqual(["Projekte"]);
      expect(await innerAdapter.exists("Projekte")).toBe(false);
      expect(await innerAdapter.exists(".plainva/backups")).toBe(false);
    });

    it("does not sweep a folder that is not being deleted recursively", async () => {
      // Without `recursive` the children are not going anywhere, so copying
      // them would be pure cost. (The local adapter refuses the call outright;
      // what matters here is that nothing was snapshotted on the way.)
      const adapter = new BackupVaultAdapter(innerAdapter, {
        now: () => clock,
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

  describe("ensureSnapshot: what lies there is kept before something replaces it for good (AI harness P5-7)", () => {
    /** The snapshots of the vault's top-level files, oldest first, as their exact bytes. */
    const kept = async () => {
      if (!(await innerAdapter.exists(".plainva/backups"))) return [];
      const backups = (await innerAdapter.listDir(".plainva/backups")).filter((entry) => !entry.isDirectory);
      backups.sort((a, b) => a.name.localeCompare(b.name));
      return Promise.all(backups.map(async (entry) => Buffer.from(await innerAdapter.readBinaryFile(entry.path)).toString("latin1")));
    };
    const bytes = (text: string) => Buffer.from(text, "utf8").toString("latin1");

    it("takes a snapshot despite the interval — and none where the newest one already holds these bytes", async () => {
      const adapter = makeAdapter({ minSnapshotIntervalSeconds: 3600 });
      await adapter.writeTextFile("f.md", "v1");
      clock += 1000;
      await adapter.writeTextFile("f.md", "v2"); // the save's own snapshot: v1
      clock += 1000;
      await adapter.ensureSnapshot("f.md"); // v2 lies there and is kept nowhere yet
      expect(await kept()).toEqual(["v1", "v2"]);
      // Asked again — a second accept, a retry — nothing is added: the newest snapshot is these bytes.
      clock += 1000;
      await adapter.ensureSnapshot("f.md");
      await adapter.ensureSnapshot("f.md");
      expect(await kept()).toEqual(["v1", "v2"]);
      // And where a save a moment ago took the snapshot of exactly what lies there, that one is the version.
      const fresh = makeAdapter({ minSnapshotIntervalSeconds: 3600 });
      await innerAdapter.writeTextFile("g.md", "old");
      clock += 1000;
      await fresh.writeTextFile("g.md", "old"); // a flush that writes what was there: snapshot "old"
      await fresh.ensureSnapshot("g.md");
      expect((await innerAdapter.listDir(".plainva/backups")).filter((entry) => entry.name.startsWith("g.md.")).length).toBe(1);
    });

    it("keeps the bytes as they lie there: a byte order mark and \\r\\n are part of what is kept", async () => {
      const adapter = makeAdapter({ minSnapshotIntervalSeconds: 3600 });
      const windows = `${String.fromCharCode(0xfeff)}# Title\r\n\r\nBody with ä and 日本.\r\n`;
      await innerAdapter.writeTextFile("w.md", windows);
      await adapter.ensureSnapshot("w.md");
      expect(await kept()).toEqual([bytes(windows)]);
      // A text that differs only in its line ends is another file, and is kept as one.
      await innerAdapter.writeTextFile("w.md", windows.replace(/\r\n/g, "\n"));
      clock += 1000;
      await adapter.ensureSnapshot("w.md");
      expect(await kept()).toEqual([bytes(windows), bytes(windows.replace(/\r\n/g, "\n"))]);
    });

    it("never writes onto the snapshot before it when both fall into one millisecond", async () => {
      const adapter = makeAdapter({ minSnapshotIntervalSeconds: 0 });
      await innerAdapter.writeTextFile("m.md", "v1");
      await adapter.writeTextFile("m.md", "v2"); // snapshot of v1 at `clock`
      await adapter.ensureSnapshot("m.md"); // the same millisecond: v2 must not replace v1's snapshot
      expect(await kept()).toEqual(["v1", "v2"]);
    });

    it("tolerates a missing file, leaves Plainva's own files alone, counts towards the limit — and lets a failure be heard", async () => {
      const adapter = makeAdapter({ minSnapshotIntervalSeconds: 3600, maxBackupsPerFile: 2 });
      await expect(adapter.ensureSnapshot("missing.md")).resolves.toBeNull();
      await innerAdapter.writeTextFile(".plainva/sync/comments.device.json", "{}");
      await adapter.ensureSnapshot(".plainva/sync/comments.device.json");
      expect(await kept()).toEqual([]);
      for (const text of ["v1", "v2", "v3"]) {
        await innerAdapter.writeTextFile("r.md", text);
        clock += 1000;
        await adapter.ensureSnapshot("r.md");
      }
      expect(await kept()).toEqual(["v2", "v3"]);
      // Whoever asks for this means not to write without it: the error is the caller's, not a console line.
      await innerAdapter.writeTextFile("r.md", "v4");
      const full = vi.spyOn(innerAdapter, "writeTextFile").mockRejectedValueOnce(new Error("no space left on device"));
      await expect(adapter.ensureSnapshot("r.md")).rejects.toThrow("no space left on device");
      full.mockRestore();
      // It reads and writes the note as text, the way a save's own snapshot is taken: nothing here needs the file
      // as bytes, so it works wherever a save works.
      const binary = vi.spyOn(innerAdapter, "readBinaryFile").mockRejectedValue(new Error("no binary reads here"));
      await adapter.ensureSnapshot("r.md");
      binary.mockRestore();
      expect(await kept()).toEqual(["v3", "v4"]);
    });
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

    it("a deletion whose snapshot fails is not carried out without a trash, and names the file (D1)", async () => {
      // It used to go on, and the phone said the file "was still saved".
      const errors: string[] = [];
      const adapter = new BackupVaultAdapter(makeFailingBackupInner(), {
        policy: { minSnapshotIntervalSeconds: 0 },
        now: () => clock,
        onBackupError: (path) => errors.push(path),
      });
      await innerAdapter.writeTextFile("doomed.md", "content");

      const refusal = await adapter.deleteItem("doomed.md", false, { confirmed: true }).then(() => null, (e: unknown) => e);

      expect(refusal).toBeInstanceOf(SnapshotBeforeDeleteError);
      expect(refusal).toMatchObject({ path: "doomed.md", uncovered: ["doomed.md"], total: 1, net: "no-trash", folder: false, code: "NO_SAFETY_NET" });
      expect(await innerAdapter.readTextFile("doomed.md")).toBe("content");
      expect(errors).toEqual([]);
    });

    it("with the person's withoutSnapshot the file goes", async () => {
      const adapter = new BackupVaultAdapter(makeFailingBackupInner(), { policy: { minSnapshotIntervalSeconds: 0 }, now: () => clock });
      await innerAdapter.writeTextFile("doomed.md", "content");
      await adapter.deleteItem("doomed.md", false, { confirmed: true, withoutSnapshot: true });
      expect(await innerAdapter.exists("doomed.md")).toBe(false);
    });

    it("a folder is not deleted while one of its files has no copy, and the others' are kept (D1)", async () => {
      // Only Projekte/b.md fails: a failing inner adapter for that one snapshot.
      const failing = Object.create(innerAdapter) as LocalVaultAdapter;
      failing.writeBinaryFile = async (p: string, c: Uint8Array) => {
        if (p.startsWith(".plainva/backups/Projekte/b.md")) throw new Error("disk full");
        return innerAdapter.writeBinaryFile(p, c);
      };
      const adapter = new BackupVaultAdapter(failing, { policy: { minSnapshotIntervalSeconds: 0 }, now: () => clock });
      await innerAdapter.createDir("Projekte");
      await innerAdapter.writeTextFile("Projekte/a.md", "A");
      await innerAdapter.writeTextFile("Projekte/b.md", "B");

      const refusal = await adapter.deleteItem("Projekte", true, { confirmed: true }).then(() => null, (e: unknown) => e);

      expect(refusal).toMatchObject({ path: "Projekte", uncovered: ["Projekte/b.md"], total: 2, net: "no-trash", folder: true });
      expect(await innerAdapter.readTextFile("Projekte/b.md")).toBe("B");
      expect(await innerAdapter.readTextFile("Projekte/a.md")).toBe("A");

      await adapter.deleteItem("Projekte", true, { confirmed: true, withoutSnapshot: true });
      expect(await innerAdapter.exists("Projekte")).toBe(false);
    });

    /** The failing inner adapter with a trash that works or refuses. */
    const withTrash = (works: boolean) => {
      const asked: string[] = [];
      const inner = Object.assign(makeFailingBackupInner(), {
        moveToTrash: async (p: string) => {
          asked.push(p);
          if (!works) return false;
          await innerAdapter.deleteItem(p, true);
          return true;
        },
      });
      return { inner, asked };
    };

    it("a working trash is the net: a failed snapshot does not hold the deletion up, and says nothing", async () => {
      const errors: string[] = [];
      const { inner, asked } = withTrash(true);
      const adapter = new BackupVaultAdapter(inner, { policy: { minSnapshotIntervalSeconds: 0 }, now: () => clock, onBackupError: (p) => errors.push(p) });
      await innerAdapter.writeTextFile("doomed.md", "content");
      await adapter.deleteItem("doomed.md", false, { confirmed: true });
      expect(asked).toEqual(["doomed.md"]);
      expect(await innerAdapter.exists("doomed.md")).toBe(false);
      expect(errors).toEqual([]);
    });

    it("where the trash refuses, every file of the folder is snapshotted before it is deleted for good (desktop, D1)", async () => {
      const permanent: string[] = [];
      const inner = Object.assign(Object.create(innerAdapter) as LocalVaultAdapter, {
        moveToTrash: async () => false,
        deleteItem: async (p: string, r?: boolean) => {
          permanent.push(p);
          return innerAdapter.deleteItem(p, r);
        },
      });
      const adapter = new BackupVaultAdapter(inner, { policy: { minSnapshotIntervalSeconds: 3600 }, now: () => clock });
      await innerAdapter.createDir("Netz/Sub");
      await innerAdapter.writeTextFile("Netz/a.md", "A");
      await innerAdapter.writeTextFile("Netz/Sub/b.md", "B");

      await adapter.deleteItem("Netz", true, { confirmed: true });

      expect(permanent).toEqual(["Netz"]);
      expect(await innerAdapter.exists("Netz")).toBe(false);
      const backups = await innerAdapter.listDir(".plainva/backups", true);
      const contents = await Promise.all(backups.filter((b) => !b.isDirectory).map((b) => innerAdapter.readTextFile(b.path)));
      expect(contents.sort()).toEqual(["A", "B"]);
    });

    it("where the trash refuses and the snapshot fails too, nothing is deleted and the refusal says so", async () => {
      const { inner, asked } = withTrash(false);
      const adapter = new BackupVaultAdapter(inner, { policy: { minSnapshotIntervalSeconds: 0 }, now: () => clock });
      await innerAdapter.writeTextFile("doomed.md", "content");

      const refusal = await adapter.deleteItem("doomed.md", false, { confirmed: true }).then(() => null, (e: unknown) => e);

      expect(asked).toEqual(["doomed.md"]);
      expect(refusal).toMatchObject({ uncovered: ["doomed.md"], net: "trash-unavailable" });
      expect(await innerAdapter.readTextFile("doomed.md")).toBe("content");
      await adapter.deleteItem("doomed.md", false, { confirmed: true, withoutSnapshot: true });
      expect(await innerAdapter.exists("doomed.md")).toBe(false);
    });

    it("a file that is not there goes to the storage below, as before, and needs no snapshot", async () => {
      const calls: string[] = [];
      const inner = Object.assign(makeFailingBackupInner(), { deleteItem: async (p: string) => { calls.push(p); } });
      const adapter = new BackupVaultAdapter(inner, { policy: { minSnapshotIntervalSeconds: 0 }, now: () => clock });
      await adapter.deleteItem("missing.md", false, { confirmed: true });
      expect(calls).toEqual(["missing.md"]);
    });

    it("the app's own files are deleted without a snapshot", async () => {
      const adapter = new BackupVaultAdapter(makeFailingBackupInner(), { policy: { minSnapshotIntervalSeconds: 0 }, now: () => clock });
      await innerAdapter.writeTextFile(".plainva/cache.json", "{}");
      await adapter.deleteItem(".plainva/cache.json");
      expect(await innerAdapter.exists(".plainva/cache.json")).toBe(false);
    });

    describe("deleteWithSafetyNet: the question, and only a yes deletes", () => {
      it("asks once with the refusal; a no keeps the file", async () => {
        const adapter = new BackupVaultAdapter(makeFailingBackupInner(), { policy: { minSnapshotIntervalSeconds: 0 }, now: () => clock });
        await innerAdapter.writeTextFile("doomed.md", "content");
        const asked: SnapshotBeforeDeleteError[] = [];
        const deleted = await deleteWithSafetyNet((c) => adapter.deleteItem("doomed.md", false, c), async (r) => { asked.push(r); return false; });
        expect(deleted).toBe(false);
        expect(asked.map((r) => r.uncovered)).toEqual([["doomed.md"]]);
        expect(await innerAdapter.exists("doomed.md")).toBe(true);
      });

      it("a yes deletes with withoutSnapshot and the confirmation it came with", async () => {
        const calls: unknown[] = [];
        const adapter = new BackupVaultAdapter(makeFailingBackupInner(), { policy: { minSnapshotIntervalSeconds: 0 }, now: () => clock });
        await innerAdapter.writeTextFile("doomed.md", "content");
        const deleted = await deleteWithSafetyNet(async (c) => { calls.push(c); await adapter.deleteItem("doomed.md", false, c); }, async () => true);
        expect(deleted).toBe(true);
        expect(calls).toEqual([{ confirmed: true }, { confirmed: true, withoutSnapshot: true }]);
        expect(await innerAdapter.exists("doomed.md")).toBe(false);
      });

      it("with a net nobody is asked; another error goes on unasked", async () => {
        const adapter = makeAdapter();
        await innerAdapter.writeTextFile("fine.md", "x");
        let asked = 0;
        expect(await deleteWithSafetyNet((c) => adapter.deleteItem("fine.md", false, c), async () => { asked++; return true; })).toBe(true);
        await expect(deleteWithSafetyNet(async () => { throw new Error("permission denied"); }, async () => { asked++; return true; })).rejects.toThrow("permission denied");
        expect(asked).toBe(0);
      });

      it("knows a refusal that crossed a boundary as data", () => {
        const crossed = { name: "Error", message: "x", code: "NO_SAFETY_NET", uncovered: ["a.md"] };
        expect(isSnapshotBeforeDeleteError(crossed)).toBe(true);
        expect(isSnapshotBeforeDeleteError(new Error("NO_SAFETY_NET"))).toBe(false);
      });
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
