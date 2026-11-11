import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import { byteExactDav, type ByteExactDav } from "../helpers/byteExactDav.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter } from "../../src/vault/BackupVaultAdapter.js";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import { VaultIndexer } from "../../src/vault/VaultIndexer.js";
import { VaultQueryService } from "../../src/vault/VaultQueryService.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { SyncWorker } from "../../src/sync/SyncWorker.js";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import { useRealDate } from "../../../../scripts/test-clock.mjs";

// This file is about the real clock (stability plan R9): "edited at" comes from
// the mtimes a real disk writes, and the "today" window and the server's clock
// must be the same clock as those. A test clock moves neither, so this file
// runs on the real one.
useRealDate();

/**
 * "Edited at" of a file the sync downloaded (Sammelplan § 3.164).
 *
 * The phone's Today list asked for the files' modification times, and a file
 * the sync writes carries the moment of the download: a tester who connected
 * his vault again found every old journal note under "edited today", all at
 * the same minute. Now every target lists when a file last changed on the
 * remote, the sync records that time with each version it writes, and the
 * index answers "edited at" with it for as long as the file holds that
 * version. An upload hands the remote the time the file was edited where the
 * store keeps one (here: Nextcloud's `X-OC-Mtime`), so the NEXT device to
 * download it sees that time, not the upload's.
 *
 * The real core throughout, as in merge-base-and-index.test.ts: adapter chain,
 * indexer, queue, engine, worker and the WebDAV target, real SQLite and real
 * folders, against an in-memory server that lists `getlastmodified`.
 */

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (closers.length > 0) await closers.pop()!();
});

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Whole seconds: the server keeps `X-OC-Mtime` as seconds. */
const JAN_10 = Date.UTC(2025, 0, 10, 9, 30);
const JAN_11 = Date.UTC(2025, 0, 11, 18, 5);
const JUNE_1 = Date.UTC(2024, 5, 1, 12);

async function device(dav: ByteExactDav) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-edited-at-"));
  const db = await realSqlite();
  closers.push(async () => {
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);
  let queued: Promise<unknown> = Promise.resolve();
  const later = (work: () => Promise<unknown>) => { queued = queued.then(work); };
  const indexer = new VaultIndexer(raw, db, {
    isOwnWrite: (p, sha256) => app.wasWrittenByUs(p, sha256),
    onExternalModification: (p) => later(() => queue.queueWrite(p)),
    onNewLocalFile: (p) => later(() => queue.queueWrite(p)),
    onLocalFileDeleted: (p) => later(() => queue.queueDelete(p)),
  });
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, dav.fetch);
  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000);
  (worker as unknown as { isRunning: boolean }).isRunning = true;
  const pulled: string[] = [];
  worker.onFilesChanged = (paths) => void pulled.push(...paths);
  const query = new VaultQueryService(db);
  const file = (p: string) => path.join(root, p);
  return {
    app,
    /** What a shell does around a cycle: the pass over the vault, the cycle, and the index told what the cycle wrote. */
    async cycle() {
      await indexer.indexVaultFull();
      await queued;
      await worker.runCycle();
      for (const p of pulled.splice(0)) await indexer.indexPath(p);
      await queued;
    },
    /** The app saves a note (editor, a checkbox): through the adapter chain, then the index. */
    async save(p: string, text: string) {
      await app.writeTextFile(p, text);
      await indexer.indexPath(p);
      await queued;
    },
    /** A file that lay in the folder before the vault was connected, changed at `mtime`. */
    async put(p: string, text: string, mtime: number) {
      await fs.mkdir(path.dirname(file(p)), { recursive: true });
      await fs.writeFile(file(p), text, "utf8");
      await fs.utimes(file(p), mtime / 1000, mtime / 1000);
    },
    /** The phone's Today list for [from, to). */
    async edited(from: number, to: number) {
      return (await query.listNotesModifiedBetween(from, to)).map((n) => [n.path, n.editedAt] as const);
    },
  };
}

function world() {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  // The server's clock is "now", as a real one is when an upload carries no time.
  const dav = byteExactDav(undefined, { clock: () => Date.now() });
  const seed = (p: string, text: string, modified: number) =>
    dav.files.set(p, { bytes: new TextEncoder().encode(text), etag: `seed-${p}`, modified });
  return { dav, seed };
}

/** "Today" as the list asks for it, wide enough not to depend on the hour the test runs. */
const recent = () => [Date.now() - 6 * HOUR, Date.now() + HOUR] as const;

describe("a note the sync downloaded counts by the time it changed on the server", () => {
  it("a freshly connected device lists none of the pulled notes as edited today, each on its own day", async () => {
    const { dav, seed } = world();
    seed("Journal/2025-01-10.md", "# Friday\n", JAN_10);
    seed("Journal/2025-01-11.md", "# Saturday\n", JAN_11);
    const phone = await device(dav);

    await phone.cycle();

    expect(await phone.edited(...recent())).toEqual([]);
    expect(await phone.edited(Date.UTC(2025, 0, 10), Date.UTC(2025, 0, 10) + DAY)).toEqual([["Journal/2025-01-10.md", JAN_10]]);
    expect(await phone.edited(Date.UTC(2025, 0, 11), Date.UTC(2025, 0, 11) + DAY)).toEqual([["Journal/2025-01-11.md", JAN_11]]);
  });

  it("an edit made here counts by its own time — after the save and after its upload", async () => {
    const { dav, seed } = world();
    seed("Plan.md", "# Plan\n", JAN_10);
    const phone = await device(dav);
    await phone.cycle();

    await phone.save("Plan.md", "# Plan\n\nchanged here\n");
    const [from, to] = recent();
    const afterSave = await phone.edited(from, to);
    expect(afterSave.map(([p]) => p)).toEqual(["Plan.md"]);

    await phone.cycle();
    expect((await phone.edited(from, to)).map(([p]) => p)).toEqual(["Plan.md"]);
    expect(await phone.edited(Date.UTC(2025, 0, 10), Date.UTC(2025, 0, 10) + DAY)).toEqual([]);
  });

  it("a note the device already held keeps its own time: nothing was downloaded over it", async () => {
    const { dav, seed } = world();
    seed("Same.md", "# Same\n", JAN_10);
    const desk = await device(dav);
    await desk.put("Same.md", "# Same\n", JUNE_1);

    await desk.cycle();

    expect(await desk.edited(Date.UTC(2024, 5, 1), Date.UTC(2024, 5, 1) + DAY)).toEqual([["Same.md", JUNE_1]]);
    expect(await desk.edited(Date.UTC(2025, 0, 10), Date.UTC(2025, 0, 10) + DAY)).toEqual([]);
  });

  it("a vault uploaded today shows its notes on the next device by when they were edited, not by the upload", async () => {
    const { dav } = world();
    const desk = await device(dav);
    await desk.put("Old.md", "# Old\n", JUNE_1);
    await desk.cycle();
    // The upload handed the server the edited time.
    expect(dav.files.get("Old.md")?.modified).toBe(JUNE_1);

    const phone = await device(dav);
    await phone.cycle();
    expect(await phone.edited(...recent())).toEqual([]);
    expect(await phone.edited(Date.UTC(2024, 5, 1), Date.UTC(2024, 5, 1) + DAY)).toEqual([["Old.md", JUNE_1]]);
  });

  it("a note another device changed today is listed as edited today on this one", async () => {
    const { dav, seed } = world();
    seed("Shared.md", "# Shared\n", JAN_10);
    const desk = await device(dav);
    const phone = await device(dav);
    await desk.cycle();
    await phone.cycle();
    expect(await phone.edited(...recent())).toEqual([]);

    await desk.save("Shared.md", "# Shared\n\nfrom the desk\n");
    await desk.cycle();
    await phone.cycle();

    const [from, to] = recent();
    expect((await phone.edited(from, to)).map(([p]) => p)).toEqual(["Shared.md"]);
  });
});
