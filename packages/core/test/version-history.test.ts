import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter } from "../src/vault/BackupVaultAdapter.js";
import { VersionHistoryService, isTextLikePath } from "../src/vault/VersionHistoryService.js";
import { makeBackupPath } from "../src/vault/backupNaming.js";

describe("VersionHistoryService", () => {
  let tempDir: string;
  let inner: LocalVaultAdapter;
  let clock: number;
  let backupAdapter: BackupVaultAdapter;
  let service: VersionHistoryService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-versions-test-"));
    inner = new LocalVaultAdapter(tempDir);
    await inner.initialize();
    clock = 1_736_100_000_000;
    backupAdapter = new BackupVaultAdapter(inner, {
      policy: { minSnapshotIntervalSeconds: 0 },
      now: () => clock,
    });
    service = new VersionHistoryService(inner);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  const writeVersions = async (p: string, contents: string[]) => {
    for (const c of contents) {
      await backupAdapter.writeTextFile(p, c);
      clock += 1000;
    }
  };

  it("classifies text-like paths", () => {
    expect(isTextLikePath("a/b.md")).toBe(true);
    expect(isTextLikePath("tasks.base")).toBe(true);
    expect(isTextLikePath("x.txt")).toBe(true);
    expect(isTextLikePath("img.png")).toBe(false);
    expect(isTextLikePath("noext")).toBe(false);
  });

  it("lists versions newest first with sizes, filtering exact names", async () => {
    await writeVersions("notes/A.md", ["v1", "v2-longer", "v3"]);
    await writeVersions("notes/A.md.foo", ["f1", "f2"]);

    const versions = await service.listVersions("notes/A.md");
    expect(versions.length).toBe(2); // backups of v1 and v2
    expect(versions[0].timestamp).toBeGreaterThan(versions[1].timestamp);
    expect(await inner.readTextFile(versions[0].backupPath)).toBe("v2-longer");
    expect(versions[0].size).toBe("v2-longer".length);
    expect(await inner.readTextFile(versions[1].backupPath)).toBe("v1");
  });

  it("returns an empty list when no backups exist", async () => {
    expect(await service.listVersions("nothing.md")).toEqual([]);
  });

  it("restores a text version through the write adapter (with pre-restore snapshot)", async () => {
    await writeVersions("doc.md", ["v1", "v2", "v3"]);
    const versions = await service.listVersions("doc.md");
    const oldest = versions[versions.length - 1];

    await service.restoreVersion({ backupPath: oldest.backupPath, targetPath: "doc.md", writeAdapter: backupAdapter });

    expect(await inner.readTextFile("doc.md")).toBe("v1");
    // The pre-restore state (v3) was snapshotted by the write adapter.
    const after = await service.listVersions("doc.md");
    expect(await inner.readTextFile(after[0].backupPath)).toBe("v3");
  });

  it("restores an over-age snapshot even when beforeWrite prunes it (forced pre-restore backup)", async () => {
    // Regression (found by e2e): the forced pre-restore backup runs age
    // rotation, which may delete the very snapshot being restored. The
    // service must read the snapshot BEFORE beforeWrite runs.
    const tightAdapter = new BackupVaultAdapter(inner, {
      policy: { minSnapshotIntervalSeconds: 0, maxAgeDays: 1 },
      now: () => clock,
    });
    const overAge = clock - 10 * 86_400_000;
    await inner.writeTextFile("old.md", "current");
    await inner.writeTextFile(makeBackupPath("old.md", overAge), "ancient content");

    const versions = await service.listVersions("old.md");
    expect(versions.length).toBe(1);
    await service.restoreVersion({
      backupPath: versions[0].backupPath,
      targetPath: "old.md",
      writeAdapter: tightAdapter,
      beforeWrite: async () => {
        await tightAdapter.forceBackup("old.md"); // prunes the over-age snapshot
      },
    });

    expect(await inner.readTextFile("old.md")).toBe("ancient content");
    // The pre-restore state survived as a fresh snapshot.
    const after = await service.listVersions("old.md");
    expect(after.length).toBe(1);
    expect(await inner.readTextFile(after[0].backupPath)).toBe("current");
  });

  it("restores binary versions byte-exact", async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 0, 255, 1, 2]);
    await backupAdapter.writeBinaryFile("img.png", bytes);
    clock += 1000;
    await backupAdapter.writeBinaryFile("img.png", new Uint8Array([1, 2, 3]));

    const versions = await service.listVersions("img.png");
    expect(versions.length).toBe(1);
    await service.restoreVersion({ backupPath: versions[0].backupPath, targetPath: "img.png", writeAdapter: backupAdapter });
    expect(Array.from(await inner.readBinaryFile("img.png"))).toEqual(Array.from(bytes));
  });

  it("restores into missing parent directories", async () => {
    await writeVersions("deep/nested/file.md", ["v1", "v2"]);
    await inner.deleteItem("deep", true); // folder gone, backups remain

    const versions = await service.listVersions("deep/nested/file.md");
    expect(versions.length).toBeGreaterThan(0);
    await service.restoreVersion({ backupPath: versions[0].backupPath, targetPath: "deep/nested/file.md", writeAdapter: backupAdapter });
    expect(await inner.readTextFile("deep/nested/file.md")).toBe("v1");
  });

  describe("listOrphans", () => {
    it("finds backups whose original no longer exists", async () => {
      await writeVersions("keep.md", ["k1", "k2"]);
      await writeVersions("sub/gone.md", ["g1", "g2"]);
      await backupAdapter.deleteItem("sub/gone.md"); // also snapshots g2

      const orphans = await service.listOrphans();
      expect(orphans.length).toBe(1);
      expect(orphans[0].originalPath).toBe("sub/gone.md");
      expect(orphans[0].versions.length).toBe(2); // g1 + forced delete snapshot of g2
      expect(orphans[0].versions[0].timestamp).toBeGreaterThan(orphans[0].versions[1].timestamp);
      expect(await inner.readTextFile(orphans[0].versions[0].backupPath)).toBe("g2");
    });

    it("ignores batch folders and unparseable files", async () => {
      const stamp = new Date(clock).toISOString().replace(/[:.]/g, "-");
      await inner.writeTextFile(`.plainva/backups/index-md-${stamp}/lost.md`, "batch copy");
      await inner.writeTextFile(".plainva/backups/readme.txt", "not a backup");

      const orphans = await service.listOrphans();
      expect(orphans).toEqual([]);
    });

    it("reports progress and honors aborts", async () => {
      await writeVersions("x.md", ["1", "2"]);
      const controller = new AbortController();
      controller.abort();
      await expect(service.listOrphans({ signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });

      let last = 0;
      await service.listOrphans({ onProgress: (n) => (last = n) });
      expect(last).toBeGreaterThan(0);
    });
  });

  describe("pruneOldBackups", () => {
    it("deletes over-age snapshots and whole over-age batch folders, keeps the rest", async () => {
      const now = clock;
      const oldTs = now - 100 * 86_400_000;
      const youngTs = now - 1 * 86_400_000;
      await inner.writeTextFile(makeBackupPath("a.md", oldTs), "old");
      await inner.writeTextFile(makeBackupPath("a.md", youngTs), "young");
      await inner.writeTextFile(".plainva/backups/keepme.txt", "unparseable");

      const oldStamp = new Date(oldTs).toISOString().replace(/[:.]/g, "-");
      const youngStamp = new Date(youngTs).toISOString().replace(/[:.]/g, "-");
      await inner.writeTextFile(`.plainva/backups/okf-conversion-${oldStamp}/x.md`, "batch old");
      await inner.writeTextFile(`.plainva/backups/index-md-${youngStamp}/y.md`, "batch young");

      const res = await service.pruneOldBackups({ maxAgeDays: 90, now });
      expect(res.deletedFiles).toBe(1);
      expect(res.deletedBatchFolders).toBe(1);

      expect(await inner.exists(makeBackupPath("a.md", oldTs))).toBe(false);
      expect(await inner.exists(makeBackupPath("a.md", youngTs))).toBe(true);
      expect(await inner.exists(".plainva/backups/keepme.txt")).toBe(true);
      expect(await inner.exists(`.plainva/backups/okf-conversion-${oldStamp}`)).toBe(false);
      expect(await inner.exists(`.plainva/backups/index-md-${youngStamp}/y.md`)).toBe(true);
    });

    it("does nothing when maxAgeDays is 0 (unlimited)", async () => {
      const now = clock;
      await inner.writeTextFile(makeBackupPath("a.md", now - 1000 * 86_400_000), "ancient");
      const res = await service.pruneOldBackups({ maxAgeDays: 0, now });
      expect(res).toEqual({ deletedFiles: 0, deletedBatchFolders: 0 });
    });

    it("uses the injected deleteFn", async () => {
      const now = clock;
      const oldTs = now - 100 * 86_400_000;
      await inner.writeTextFile(makeBackupPath("a.md", oldTs), "old");
      const calls: string[] = [];
      await service.pruneOldBackups({
        maxAgeDays: 90,
        now,
        deleteFn: async (p, r) => {
          calls.push(p);
          await inner.deleteItem(p, r);
        },
      });
      expect(calls).toEqual([makeBackupPath("a.md", oldTs)]);
    });
  });
});
