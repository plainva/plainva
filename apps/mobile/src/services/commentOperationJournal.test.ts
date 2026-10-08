// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { BackupVaultAdapter, ConflictAwareVaultAdapter, QueueingVaultAdapter, SyncQueue, SyncStateRepository, createWorkspaceObjectId, prepareCommentOperation } from "@plainva/core";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { realSqlite } from "../../../../packages/core/test/helpers/realSqlite";
import type { MobileVault } from "./vaultService";
import { mobileCommentOperations } from "./commentOperations";
vi.mock("./mobileDialogs", () => ({ mPrompt: vi.fn() }));
vi.mock("./mobileSettings", () => ({ getMobileSettings: () => ({ verifierName: "Reviewer" }), updateMobileSettings: vi.fn() }));
vi.mock("./mobileSettingsSync", () => ({ mobileSyncDeviceId: async () => "device", mobileCommentsMode: async () => ({ kind: "plain" }) }));
vi.mock("./vaultService", async () => {
  // Load the actual save method without booting the native vault registry.
  // Its file chain and the coordinator used to acquire locks remain real.
  const { readFileSync } = await import("node:fs");
  const ts = await import("typescript");
  const { createSaveCoordinator } = await import("./saveCoordinator");
  const file = ts.createSourceFile("vaultService.ts", readFileSync("src/services/vaultService.ts", "utf8"), ts.ScriptTarget.Latest, true);
  let method = "";
  const visit = (node: import("typescript").Node) => {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === "save") method = node.getText(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (!method) throw new Error("Actual mobile save method is missing");
  const code = ts.transpileModule(`const vaultOps = {${method}};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const vaultOps = new Function(code + "\nreturn vaultOps;")() as { save(v: MobileVault, path: string, text: string): Promise<void> };
  return { vaultOps, noteSaver: createSaveCoordinator<MobileVault>({ contextKey: (vault) => vault.vaultId, write: vaultOps.save }) };
});

const bridge = vi.hoisted(() => ({ readFile: vi.fn(), readdir: vi.fn(), write: vi.fn() }));
vi.mock("@capacitor/filesystem", () => ({ Directory: { Data: "DATA" }, Encoding: { UTF8: "utf8" }, Filesystem: bridge }));
vi.mock("../platform/atomicFile", () => ({ atomicWriteText: (...args: unknown[]) => bridge.write(...args) }));
import { mobileCommentOperationJournal } from "./commentOperationJournal";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-mobile-operation-journal-"));
  bridge.readFile.mockImplementation(async ({ path }: { path: string }) => ({ data: await readFile(join(root, path), "utf8") }));
  bridge.readdir.mockImplementation(async ({ path }: { path: string }) => ({ files: (await readdir(join(root, path), { withFileTypes: true }))
    .map((entry) => ({ name: entry.name, type: entry.isDirectory() ? "directory" : "file" })) }));
  bridge.write.mockImplementation(async (path: string, text: string) => {
    const file = join(root, path); await mkdir(dirname(file), { recursive: true });
    await writeFile(file + ".part", text); await rename(file + ".part", file);
  });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.clearAllMocks(); });
const operation = () => prepareCommentOperation({ contextKey: "vault-a", authorKey: "writer", notePath: "note.md", kind: "post", markers: [{ path: "note.md", body: "Review this." }] });

describe("mobile native comment journal", () => {
  it("the actual mobile service retains a partial completion across restart and uses the note's SQLite queue", async () => {
    const raw = new LocalVaultAdapter(join(root, "vault")); await raw.initialize();
    const db = await realSqlite();
    try {
      const files = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(new BackupVaultAdapter(raw), new SyncQueue(db)), new SyncStateRepository(db));
      const vault = { vaultId: "vault-a", adapter: raw, files, indexer: null, workspaceRuntime: null, workspaceState: null } as unknown as MobileVault;
      await raw.writeTextFile("note.md", "Old sentence.\n");
      const service = mobileCommentOperations(vault);
      const op = await service.prepare({ notePath: "note.md", kind: "apply", text: { before: "Old sentence.\n", intended: "New sentence.\n" },
        markers: [{ path: "note.md", body: "", resolvedCommentId: createWorkspaceObjectId(), suggestionOutcome: "applied" }] });
      const write = raw.writeTextFile.bind(raw);
      const blocked = vi.spyOn(raw, "writeTextFile").mockImplementation(async (path, text) => {
        if (path.startsWith(".plainva/sync/comments.")) throw new Error("comment write denied");
        await write(path, text);
      });
      await expect(service.run(op)).rejects.toMatchObject({ phase: "markers-pending" });
      expect(await raw.readTextFile("note.md")).toBe("New sentence.\n");
      expect(await db.query("SELECT file_path FROM offline_queue")).toEqual([{ file_path: "note.md" }]);
      expect((await service.read(op.operationId))?.receipt?.confirmedText).toBe("New sentence.\n");
      blocked.mockRestore(); await raw.writeTextFile("note.md", "Later independent text.\n");
      const resumed = mobileCommentOperations({ ...vault });
      expect((await resumed.run(op)).phase).toBe("completed");
      expect(await raw.readTextFile("note.md")).toBe("Later independent text.\n");
      expect(await resumed.pending()).toEqual([]);
    } finally { await db.close(); }
  });

  it("an accepted suggestion keeps what it replaces as a version first — also right after a save, and a decline keeps none (AI harness P5-7)", async () => {
    const raw = new LocalVaultAdapter(join(root, "vault")); await raw.initialize();
    const db = await realSqlite();
    try {
      let clock = Date.parse("2026-10-08T10:00:00Z");
      const backup = new BackupVaultAdapter(raw, { now: () => clock });
      const files = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, new SyncQueue(db)), new SyncStateRepository(db));
      const vault = { vaultId: "vault-a", adapter: raw, files, backup, indexer: null, workspaceRuntime: null, workspaceState: null } as unknown as MobileVault;
      await raw.writeTextFile("note.md", "First sentence.\n");
      // The reader's own save a moment ago: the version history took its one snapshot for these minutes.
      await files.writeTextFile("note.md", "Old sentence.\n");
      const versions = async () => Promise.all((await raw.listDir(".plainva/backups", false)).filter((file) => !file.isDirectory).map((file) => raw.readTextFile(file.path)));
      expect(await versions()).toEqual(["First sentence.\n"]);
      clock += 5_000;
      const service = mobileCommentOperations(vault);
      const decline = await service.prepare({ notePath: "note.md", kind: "decline", markers: [{ path: "note.md", body: "", resolvedCommentId: createWorkspaceObjectId(), suggestionOutcome: "declined" }] });
      expect((await service.run(decline)).phase).toBe("completed");
      expect(await versions()).toEqual(["First sentence.\n"]);
      const apply = await service.prepare({ notePath: "note.md", kind: "apply", text: { before: "Old sentence.\n", intended: "New sentence.\n" },
        markers: [{ path: "note.md", body: "", resolvedCommentId: createWorkspaceObjectId(), suggestionOutcome: "applied" }] });
      expect((await service.run(apply)).phase).toBe("completed");
      expect(await raw.readTextFile("note.md")).toBe("New sentence.\n");
      // Five seconds after a save an ordinary write keeps nothing; the accept kept exactly the bytes it replaced.
      expect((await versions()).sort()).toEqual(["First sentence.\n", "Old sentence.\n"]);
    } finally { await db.close(); }
  });

  it("a note that lies there with \\r\\n is not rewritten by an accept: the decision is held for review, and no byte of the file moves (AI harness P5-7)", async () => {
    const raw = new LocalVaultAdapter(join(root, "vault")); await raw.initialize();
    const db = await realSqlite();
    try {
      const backup = new BackupVaultAdapter(raw);
      const files = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, new SyncQueue(db)), new SyncStateRepository(db));
      const vault = { vaultId: "vault-a", adapter: raw, files, backup, indexer: null, workspaceRuntime: null, workspaceState: null } as unknown as MobileVault;
      // A byte order mark and \r\n, as an editor on Windows may leave a note; the mark is made at run time, never typed into this file.
      const windows = `${String.fromCharCode(0xfeff)}Old sentence.\r\nKeep this line.\r\n`;
      await raw.writeTextFile("note.md", windows);
      const bytes = async () => (await readFile(join(root, "vault", "note.md"))).toString("hex");
      const before = await bytes();
      const service = mobileCommentOperations(vault);
      // The phone's editor holds the note without \r — it keeps no file's shape yet —, so that is what a decision is planned on.
      const apply = await service.prepare({ notePath: "note.md", kind: "apply", text: { before: "Old sentence.\nKeep this line.\n", intended: "New sentence.\nKeep this line.\n" },
        markers: [{ path: "note.md", body: "", resolvedCommentId: createWorkspaceObjectId(), suggestionOutcome: "applied" }] });
      await expect(service.run(apply)).rejects.toMatchObject({ phase: "needs-review", reason: "needs-review" });
      // Nothing was written: not the passage, and not the note with every line end turned.
      expect(await bytes()).toBe(before);
      expect(await db.query("SELECT file_path FROM offline_queue")).toEqual([]);
      // Nothing was replaced, so nothing was kept.
      await expect(raw.listDir(".plainva/backups", false)).rejects.toThrow();
      expect((await service.read(apply.operationId))?.receipt ?? null).toBeNull();
    } finally { await db.close(); }
  });

  it("retains pending operations across fresh instances and isolates vaults", async () => {
    const op = operation();
    await mobileCommentOperationJournal("vault-a").write(op);
    expect(await mobileCommentOperationJournal("vault-a").read(op.operationId)).toEqual(op);
    expect(await mobileCommentOperationJournal("vault-a").list()).toEqual([op]);
    expect(await mobileCommentOperationJournal("vault-b").list()).toEqual([]);
  });
  it("preserves native read and directory errors instead of returning an empty journal", async () => {
    const op = operation(); const journal = mobileCommentOperationJournal("vault-a"); await journal.write(op);
    bridge.readFile.mockRejectedValueOnce({ code: "EACCES", message: "File does not exist." });
    await expect(journal.read(op.operationId)).rejects.toMatchObject({ code: "EACCES" });
    bridge.readdir.mockRejectedValueOnce({ code: "EIO", message: "read failed" });
    await expect(journal.list()).rejects.toMatchObject({ code: "EIO" });
    expect(await journal.read(op.operationId)).toEqual(op);
  });
  it("an unacknowledged write leaves the earlier durable operation available", async () => {
    const op = operation(); const journal = mobileCommentOperationJournal("vault-a"); await journal.write(op);
    bridge.write.mockRejectedValueOnce(new Error("disk full"));
    await expect(journal.write({ ...op, phase: "markers-pending" })).rejects.toThrow("disk full");
    expect(await journal.read(op.operationId)).toEqual(op);
  });
  it("does not turn malformed native responses or unsafe vault IDs into missing journals", async () => {
    const journal = mobileCommentOperationJournal("vault-a");
    bridge.readdir.mockResolvedValueOnce({ files: null });
    await expect(journal.list()).rejects.toThrow("could not be confirmed");
    bridge.readFile.mockResolvedValueOnce({ data: new Blob(["bytes"]) });
    await expect(journal.read(operation().operationId)).rejects.toThrow("could not be confirmed");
    expect(() => mobileCommentOperationJournal("../other")).toThrow("Invalid");
  });
});
