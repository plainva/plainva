import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, writeFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { prepareCommentOperation } from "@plainva/core";

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
