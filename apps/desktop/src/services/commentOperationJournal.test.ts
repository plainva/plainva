import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { prepareCommentOperation } from "@plainva/core";

const bridge = vi.hoisted(() => ({ invoke: vi.fn(), mkdir: vi.fn(), directory: "", owner: true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => bridge.invoke(...args) }));
vi.mock("@tauri-apps/api/path", () => ({ appDataDir: async () => bridge.directory, join: async (...parts: string[]) => parts.join("/") }));
vi.mock("@tauri-apps/plugin-fs", () => ({ mkdir: (...args: unknown[]) => bridge.mkdir(...args) }));
vi.mock("./windowContext", () => ({ isOwnerWindow: () => bridge.owner }));
// The existing journal owns the vault directory naming, covered by its tests.
vi.mock("./draftJournal", () => ({ pathHash: (value: string) => Buffer.from(value).toString("hex") }));
import { desktopCommentOperationJournal } from "./commentOperationJournal";

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
});
