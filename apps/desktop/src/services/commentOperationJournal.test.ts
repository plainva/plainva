// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rename, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { BundleCommentStore, createWorkspaceObjectId, prepareCommentOperation } from "@plainva/core";
import { LocalVaultAdapter } from "../../../../packages/core/src/vault/LocalVaultAdapter";
import { desktopCommentOperations } from "./commentOperations";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), mkdir: vi.fn(), directory: "", owner: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => bridge.invoke(...args) }));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: async () => bridge.directory, join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: (...args: unknown[]) => bridge.mkdir(...args),
  exists: async (path: string) => { try { await stat(path); return true; } catch { return false; } },
  remove: async (path: string) => { if ((await stat(path)).isDirectory()) await rmdir(path); else await rm(path); },
}));
vi.mock("./windowContext", () => ({ isOwnerWindow: () => bridge.owner }));
// The existing journal owns the vault directory naming, covered by its tests.
// Forced collision: the old hash maps every path to one folder, the new key stays distinct.
vi.mock("./draftJournal", () => ({ legacyPathHash: () => "same-old-hash", draftPathKey: (value: string) => `key-${Buffer.from(value).toString("hex")}` }));
import { desktopCommentOperationJournal } from "./commentOperationJournal";
import { removeLegacyCommentOperations } from "./commentOperationLegacy";

let root: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "plainva-desktop-operation-journal-"));
  bridge.directory = root; bridge.owner = true;
  bridge.mkdir.mockImplementation((path: string) => mkdir(path, { recursive: true }));
  bridge.invoke.mockImplementation(async (command: string, args: { path: string; rootId: string; relPath: string; contents: string }) => {
    if (command === "register_write_root") return args.path;
    const file = join(args.rootId, args.relPath);
    if (command === "checked_read_text_file") {
      try { return await readFile(file, "utf8"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
    }
    if (command === "checked_read_dir") return (await readdir(file, { withFileTypes: true }))
      .map((entry) => ({ name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory(), isSymlink: entry.isSymbolicLink() }));
    if (command === "write_file_atomic") {
      await writeFile(file + ".part", args.contents);
      await rename(file + ".part", file);
      return;
    }
    throw new Error("Unexpected native command");
  });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); vi.clearAllMocks(); });

const operation = () => prepareCommentOperation({ contextKey: "vault-a", authorKey: "writer", notePath: "note.md", kind: "post", markers: [{ path: "note.md", body: "Review this." }] });

describe("desktop native comment journal", () => {
  it("the actual service retains text shape and completes a failed marker without restoring an older note", async () => {
    const vaultPath = join(root, "vault"); const raw = new LocalVaultAdapter(vaultPath); await raw.initialize();
    await raw.writeTextFile("note.md", "\uFEFFOld sentence.\r\n");
    const store = new BundleCommentStore({ vault: raw, vaultKey: vaultPath, deviceId: async () => "desktop", mode: async () => ({ kind: "plain" as const }) });
    const deps = { vaultPath, adapter: raw, store, assertCurrent: () => {}, ensureAuthorName: async () => {}, noteWritten: async () => {} };
    const service = desktopCommentOperations(deps);
    const op = await service.prepare({ notePath: "note.md", kind: "apply", text: { before: "Old sentence.\n", intended: "New sentence.\n" },
      markers: [{ path: "note.md", body: "", resolvedCommentId: createWorkspaceObjectId(), suggestionOutcome: "applied" }] });
    const write = raw.writeTextFile.bind(raw);
    const blocked = vi.spyOn(raw, "writeTextFile").mockImplementation(async (path, text) => {
      if (path.startsWith(".plainva/sync/comments.")) throw new Error("comment write denied");
      await write(path, text);
    });
    await expect(service.run(op)).rejects.toMatchObject({ phase: "markers-pending" });
    expect(await raw.readTextFile("note.md")).toBe("\uFEFFNew sentence.\r\n");
    expect((await service.read(op.operationId))?.receipt?.confirmedText).toBe("New sentence.\n");
    blocked.mockRestore(); await raw.writeTextFile("note.md", "\uFEFFLater independent text.\r\n");
    const resumed = desktopCommentOperations(deps);
    expect((await resumed.run(op)).phase).toBe("completed");
    expect(await raw.readTextFile("note.md")).toBe("\uFEFFLater independent text.\r\n");
    expect(await resumed.pending()).toEqual([]);
  });

  it("retains pending operations across fresh instances and isolates vaults", async () => {
    const op = operation();
    await desktopCommentOperationJournal("vault-a").write(op);
    expect(await desktopCommentOperationJournal("vault-a").read(op.operationId)).toEqual(op);
    expect(await desktopCommentOperationJournal("vault-a").list()).toEqual([op]);
    expect(await desktopCommentOperationJournal("vault-b").list()).toEqual([]);
    expect(bridge.invoke.mock.calls.some(([command]) => command === "checked_read_text_file")).toBe(true);
  });
  it("an unreadable existing operation never becomes a missing record", async () => {
    const op = operation(); const journal = desktopCommentOperationJournal("vault-a");
    await journal.write(op);
    bridge.invoke.mockRejectedValueOnce(new Error("read denied"));
    await expect(journal.read(op.operationId)).rejects.toThrow("read denied");
    expect(await journal.read(op.operationId)).toEqual(op);
    bridge.invoke.mockRejectedValueOnce(new Error("directory iterator failed"));
    await expect(journal.list()).rejects.toThrow("directory iterator failed");
  });
  it("a native acknowledgement without retained bytes cannot confirm a journal write", async () => {
    const journal = desktopCommentOperationJournal("vault-a"); const op = operation();
    await journal.list();
    bridge.invoke.mockImplementationOnce(async () => undefined);
    await expect(journal.write(op)).rejects.toThrow("Invalid comment operation journal");
    expect(await journal.read(op.operationId)).toBeNull();
  });
  it("auxiliary windows cannot write a second independent journal", async () => {
    bridge.owner = false;
    await expect(desktopCommentOperationJournal("vault-a").write(operation())).rejects.toThrow("vault owner");
    expect(await readdir(root)).toEqual([]);
  });
  describe("the queue moved from the lossy folder name to the SHA-256 key (D6)", () => {
    const oldFolder = () => join(root, "drafts", "same-old-hash", "comment-operations");
    const seedOld = async (op: ReturnType<typeof operation>, contextKey: string) => {
      await mkdir(oldFolder(), { recursive: true });
      await writeFile(join(oldFolder(), `${op.operationId}.json`), JSON.stringify({ ...op, contextKey }));
    };
    it("moves only this vault's entries, leaves the other vault's and keeps the old folder until it is empty", async () => {
      const a = operation(), b = operation();
      await seedOld(a, "vault-a"); await seedOld(b, "vault-b");
      expect((await desktopCommentOperationJournal("vault-a").list()).map((op) => op.operationId)).toEqual([a.operationId]);
      expect(await readdir(oldFolder())).toEqual([`${b.operationId}.json`]);
      expect((await desktopCommentOperationJournal("vault-b").list()).map((op) => op.operationId)).toEqual([b.operationId]);
      expect(await readdir(join(root, "drafts"))).toEqual(expect.not.arrayContaining(["same-old-hash"]));
    });
    it("an entry already in the new folder wins over a stale old copy", async () => {
      const a = operation(); await seedOld(a, "vault-a");
      const journal = desktopCommentOperationJournal("vault-a");
      await journal.write({ ...a, contextKey: "vault-a", phase: "completed", postedIds: a.markers.map((m) => m.identity.commentId) });
      await journal.list();
      expect((await desktopCommentOperationJournal("vault-a").read(a.operationId))?.phase).toBe("completed");
      await expect(readdir(oldFolder())).rejects.toThrow();
    });
    it("an entry that cannot be proven this vault's stays where it is", async () => {
      await mkdir(oldFolder(), { recursive: true });
      await writeFile(join(oldFolder(), "garbage.json"), "{ not json");
      expect(await desktopCommentOperationJournal("vault-a").list()).toEqual([]);
      expect(await readdir(oldFolder())).toEqual(["garbage.json"]);
    });
    it("forgetting vault A removes A's old entries and keeps vault B's", async () => {
      const a = operation(), b = operation();
      await seedOld(a, "vault-a"); await seedOld(b, "vault-b");
      await removeLegacyCommentOperations("vault-a");
      expect(await readdir(oldFolder())).toEqual([`${b.operationId}.json`]);
      await removeLegacyCommentOperations("vault-b");
      await expect(readdir(oldFolder())).rejects.toThrow();
    });
  });
});
