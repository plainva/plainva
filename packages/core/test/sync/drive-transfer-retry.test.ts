import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DriveSyncTarget } from "../../src/sync/DriveSyncTarget.js";
import { SyncWorker } from "../../src/sync/SyncWorker.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { classifySyncError } from "../../src/sync/errorKind.js";
import { realSqlite } from "../helpers/realSqlite.js";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(cleanups.splice(0).map(clean => clean())); });
function refusal(reasons: string[], status = 403) {
  return Response.json({ error: { errors: reasons.map(reason => ({ reason })) } }, { status, headers: { "Retry-After": "0" } });
}
function driveFixture(timeout = 30000) {
  const files = ["a.md", "b.md"].map((name, index) => ({ id: "file-" + index, name, md5Checksum: "revision-1", mimeType: "text/markdown", parents: ["vault-root"] }));
  let content: (name: string) => Response = name => new Response("Remote " + name);
  let writeResponse = () => Response.json({ id: "file-0", md5Checksum: "written" });
  const calls: string[] = [], cursors: string[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/startPageToken")) return Response.json({ startPageToken: "c0" });
    if (url.pathname.endsWith("/changes")) {
      cursors.push(url.searchParams.get("pageToken")!);
      return Response.json({ changes: files.map(file => ({ fileId: file.id, file })), newStartPageToken: "c1" });
    }
    if (url.searchParams.get("alt") === "media") {
      const file = files.find(file => url.pathname.endsWith("/" + file.id))!;
      calls.push(file.name); return content(file.name);
    }
    if (init?.method === "PATCH") return writeResponse();
    if (url.pathname.endsWith("/files") && init?.method === "GET") {
      const q = url.searchParams.get("q") ?? "";
      if (q.includes("vnd.google-apps.folder")) return Response.json({ files: [{ id: "vault-root", name: "Plainva", mimeType: "application/vnd.google-apps.folder" }] });
      const name = /name='([^']*)'/.exec(q)?.[1];
      return Response.json({ files: name ? files.filter(file => file.name === name) : files });
    }
    throw new Error("Unexpected Drive request " + init?.method + " " + url.pathname);
  });
  const target = new DriveSyncTarget({ clientId: "fixture", clientSecret: "fixture", refreshToken: "fixture", accessToken: "fixture" }, fetchFn, timeout);
  return { target, calls, cursors, files, fetchFn, setContent(fn: typeof content) { content = fn; }, setWrite(fn: typeof writeResponse) { writeResponse = fn; } };
}

describe("Drive download causes", () => {
  it.each(["userRateLimitExceeded", "rateLimitExceeded"])("retries %s within the bounded read backoff", async reason => {
    const d = driveFixture(); let count = 0;
    d.setContent(() => ++count < 3 ? refusal([reason]) : new Response("Recovered"));
    expect(new TextDecoder().decode((await d.target.download("a.md"))!)).toBe("Recovered");
    expect(count).toBe(3);
  });
  it("preserves an exhausted limit as transient, never as missing content", async () => {
    const d = driveFixture(); d.setContent(() => refusal(["userRateLimitExceeded"]));
    const error = await d.target.download("a.md").catch(error => error);
    expect(error).toBeInstanceOf(Error); expect(classifySyncError(error)).toBe("transient");
    expect(error.message).toContain("HTTP 403"); expect(d.calls).toHaveLength(4);
  });
  it.each([
    ["insufficientFilePermissions"], ["cannotDownloadAbusiveFile"], ["fileNotDownloadable"], ["unknownReason"],
    ["userRateLimitExceeded", "insufficientFilePermissions"], ["rateLimitExceeded", ""],
  ])("does not disguise a refused or mixed cause as a retryable limit: %j", async (...reasons) => {
    const d = driveFixture(); d.setContent(() => refusal(reasons));
    const error = await d.target.download("a.md").catch(error => error);
    expect(error).toBeInstanceOf(Error); expect(classifySyncError(error)).toBe("fatal");
    for (const reason of reasons.filter(Boolean)) expect(error.message).toContain(reason);
    expect(d.calls).toHaveLength(1);
  });
  it.each(["not json", JSON.stringify({ error: { message: "userRateLimitExceeded" } })])("does not infer a limit from an unstructured body", async body => {
    const d = driveFixture(); d.setContent(() => new Response(body, { status: 403 }));
    const error = await d.target.download("a.md").catch(error => error);
    expect(error).toBeInstanceOf(Error); expect(classifySyncError(error)).toBe("fatal");
    expect(d.calls).toHaveLength(1);
  });
  it("keeps 404 separate and leaves rejected writes to the durable queue", async () => {
    const d = driveFixture(); d.setContent(() => new Response(null, { status: 404 }));
    expect(await d.target.download("a.md")).toBeNull();
    let writes = 0; d.setWrite(() => { writes++; return refusal(["rateLimitExceeded"]); });
    await expect(d.target.push({ id: 1, operation: "write", file_path: "a.md", content: new TextEncoder().encode("Local"), queued_at: 1, retry_count: 0, next_retry_at: 0 })).rejects.toThrow("rateLimitExceeded");
    expect(writes).toBe(1);
  });
});

async function workerFixture(timeout = 30000) {
  const d = driveFixture(timeout), db = await realSqlite(), dir = await mkdtemp(join(tmpdir(), "plainva-drive-retry-"));
  const raw = new LocalVaultAdapter(dir); await raw.initialize();
  const state = new SyncStateRepository(db), queue = new SyncQueue(db), engine = new SyncEngine(queue, d.target, raw);
  const worker = new SyncWorker(engine, d.target, state, raw, queue, 1000);
  worker["isRunning"] = true;
  cleanups.push(async () => { worker.stop(); await db.close(); await rm(dir, { recursive: true, force: true }); });
  const statuses: Array<{ status: string; detail?: string }> = [];
  worker.onStatusChange = (status, detail) => statuses.push({ status, detail });
  vi.spyOn(console, "error").mockImplementation(() => {});
  return { ...d, db, raw, state, queue, worker, statuses };
}

describe("Drive and the actual worker with files and SQLite", () => {
  it("keeps the old file, baseline and cursor after a partial stream times out, then completes the same change", async () => {
    const w = await workerFixture(50);
    await w.worker.runCycle();
    const original = await w.state.getSyncState("b.md");
    const cancelled = vi.fn();
    for (const file of w.files) file.md5Checksum = "revision-2";
    w.setContent(name => name === "b.md" ? new Response(new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode("PARTIAL, MUST NOT REPLACE THE NOTE")); }, cancel: cancelled,
    })) : new Response("Updated " + name));
    vi.useFakeTimers(); vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      let done = false;
      const cycle = w.worker.runCycle().finally(() => { done = true; });
      await vi.waitFor(async () => { await vi.runAllTimersAsync(); expect(done).toBe(true); }, { interval: 10, timeout: 1000 });
      await cycle;
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
    expect(cancelled).toHaveBeenCalledTimes(4);
    expect(await w.raw.readTextFile("a.md")).toBe("Updated a.md");
    expect(await w.raw.readTextFile("b.md")).toBe("Remote b.md");
    expect(await w.state.getSyncState("b.md")).toEqual(original);
    expect(w.worker["cursor"]).toBe("c0");
    expect(w.statuses.at(-1)).toMatchObject({ status: "retrying", detail: expect.stringContaining("timed out") });
    w.setContent(name => new Response("Updated " + name));
    await w.worker.runCycle();
    expect(w.cursors).toEqual(["c0", "c0"]); expect(w.worker["cursor"]).toBe("c1");
    expect(await w.raw.readTextFile("b.md")).toBe("Updated b.md");
    expect((await w.state.getSyncState("b.md"))?.base_etag).toBe("revision-2");
  });

  it("preserves the refused cause when consecutive file failures abort the cycle", async () => {
    const w = await workerFixture();
    for (let i = 2; i < 12; i++) w.files.push({ ...w.files[0], id: `file-${i}`, name: `note-${i}.md` });
    w.setContent(name => refusal([name === "a.md" ? "insufficientFilePermissions" : "userRateLimitExceeded"]));
    await w.worker.runCycle();
    expect(w.statuses.at(-1)?.status).toBe("error");
    expect(w.statuses.at(-1)?.detail).toContain("insufficientFilePermissions");
    expect(w.statuses.at(-1)?.detail).toContain("aborted");
    expect(w.worker["cursor"]).toBeUndefined();
  });
  it.each(["a.md", "b.md"])("keeps a permanent refusal visible beside temporary limits (%s denied)", async denied => {
    const w = await workerFixture();
    w.setContent(name => refusal([name === denied ? "insufficientFilePermissions" : "userRateLimitExceeded"]));
    await w.worker.runCycle();
    expect(w.statuses.at(-1)?.status).toBe("error");
    expect(w.statuses.at(-1)?.detail).toContain("insufficientFilePermissions");
    expect(w.worker["cursor"]).toBeUndefined();
  });
  it.each(["userRateLimitExceeded", "insufficientFilePermissions"])("keeps an incremental change open after %s and completes it on replay", async reason => {
    const w = await workerFixture();
    await w.worker.runCycle(); expect(w.worker["cursor"]).toBe("c0");
    const original = await w.state.getSyncState("b.md");
    for (const file of w.files) file.md5Checksum = "revision-2";
    w.setContent(name => name === "b.md" ? refusal([reason]) : new Response("Updated " + name));
    await w.worker.runCycle();
    expect(w.cursors).toEqual(["c0"]); expect(w.worker["cursor"]).toBe("c0");
    expect(await w.raw.readTextFile("a.md")).toBe("Updated a.md");
    expect(await w.raw.readTextFile("b.md")).toBe("Remote b.md");
    expect(await w.state.getSyncState("b.md")).toEqual(original);
    expect(w.statuses.at(-1)).toMatchObject({ status: reason === "userRateLimitExceeded" ? "retrying" : "error" });
    expect(w.statuses.at(-1)?.detail).toContain(reason); expect(w.statuses.at(-1)?.detail).toContain("b.md");
    w.setContent(name => new Response("Updated " + name)); await w.worker.runCycle();
    expect(w.cursors).toEqual(["c0", "c0"]); expect(w.worker["cursor"]).toBe("c1");
    expect(await w.raw.readTextFile("b.md")).toBe("Updated b.md");
    expect((await w.state.getSyncState("b.md"))?.base_etag).toBe("revision-2");
    expect(w.statuses.at(-1)?.status).toBe("idle"); expect(await w.queue.getPendingOperations()).toEqual([]);
  });
  it("does not adopt a full-listing cursor or invent a sync state for a failed first download", async () => {
    const w = await workerFixture(); w.setContent(name => name === "b.md" ? refusal(["userRateLimitExceeded"]) : new Response("First a"));
    await w.worker.runCycle();
    expect(w.worker["cursor"]).toBeUndefined(); expect(await w.raw.exists("b.md")).toBe(false);
    expect(await w.state.getSyncState("b.md")).toBeNull(); expect(await w.raw.readTextFile("a.md")).toBe("First a");
    w.setContent(name => new Response("Recovered " + name)); await w.worker.runCycle();
    expect(w.worker["cursor"]).toBe("c0"); expect(await w.raw.readTextFile("b.md")).toBe("Recovered b.md");
  });
});
