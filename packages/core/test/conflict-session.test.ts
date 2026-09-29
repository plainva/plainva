import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LocalVaultAdapter } from "../src/vault/LocalVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../src/vault/SyncStateRepository.js";
import { ConflictFileStore } from "../src/vault/ConflictFileStore.js";
import { conflictDiagnostic, conflictHash, decodeConflictSession } from "../src/vault/conflictSession.js";
import { realSqlite } from "./helpers/realSqlite.js";
import { SyncWorker } from "../src/sync/SyncWorker.js";
import { SyncQueue } from "../src/sync/SyncQueue.js";
import type { SyncEngine } from "../src/sync/SyncEngine.js";
import type { ISyncTarget } from "../src/sync/ISyncTarget.js";
import type { IDatabaseAdapter } from "../src/db/IDatabaseAdapter.js";

describe("durable conflict editing", () => {
  let directory: string, db: IDatabaseAdapter, files: LocalVaultAdapter, repo: SyncStateRepository;
  let adapter: ConflictAwareVaultAdapter;
  const original = "notes/note.md", base = "base\n", external = "external\n";
  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "plainva-session-"));
    db = await realSqlite(); files = new LocalVaultAdapter(directory); await files.initialize();
    repo = new SyncStateRepository(db); adapter = new ConflictAwareVaultAdapter(files, repo);
    await files.writeTextFile(original, external);
    await repo.updateLocalHashAndBaseText(original, await conflictHash(base), base);
  });
  afterEach(async () => { vi.restoreAllMocks(); await db.close(); await rm(directory, { recursive: true, force: true }); });

  // Twenty saves on real files, the adapter replaced after ten. Every save after
  // the first takes the same path — one session row, one working copy, one
  // remembered write per path — so a hundred proved nothing that twenty do not,
  // and on a loaded Windows runner the hundred ran past 20 s (v0.8.3 release
  // preflight, 2026-09-18; Befunde 2026-09-24, Z2).
  const SAVES = 20;
  it.each(["adapter", "editor-save", "editor-external", "sync-pull"] as const)(`%s keeps one copy through ${SAVES} saves and a new adapter`, async writer => {
    if (writer === "adapter") await adapter.writeTextFile(original, "local 0\n").catch(error => { expect(error.name).toBe("ConflictError"); });
    if (writer === "editor-save") await adapter.writeEditorText(original, "local 0\n", base);
    if (writer === "editor-external") await adapter.preserveConflict(original, "local 0\n", writer);
    if (writer === "sync-pull") {
      await files.writeTextFile(original, "local 0\n");
      const worker = new SyncWorker({} as SyncEngine, { download: async () => new TextEncoder().encode(external) } as unknown as ISyncTarget, repo, files, new SyncQueue(db));
      worker["isRunning"] = true;
      await worker["reconcilePulledFile"](original, "remote-v2", null, Date.now(), []);
      worker.stop();
    }
    const first = { session: await adapter.getConflictSession(original) };
    expect(first.session).not.toBeNull();
    for (let i = 1; i <= SAVES; i++) {
      if (i === SAVES / 2) adapter = new ConflictAwareVaultAdapter(files, new SyncStateRepository(db));
      const saved = await adapter.writeEditorText(original, `local ${i}\n`, `local ${i - 1}\n`);
      expect(saved.session?.workingCopyPath).toBe(first.session!.workingCopyPath);
    }
    expect(await files.readTextFile(original)).toBe(external);
    expect(await files.readTextFile(first.session!.workingCopyPath)).toBe(`local ${SAVES}\n`);
    expect((await files.listDir("notes", true)).filter(f => f.path.includes(".CONFLICT-"))).toHaveLength(1);
    expect(await repo.getBaseText(original)).toBe(writer === "sync-pull" ? external : base);
    expect((await repo.getConflictSession(original))?.baseRevision).toBe(await conflictHash(base));
    expect((await repo.getConflictSession(original))?.writer).toBe(writer);
  });

  it("recovers its own saved draft after a closed-app foreign overwrite and supports editing the copy directly", async () => {
    const { session } = await adapter.writeEditorText(original, "own saved draft", base);
    await files.writeTextFile(session!.workingCopyPath, "foreign revision");
    adapter = new ConflictAwareVaultAdapter(files, new SyncStateRepository(db));
    const recovered = await adapter.getConflictSession(original);
    expect(await files.readTextFile(recovered!.workingCopyPath)).toBe("own saved draft");
    expect(await files.readTextFile(recovered!.foreignCopySnapshot!)).toBe("foreign revision");
    const edited = await adapter.writeEditorText(recovered!.workingCopyPath, "edited directly", "own saved draft");
    expect(edited.session?.originalPath).toBe(original);
    expect(edited.stored).toBe("edited directly");
    expect(await adapter.listConflictSessions()).toHaveLength(1);
  });

  it("keeps both confirmed versions as ordinary files and blocks structural operations while unresolved", async () => {
    const { session } = await adapter.writeEditorText(original, "local", base);
    await expect(adapter.deleteItem("notes", true)).rejects.toThrow("Resolve the open conflict");
    await expect(adapter.renameItem(session!.workingCopyPath, "notes/renamed.md")).rejects.toThrow("Resolve the open conflict");
    await adapter.resolveConflict(original, { originalText: external, copyText: "local", content: external, disposition: "discard", keepCopyAs: "notes/retained.md" });
    expect(await files.readTextFile(original)).toBe(external);
    expect(await files.readTextFile("notes/retained.md")).toBe("local");
    expect(await files.exists(session!.workingCopyPath)).toBe(false);
    expect(await adapter.getConflictSession(original)).toBeNull();
  });

  it("keeps the journal through index failure, restart and recovery without creating another copy", async () => {
    const indexed = new SyncStateRepository(db, files, "first-device");
    adapter = new ConflictAwareVaultAdapter(files, indexed);
    const first = await adapter.writeEditorText(original, "local", base);
    adapter = new ConflictAwareVaultAdapter(files, new ConflictFileStore(files, "first-device"));
    expect((await adapter.getConflictSession(original))?.workingCopyPath).toBe(first.session!.workingCopyPath);
    await adapter.writeEditorText(original, "continued offline", "local");
    adapter = new ConflictAwareVaultAdapter(files, new SyncStateRepository(db, files, "first-device"));
    const resumed = await adapter.getConflictSession(original);
    expect(resumed?.workingCopyPath).toBe(first.session!.workingCopyPath);
    expect(await files.readTextFile(resumed!.workingCopyPath)).toBe("continued offline");
    await adapter.resolveConflict(original, { originalText: external, copyText: "continued offline", content: "resolved" });
    expect(await new ConflictFileStore(files, "first-device").listConflictSessions()).toHaveLength(0);
    expect(await files.readTextFile(original)).toBe("resolved");
  });

  it("keeps another device's journal separate in an externally shared folder", async () => {
    const firstStore = new ConflictFileStore(files, "first-device");
    const first = new ConflictAwareVaultAdapter(files, firstStore);
    const own = await first.writeEditorText(original, "first draft", base);
    const secondStore = new ConflictFileStore(files, "second-device");
    const second = new ConflictAwareVaultAdapter(files, secondStore);
    expect(await second.getConflictSession(original)).toBeNull();
    const other = await second.writeEditorText(original, "second draft", base);
    expect(other.session!.workingCopyPath).not.toBe(own.session!.workingCopyPath);
    expect(await firstStore.listConflictSessions()).toHaveLength(1);
    expect(await secondStore.listConflictSessions()).toHaveLength(1);
    expect(await files.readTextFile(own.session!.workingCopyPath)).toBe("first draft");
    expect(await files.readTextFile(other.session!.workingCopyPath)).toBe("second draft");
  });

  it("journals before a failed working-copy write and recovers all bytes after restart", async () => {
    const write = files.writeTextFile.bind(files);
    vi.spyOn(files, "writeTextFile").mockImplementationOnce(async () => { throw new Error("storage unavailable"); });
    await expect(adapter.writeEditorText(original, "unsaved draft\r\n", base)).rejects.toThrow("storage unavailable");
    const pending = await repo.getConflictSession(original);
    expect(pending?.pendingText).toBe("unsaved draft\r\n");
    vi.mocked(files.writeTextFile).mockImplementation(write);
    adapter = new ConflictAwareVaultAdapter(files, new SyncStateRepository(db));
    const recovered = await adapter.getConflictSession(original);
    expect(await files.readTextFile(recovered!.workingCopyPath)).toBe("unsaved draft\r\n");
    expect(recovered?.pendingText).toBeNull();
    expect(await files.readTextFile(original)).toBe(external);
  });

  it("does not let a delayed external observer replace newer input", async () => {
    const first = await adapter.preserveConflict(original, "local 1", "editor-external");
    await adapter.writeEditorText(original, "local 2", "local 1");
    const observed = await adapter.preserveConflict(original, "local 1", "sync-pull");
    expect(observed.workingCopyPath).toBe(first.workingCopyPath);
    expect(await files.readTextFile(first.workingCopyPath)).toBe("local 2");
  });

  it("preserves the other editor's latest copy when an overlapping stale draft arrives", async () => {
    await adapter.writeEditorText(original, "old local", base);
    await adapter.writeEditorText(original, "latest local", "old local");
    const incoming = await adapter.writeEditorText(original, "other local", "old local");
    expect(incoming.stored).toBe("other local");
    expect(await files.readTextFile(incoming.session!.foreignCopySnapshot!)).toBe("latest local");
    expect(await files.readTextFile(original)).toBe(external);
    expect(await adapter.listConflictSessions()).toHaveLength(1);
  });

  it("preserves a foreign working-copy revision before the next save", async () => {
    const { session } = await adapter.writeEditorText(original, "local 1", base);
    await files.writeTextFile(session!.workingCopyPath, "foreign copy\r\n");
    const next = await adapter.writeEditorText(original, "local 2", "local 1");
    expect(await files.readTextFile(next.session!.foreignCopySnapshot!)).toBe("foreign copy\r\n");
    expect(next.stored).toBe("local 2");
    expect(await files.readTextFile(original)).toBe(external);
  });

  it("rejects a comparison after typing, then resolves against exact fresh snapshots", async () => {
    const first = await adapter.writeEditorText(original, "local 1", base);
    await adapter.writeEditorText(original, "local 2", "local 1");
    await expect(adapter.resolveConflict(original, { originalText: external, copyText: "local 1", content: "chosen" })).rejects.toThrow("comparisonChanged");
    expect(await files.exists(first.session!.workingCopyPath)).toBe(true);
    await adapter.resolveConflict(original, { originalText: external, copyText: "local 2", content: "chosen" });
    expect(await adapter.getConflictSession(original)).toBeNull();
    expect(await files.exists(first.session!.workingCopyPath)).toBe(false);
    expect(await files.readTextFile(original)).toBe("chosen");
    expect((await repo.getSyncState(original))?.local_sha256).toBe(await conflictHash("chosen"));
    expect(await repo.getBaseText(original)).toBe(base);
  });

  it("recovers an interrupted confirmed resolution before exposing its old working copy", async () => {
    const first = await adapter.writeEditorText(original, "local", base);
    vi.spyOn(files, "deleteItem").mockRejectedValueOnce(new Error("busy"));
    await expect(adapter.resolveConflict(original, { originalText: external, copyText: "local", content: "chosen" })).rejects.toThrow("busy");
    expect((await repo.getConflictSession(original))?.resolution?.content).toBe("chosen");
    adapter = new ConflictAwareVaultAdapter(files, new SyncStateRepository(db));
    expect(await adapter.getConflictSession(original)).toBeNull();
    expect(await files.readTextFile(original)).toBe("chosen");
    expect(await files.exists(first.session!.workingCopyPath)).toBe(false);
  });

  it("allows a fresh comparison after a foreign edit invalidates interrupted resolution", async () => {
    await adapter.writeEditorText(original, "local", base);
    vi.spyOn(files, "deleteItem").mockRejectedValueOnce(new Error("busy"));
    await expect(adapter.resolveConflict(original, { originalText: external, copyText: "local", content: "chosen" })).rejects.toThrow("busy");
    await files.writeTextFile(original, "new foreign version");
    await expect(adapter.getConflictSession(original)).rejects.toThrow("comparisonChanged");
    expect((await adapter.getConflictSession(original))?.resolution).toBeNull();
    expect(await files.readTextFile(original)).toBe("new foreign version");
    await adapter.resolveConflict(original, { originalText: "new foreign version", copyText: "local", content: "chosen again" });
    expect(await files.readTextFile(original)).toBe("chosen again");
  });

  it("serializes simultaneous first observers into one persisted session", async () => {
    const sessions = await Promise.all(Array.from({ length: 20 }, () => adapter.preserveConflict(original, "local", "editor-external")));
    expect(new Set(sessions.map(s => s.workingCopyPath)).size).toBe(1);
    expect(await adapter.listConflictSessions()).toHaveLength(1);
    const diagnostics = await adapter.listConflictDiagnostics();
    expect(diagnostics).toHaveLength(1);
    expect(JSON.stringify(diagnostics)).not.toContain(original);
    expect(diagnostics[0]).toMatchObject({ writer: "editor-external", baseSource: "captured", wasWrittenByUs: false });
  });

  it("fails closed on corrupt paths and resolution payloads", async () => {
    const { session } = await adapter.writeEditorText(original, "local", base);
    expect(() => decodeConflictSession(JSON.stringify({ ...session, workingCopyPath: "../note.CONFLICT-x.md" }))).toThrow();
    expect(() => decodeConflictSession(JSON.stringify({ ...session, resolution: { content: 123 } }))).toThrow();
  });

  it("distinguishes provider normalization from changed content without storing names or text", async () => {
    const normalized = await conflictDiagnostic({ path: original, adapter: "external-folder", writer: "editor-save",
      disk: "\uFEFFprivate text\r\n", base: "private text", baseSource: "captured", expectedLocalHash: await conflictHash("private text"), wasWrittenByUs: false });
    expect(normalized).toMatchObject({ normalizationOnly: true, differentLineEndings: true, differentBom: true, differentFinalNewline: true });
    const changed = await conflictDiagnostic({ path: original, adapter: "cloud", writer: "sync-pull",
      disk: "changed text", base: "private text", baseSource: "backup", expectedLocalHash: null, wasWrittenByUs: true });
    expect(changed).toMatchObject({ normalizationOnly: false, baseSource: "backup", wasWrittenByUs: true });
    const exported = JSON.stringify([normalized, changed]);
    for (const privateValue of [original, "private text", "changed text"]) expect(exported).not.toContain(privateValue);
  });
});
