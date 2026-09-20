import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { IVaultAdapter } from "@plainva/core";
import { importSharedContent, type ShareImportContext } from "./shareImport";
import { SHARE_LIMITS, validateShare, type PendingShare, type ShareTargetPort } from "./shareTarget";

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
function fixture() {
  const payload = new Uint8Array(300_000).fill(72), id = "aaaaaaaa-1111-2222-3333-444444444444", fileId = "bbbbbbbb-1111-2222-3333-444444444444";
  let entry: PendingShare = { version: 1, id, createdAt: 100, status: "ready", text: "A shared text\nhttps://example.test/agenda", subject: "Agenda", files: [{ id: fileId, name: "../sketch.png", mime: "image/png", size: payload.length, sha256: createHash("sha256").update(payload).digest("hex") }] };
  const contents = new Map<string, string | Uint8Array>();
  let acknowledged = false;
  const port: ShareTargetPort = {
    listPendingShares: vi.fn(async () => ({ entries: acknowledged ? [] : [clone(entry)] })),
    beginImport: vi.fn(async ({ plan }) => { entry.plan ??= clone(plan); return { entry: clone(entry) }; }),
    readFileChunk: vi.fn(async ({ offset, length }) => ({ data: Buffer.from(payload.slice(offset, offset + length)).toString("base64") })),
    markImported: vi.fn(async ({ fileId, note }) => { if (note) entry.noteWritten = true; else entry.filesDone = [...new Set([...(entry.filesDone ?? []), fileId!])]; }),
    finishShare: vi.fn(async () => { if (!entry.noteWritten) throw Error("premature ack"); acknowledged = true; }),
  };
  const files = {
    exists: vi.fn(async (path: string) => contents.has(path)),
    writeBinaryFile: vi.fn(async (path: string, bytes: Uint8Array) => { contents.set(path, bytes.slice()); }),
    writeTextFile: vi.fn(async (path: string, text: string) => { contents.set(path, text); }),
    readBinaryFile: vi.fn(async (path: string) => (contents.get(path) as Uint8Array).slice()),
    readTextFile: vi.fn(async (path: string) => contents.get(path) as string),
  };
  const context: ShareImportContext = { vaultId: "test-vault", files: files as unknown as IVaultAdapter, folder: "Inbox", ensureOpen: vi.fn(async () => {}) };
  return { port, context, files, contents, get: () => clone(entry), set: (value: PendingShare) => { entry = value; }, payload };
}
describe("durable inbound transfers", () => {
  it("bounds Unicode names by UTF-8 bytes and keeps attachment links readable", async () => {
    const f = fixture(), entry = f.get(); entry.subject = "日😀".repeat(80); entry.files[0].name = "日😀".repeat(80) + ".png"; f.set(entry);
    const path = await importSharedContent(f.port, entry, f.context);
    expect(new TextEncoder().encode(path.split("/").pop()!).length).toBeLessThanOrEqual(180);
    for (const target of f.contents.keys()) expect(target.split("/").every(part => new TextEncoder().encode(part).length <= 255)).toBe(true);
    expect(f.contents.get(path)).not.toContain("�"); expect(f.port.finishShare).toHaveBeenCalledTimes(1);
  });
  it("'as a task': the note lands where the host says a task belongs, with the text and the attachment in its body", async () => {
    const f = fixture();
    const asTask = vi.fn(async ({ title, body }: { title: string; body: string }) => ({
      folder: "Aufgaben",
      text: `---\nstatus: Offen\n---\n# ${title}\n\n${body}\n`,
    }));
    const path = await importSharedContent(f.port, f.get(), { ...f.context, asTask });
    expect(path).toBe("Aufgaben/Agenda (aaaaaaaa).md");
    expect(asTask).toHaveBeenCalledTimes(1);
    const note = f.contents.get(path) as string;
    expect(note).toContain("status: Offen");
    expect(note).toContain("# Agenda");
    expect(note).toContain("https://example.test/agenda");
    expect(note).toContain("![[Attachments/Shared/aaaaaaaa-1111-2222-3333-444444444444/1-sketch.png]]");
    // The plan is durable: a second run finishes THIS plan and asks nobody again.
    expect(f.get().plan?.notePath).toBe(path);
    await importSharedContent(f.port, f.get(), { ...f.context, asTask }).catch(() => undefined);
    expect(asTask).toHaveBeenCalledTimes(1);
  });
  it("'as a task' refuses a folder that is not a safe vault path, before anything is planned or written", async () => {
    const f = fixture();
    await expect(importSharedContent(f.port, f.get(), { ...f.context, asTask: async () => ({ folder: "../outside", text: "x" }) })).rejects.toThrow("SHARE_INVALID");
    expect(f.port.beginImport).not.toHaveBeenCalled();
    expect(f.files.writeTextFile).not.toHaveBeenCalled();
  });
  it("rejects a same-size payload whose digest changed before writing or acknowledging", async () => {
    const f = fixture(); f.payload[4] = 73;
    await expect(importSharedContent(f.port, f.get(), f.context)).rejects.toThrow("SHARE_INCOMPLETE");
    expect(f.files.writeBinaryFile).not.toHaveBeenCalled(); expect(f.files.writeTextFile).not.toHaveBeenCalled(); expect(f.port.finishShare).not.toHaveBeenCalled();
  });
  it("reads a file in bounded chunks, verifies storage, and consumes only after the note", async () => {
    const f = fixture(); const path = await importSharedContent(f.port, f.get(), f.context);
    expect(f.contents.size).toBe(2); expect(path).toBe("Inbox/Agenda (aaaaaaaa).md");
    expect(f.contents.get(path)).toContain("![[Attachments/Shared/");
    expect(f.contents.get(path)).toContain("https://example.test/agenda");
    expect(vi.mocked(f.port.readFileChunk).mock.calls.map(([a]) => a.length)).toEqual([SHARE_LIMITS.chunkBytes, 300_000 - SHARE_LIMITS.chunkBytes]);
    expect(await f.port.listPendingShares()).toEqual({ entries: [] });
  });
  it.each(["attachment-write", "file-checkpoint", "note-checkpoint", "ack"])("resumes after %s interruption without another note or attachment", async point => {
    const f = fixture();
    if (point === "attachment-write") f.files.writeBinaryFile.mockImplementationOnce(async (path, bytes) => { f.contents.set(path, bytes.slice()); throw Error("process ended after durable write"); });
    if (point === "file-checkpoint") vi.mocked(f.port.markImported).mockRejectedValueOnce(Error("checkpoint unavailable"));
    if (point === "note-checkpoint") {
      const real = f.port.markImported; let failed = false;
      f.port.markImported = vi.fn(async args => { if (args.note && !failed) { failed = true; throw Error("checkpoint unavailable"); } await real(args); });
    }
    if (point === "ack") vi.mocked(f.port.finishShare).mockRejectedValueOnce(Error("ack unavailable"));
    await expect(importSharedContent(f.port, f.get(), f.context)).rejects.toThrow();
    const savedBefore = f.get(); expect((await f.port.listPendingShares()).entries).toHaveLength(1);
    const result = await importSharedContent(f.port, savedBefore, f.context);
    expect(result).toBe("Inbox/Agenda (aaaaaaaa).md"); expect(f.contents.size).toBe(2);
    expect(f.files.writeBinaryFile).toHaveBeenCalledTimes(1); expect(f.files.writeTextFile).toHaveBeenCalledTimes(1);
  });
  it("never writes into a locked vault or acknowledges a failed write", async () => {
    const f = fixture(); vi.mocked(f.context.ensureOpen).mockRejectedValue(Error("SHARE_LOCKED"));
    await expect(importSharedContent(f.port, f.get(), f.context)).rejects.toThrow("SHARE_LOCKED");
    expect(f.port.beginImport).not.toHaveBeenCalled(); expect(f.contents.size).toBe(0);
    vi.mocked(f.context.ensureOpen).mockResolvedValue(); f.files.writeTextFile.mockRejectedValue(Error("disk full"));
    await expect(importSharedContent(f.port, f.get(), f.context)).rejects.toThrow("disk full");
    expect(f.port.finishShare).not.toHaveBeenCalled(); expect((await f.port.listPendingShares()).entries).toHaveLength(1);
  });
  it("cancels between chunks and preserves all native content", async () => {
    const f = fixture(), controller = new AbortController(); f.context.signal = controller.signal;
    vi.mocked(f.port.readFileChunk).mockImplementationOnce(async ({ length }) => { controller.abort(); return { data: Buffer.from(f.payload.slice(0, length)).toString("base64") }; });
    await expect(importSharedContent(f.port, f.get(), f.context)).rejects.toMatchObject({ name: "AbortError" });
    expect(f.contents.size).toBe(0); expect(f.port.finishShare).not.toHaveBeenCalled();
    f.context.signal = undefined; await importSharedContent(f.port, f.get(), f.context); expect(f.contents.size).toBe(2);
  });
  it("keeps a changed destination intact after a crash, including after a note write", async () => {
    const f = fixture(); const real = f.port.markImported;
    f.port.markImported = vi.fn(async args => { if (args.note) throw Error("process ended"); await real(args); });
    await expect(importSharedContent(f.port, f.get(), f.context)).rejects.toThrow();
    f.contents.set(f.get().plan!.notePath, "User edited this note");
    await expect(importSharedContent(f.port, f.get(), f.context)).rejects.toThrow("SHARE_TARGET_CHANGED");
    expect(f.contents.get(f.get().plan!.notePath)).toBe("User edited this note"); expect(f.port.finishShare).not.toHaveBeenCalled();
  });
  it("acknowledges a previously recorded import without restoring a later user deletion", async () => {
    const f = fixture(); vi.mocked(f.port.finishShare).mockRejectedValueOnce(Error("offline bridge"));
    await expect(importSharedContent(f.port, f.get(), f.context)).rejects.toThrow();
    f.contents.delete(f.get().plan!.notePath);
    await importSharedContent(f.port, f.get(), f.context); expect(f.files.writeTextFile).toHaveBeenCalledTimes(1);
  });
  it("does not silently switch the target vault on resume or during another run", async () => {
    const f = fixture(); vi.mocked(f.port.finishShare).mockRejectedValueOnce(Error("offline bridge"));
    await expect(importSharedContent(f.port, f.get(), f.context)).rejects.toThrow();
    await expect(importSharedContent(f.port, f.get(), { ...f.context, vaultId: "another" })).rejects.toThrow("SHARE_OTHER_VAULT");
    const running = importSharedContent(f.port, f.get(), f.context);
    await expect(importSharedContent(f.port, f.get(), { ...f.context, vaultId: "another" })).rejects.toThrow("SHARE_OTHER_VAULT"); await running;
  });
  it("treats an explicit second share of equal content as a different transfer", async () => {
    const first = fixture(), second = fixture(); const next = second.get(); next.id = "cccccccc-1111-2222-3333-444444444444"; second.set(next);
    const paths = await Promise.all([importSharedContent(first.port, first.get(), first.context), importSharedContent(second.port, second.get(), second.context)]);
    expect(paths[0]).not.toBe(paths[1]);
  });
  it("rejects malformed metadata, oversized files, bad chunks and changed staging", async () => {
    const f = fixture(), malformed = f.get(); malformed.files[0].size = 26 * 1024 * 1024;
    expect(() => validateShare(malformed)).toThrow(); malformed.id = "../escape"; expect(() => validateShare(malformed)).toThrow();
    vi.mocked(f.port.readFileChunk).mockResolvedValue({ data: "QQ==" });
    await expect(importSharedContent(f.port, f.get(), f.context)).rejects.toThrow("SHARE_INCOMPLETE");
    expect(f.contents.size).toBe(0);
  });
});
