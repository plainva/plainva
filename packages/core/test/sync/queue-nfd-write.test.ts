import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import type { ISyncTarget, SyncOperation } from "../../src/sync/ISyncTarget.js";

// Sammelplan 3.115 no. 5: a queued WRITE in the decomposed spelling whose file
// lives here under its composed identity must not hang in the queue.
const NFC = "Rücktritt".normalize("NFC");
const NFD = NFC.normalize("NFD");

describe("a queued write in the decomposed spelling (ADR 0016)", () => {
  let db: Awaited<ReturnType<typeof realSqlite>>;
  let root: string;
  let vault: LocalVaultAdapter;
  let queue: SyncQueue;
  let pushed: string[];
  let target: ISyncTarget;

  beforeEach(async () => {
    expect(NFC).not.toBe(NFD);
    db = await realSqlite();
    root = await mkdtemp(join(tmpdir(), "plainva-nfd-write-"));
    vault = new LocalVaultAdapter(root);
    await vault.initialize();
    queue = new SyncQueue(db);
    pushed = [];
    target = {
      async push(op: SyncOperation) { pushed.push(`${op.operation} ${op.file_path}`); },
      async pull() { return { etagMap: new Map() }; },
      async download() { return null; },
    };
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await db.close();
    await rm(root, { recursive: true, force: true });
  });

  const rows = async () => db.query<{ file_path: string }>("SELECT file_path FROM offline_queue");

  it("goes out under the composed identity and leaves the queue", async () => {
    await mkdir(join(root, "+"));
    await writeFile(join(root, "+", `${NFC}.md`), "body");
    await queue.queueWrite(`+/${NFD}.md`);

    await new SyncEngine(queue, target, vault).processQueue();

    expect(pushed).toEqual([`write +/${NFC}.md`]);
    expect(await rows()).toEqual([]);
  });

  it("is retired when the file is gone, instead of hanging", async () => {
    await queue.queueWrite(`+/${NFD}.md`);

    await new SyncEngine(queue, target, vault).processQueue();

    expect(await rows()).toEqual([]);
  });
});
