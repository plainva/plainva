import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter } from "../src/vault/BackupVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { conflictHash } from "../src/vault/conflictSession.js";
import { seeConflictCopy, settleConflictCopy, settleConflictText } from "../src/vault/conflictCopy.js";
import { SnapshotBeforeDeleteError } from "../src/vault/IVaultAdapter.js";
import { realSqlite } from "./helpers/realSqlite.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";

/**
 * The exits of a conflict comparison under the net rule of a deletion (D1 of
 * the data-safety plan of 2026-11-06), on a storage without a trash whose
 * snapshots all fail — a full phone. "Delete copy" lets the copy's text go: it
 * is refused, both files stay, and only the person's `withoutSnapshot` lets
 * it go. "Keep both" and "Take the copy" keep the copy's text in a file, so
 * the copy goes without a snapshot of its own.
 */
describe("conflict exits and the net of a deletion", () => {
  let directory: string, db: IDatabaseAdapter, files: LocalVaultAdapter, repo: SyncStateRepository;
  let adapter: ConflictAwareVaultAdapter;
  const original = "notes/note.md", base = "base\n", external = "external\n";

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "plainva-conflict-net-"));
    db = await realSqlite();
    files = new LocalVaultAdapter(directory);
    await files.initialize();
    // Every snapshot fails, as on a full disk; everything else works.
    const full = Object.create(files) as LocalVaultAdapter;
    const refuse = (p: string) => { if (p.startsWith(".plainva/backups")) throw new Error("disk full"); };
    full.writeTextFile = async (p, c) => { refuse(p); return files.writeTextFile(p, c); };
    full.writeBinaryFile = async (p, c) => { refuse(p); return files.writeBinaryFile(p, c); };
    repo = new SyncStateRepository(db);
    adapter = new ConflictAwareVaultAdapter(new BackupVaultAdapter(full, { policy: { minSnapshotIntervalSeconds: 0 } }), repo);
    await files.writeTextFile(original, external);
    await repo.updateLocalHashAndBaseText(original, await conflictHash(base), base);
  });
  afterEach(async () => { await db.close(); await rm(directory, { recursive: true, force: true }); });

  const openConflict = async () => {
    const { session } = await adapter.writeEditorText(original, "local\n", base);
    expect(session).not.toBeNull();
    return session!.workingCopyPath;
  };

  it("\"Delete copy\" of an open conflict is refused without a net, leaves both files and the comparison — and goes with the person's yes", async () => {
    const copy = await openConflict();
    const answer = { originalText: external, copyText: "local\n", content: external, disposition: "discard" as const };

    const refusal = await adapter.resolveConflict(original, answer).then(() => null, (e: unknown) => e);

    expect(refusal).toBeInstanceOf(SnapshotBeforeDeleteError);
    expect((refusal as SnapshotBeforeDeleteError).uncovered).toEqual([copy]);
    expect(await files.readTextFile(copy)).toBe("local\n");
    expect(await files.readTextFile(original)).toBe(external);
    // The confirmation was taken back: the conflict is open and can be answered again.
    const session = await adapter.getConflictSession(original);
    expect(session?.workingCopyPath).toBe(copy);
    expect(session?.resolution ?? null).toBeNull();

    await adapter.resolveConflict(original, { ...answer, withoutSnapshot: true });
    expect(await files.exists(copy)).toBe(false);
    expect(await adapter.getConflictSession(original)).toBeNull();
    expect(await files.readTextFile(original)).toBe(external);
  });

  it("\"Keep both\" needs no snapshot: the copy's text stays as a file of its own", async () => {
    const copy = await openConflict();
    await adapter.resolveConflict(original, { originalText: external, copyText: "local\n", content: external, disposition: "discard", keepCopyAs: "notes/kept.md" });
    expect(await files.exists(copy)).toBe(false);
    expect(await files.readTextFile("notes/kept.md")).toBe("local\n");
    expect(await adapter.getConflictSession(original)).toBeNull();
  });

  it("\"Take the copy\" needs no snapshot: the copy's text took the note's place", async () => {
    const copy = await openConflict();
    await adapter.resolveConflict(original, { originalText: external, copyText: "local\n", content: "local\n" });
    expect(await files.exists(copy)).toBe(false);
    expect(await files.readTextFile(original)).toBe("local\n");
  });

  it("a merged text that is not the copy's lets the copy go only with a net; the note keeps the merge, and the yes finishes", async () => {
    const copy = await openConflict();
    const answer = { originalText: external, copyText: "local\n", content: "merged\n" };
    await expect(adapter.resolveConflict(original, answer)).rejects.toBeInstanceOf(SnapshotBeforeDeleteError);
    // The note holds the merge already, so the confirmation stands; the copy waits.
    expect(await files.readTextFile(original)).toBe("merged\n");
    expect(await files.readTextFile(copy)).toBe("local\n");

    await adapter.resolveConflict(original, { ...answer, withoutSnapshot: true });
    expect(await files.exists(copy)).toBe(false);
    expect(await adapter.getConflictSession(original)).toBeNull();
  });

  describe("a copy the sync left beside the note", () => {
    const beside = "notes/note.CONFLICT-2026-11-06.md";
    beforeEach(async () => { await files.writeTextFile(beside, "theirs\n"); });

    it("\"Delete copy\" as text: refused, the copy stays; with the yes it goes", async () => {
      const seen = { original: external, copy: "theirs\n" };
      await expect(settleConflictText(adapter, original, beside, seen, { disposition: "discard" })).rejects.toBeInstanceOf(SnapshotBeforeDeleteError);
      expect(await files.readTextFile(beside)).toBe("theirs\n");
      await settleConflictText(adapter, original, beside, seen, { disposition: "discard", withoutSnapshot: true });
      expect(await files.exists(beside)).toBe(false);
    });

    it("\"Take the copy\" as text goes without a question", async () => {
      await settleConflictText(adapter, original, beside, { original: external, copy: "theirs\n" }, { disposition: "adopt", content: "theirs\n" });
      expect(await files.readTextFile(original)).toBe("theirs\n");
      expect(await files.exists(beside)).toBe(false);
    });

    it("byte for byte: \"Delete copy\" is refused, \"Take the copy\" goes", async () => {
      const seen = await seeConflictCopy(adapter, original, beside);
      await expect(settleConflictCopy(adapter, original, beside, seen, { disposition: "discard" })).rejects.toBeInstanceOf(SnapshotBeforeDeleteError);
      expect(await files.exists(beside)).toBe(true);
      await settleConflictCopy(adapter, original, beside, seen, { disposition: "adopt" });
      expect(await files.readTextFile(original)).toBe("theirs\n");
      expect(await files.exists(beside)).toBe(false);
    });
  });
});
