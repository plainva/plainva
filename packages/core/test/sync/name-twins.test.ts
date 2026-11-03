import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { realSqlite } from "../helpers/realSqlite.js";
import { byteExactDav, type ByteExactDav } from "../helpers/byteExactDav.js";
import type { IDatabaseAdapter } from "../../src/db/IDatabaseAdapter.js";
import { LocalVaultAdapter } from "../../src/vault/LocalVaultAdapter.js";
import { BackupVaultAdapter } from "../../src/vault/BackupVaultAdapter.js";
import { QueueingVaultAdapter } from "../../src/vault/QueueingVaultAdapter.js";
import { ConflictAwareVaultAdapter } from "../../src/vault/ConflictAwareVaultAdapter.js";
import { SyncStateRepository } from "../../src/vault/SyncStateRepository.js";
import { SyncQueue } from "../../src/sync/SyncQueue.js";
import { SyncEngine } from "../../src/sync/SyncEngine.js";
import { SyncWorker } from "../../src/sync/SyncWorker.js";
import { WebDavSyncTarget } from "../../src/sync/WebDavSyncTarget.js";
import { backupDirFor } from "../../src/vault/backupNaming.js";
import { freeCopyPath, groupNameCollisions, type NameCollisionCase } from "../../src/sync/nameTwins.js";

/**
 * "Two spellings, one file" as a card a person can act on (finding
 * 2026-11-03). On an iPhone syncing with Google Drive the card listed pairs
 * like `Aufgaben/Notiz.md ↔ Aufgaben/Notiz.md`: the same name in its composed
 * and its decomposed Unicode form, side by side in one cloud folder (ADR
 * 0016). Both looked the same, the card said "rename one", and nothing on it
 * could tell them apart or act.
 *
 * Real core: adapter chain, queue, engine, worker, SQLite, the WebDAV target
 * against a byte-exact in-memory server, on the test machine's disk.
 */

// Built by normalizing, so a tool that rewrites this file cannot turn the two
// spellings into one (the tests would then pass for nothing).
const NAME = "Brötchen holen.md".normalize("NFC");
const NFC = `Aufgaben/${NAME}`;
const NFD = `Aufgaben/${NAME.normalize("NFD")}`;
const BODY = "# Brötchen holen\n\n- [ ] beim Bäcker\n";
const OTHER_BODY = "# Brötchen holen\n\n- [x] beim Bäcker, schon erledigt\n";
const bytes = (text: string) => new TextEncoder().encode(text);

async function sha(text: string): Promise<string> {
  const buf = await globalThis.crypto.subtle.digest("SHA-256", bytes(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function diskKeepsBothSpellings(): Promise<boolean> {
  const probe = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-twin-probe-"));
  try {
    await fs.writeFile(path.join(probe, NAME), "a");
    await fs.writeFile(path.join(probe, NAME.normalize("NFD")), "b");
    return (await fs.readdir(probe)).length === 2;
  } catch {
    return false;
  } finally {
    await fs.rm(probe, { recursive: true, force: true });
  }
}
const keepsBothSpellings = await diskKeepsBothSpellings();

const worlds: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (worlds.length > 0) await worlds.pop()!();
});

interface World {
  root: string;
  db: IDatabaseAdapter;
  dav: ByteExactDav;
  queue: SyncQueue;
  worker: SyncWorker;
  cases: (readonly NameCollisionCase[])[];
  changed: string[];
  cycle(): Promise<void>;
  settle(): Promise<void>;
  queued(): Promise<string[]>;
  onDisk(): Promise<string[]>;
}

/**
 * A synced note `Aufgaben/Brötchen holen.md` (composed, here and in the
 * cloud), plus whatever twin the test puts next to it.
 */
async function world(opts: { cloudTwin?: string; localTwin?: string; looseDelete?: boolean } = {}): Promise<World> {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "plainva-twins-"));
  const db = await realSqlite();
  const raw = new LocalVaultAdapter(root);
  await raw.initialize();
  const backup = new BackupVaultAdapter(raw);
  const queue = new SyncQueue(db);
  const repo = new SyncStateRepository(db);
  const app = new ConflictAwareVaultAdapter(new QueueingVaultAdapter(backup, queue), repo);

  const dav = byteExactDav("https://dav.example.com/dav/Vault/", { clock: () => Date.UTC(2026, 8, 22, 13, 59) });
  dav.folders.add("Aufgaben");
  dav.files.set(NFC, { bytes: bytes(BODY), etag: "e-nfc", modified: Date.UTC(2026, 8, 22, 13, 59) });
  if (opts.cloudTwin !== undefined) dav.files.set(NFD, { bytes: bytes(opts.cloudTwin), etag: "e-nfd", modified: Date.UTC(2026, 8, 22, 13, 58) });
  await fs.mkdir(path.join(root, "Aufgaben"));
  await fs.writeFile(path.join(root, NFC), BODY);
  if (opts.localTwin !== undefined) await fs.writeFile(path.join(root, NFD), opts.localTwin);
  // What the indexer does with a new file on this disk: queue it. The engine
  // holds a twin's write and reports it.
  if (opts.localTwin !== undefined) await queue.queueWrite(NFD);
  const h = await sha(BODY);
  await db.execute(
    `INSERT INTO sync_state (path, local_sha256, remote_etag, base_sha256, base_etag, last_sync_ts, base_text) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [NFC, h, "e-nfc", h, "e-nfc", Date.now(), BODY],
  );

  // A store that matches a DELETE looser than it lists names takes the
  // composed file along (the safety net after a removal).
  const fetch: typeof dav.fetch = async (input, init) => {
    const res = await dav.fetch(input, init);
    if (opts.looseDelete && (init?.method ?? "").toUpperCase() === "DELETE") dav.files.delete(NFC);
    return res;
  };
  const target = new WebDavSyncTarget({ url: dav.url, user: "u", pass: "p" }, fetch);
  target.allowRootCreation = false;
  const engine = new SyncEngine(queue, target, app, repo);
  const worker = new SyncWorker(engine, target, repo, backup, queue, 60_000);
  (worker as any).isRunning = true;
  const cases: (readonly NameCollisionCase[])[] = [];
  const changed: string[] = [];
  worker.onNameCollisionCases = (c) => void cases.push(c);
  worker.onFilesChanged = (p) => void changed.push(...p);
  worlds.push(async () => {
    worker.stop();
    await (worker as any).currentCycle?.catch(() => undefined);
    await db.close();
    await fs.rm(root, { recursive: true, force: true });
  });
  return {
    root, db, dav, queue, worker, cases, changed,
    async cycle() {
      await worker.runCycle();
    },
    async settle() {
      // The resolution starts a cycle of its own when it is done.
      await (worker as any).currentCycle?.catch(() => undefined);
    },
    async queued() {
      const rows = await db.query<{ operation: string; file_path: string }>(`SELECT operation, file_path FROM offline_queue ORDER BY id`);
      return rows.map((r) => `${r.operation} ${r.file_path}`);
    },
    async onDisk() {
      return (await fs.readdir(path.join(root, "Aufgaben"))).sort();
    },
  };
}

describe("the collision card lists each case once", () => {
  it("one case per name, whichever side and direction reported it", () => {
    const cases = groupNameCollisions([
      { path: NFD, twin: NFC },
      { path: NFD, twin: NFC },
      { path: "Notes/idea.md", twin: "Notes/Idea.md" },
      { path: "Notes/Idea.md", twin: "Notes/idea.md" },
    ]);
    expect(cases.map((c) => [c.kind, c.path, c.others])).toEqual([
      ["spelling", NFC, [NFD]],
      ["case", "Notes/idea.md", ["Notes/Idea.md"]],
    ]);
  });

  it("names a copy freely: the name itself, then (2), (3) - free whatever the letter case or Unicode form", () => {
    expect(freeCopyPath("A/Note.md", [])).toBe("A/Note.md");
    expect(freeCopyPath(NFC, [NFC])).toBe(`Aufgaben/${"Brötchen holen (2).md".normalize("NFC")}`);
    expect(freeCopyPath("A/Note.md", ["A/Note.md", "a/note (2).md", "A/NOTE (3).md".normalize("NFD")])).toBe("A/Note (4).md");
    expect(freeCopyPath("A/README", ["A/README"])).toBe("A/README (2)");
    // A copy's name is created composed (ADR 0016).
    expect(freeCopyPath(NFD, [NFC])).toBe(`Aufgaben/${"Brötchen holen (2).md".normalize("NFC")}`);
  });

  it("tells an identical twin in the cloud apart by its facts, once, with the removal as its action", async () => {
    const w = await world({ cloudTwin: BODY });
    await w.cycle();
    await w.cycle();
    const last = w.cases.at(-1)!;
    expect(last).toHaveLength(1);
    expect(last[0]).toMatchObject({
      kind: "spelling",
      path: NFC,
      others: [NFD],
      described: true,
      where: { here: false, remote: true },
      identical: true,
      action: "remove-duplicate",
      other: { size: bytes(BODY).length, modifiedMs: Date.UTC(2026, 8, 22, 13, 58) },
    });
    expect(last[0].synced?.size).toBe(bytes(BODY).length);
    // The twin was downloaded once for the two cycles, not every minute.
    expect(w.dav.log.filter((l) => l === `GET ${NFD}`)).toHaveLength(1);
  });

  it("says a differing twin differs and offers to keep both", async () => {
    const w = await world({ cloudTwin: OTHER_BODY });
    await w.cycle();
    expect(w.cases.at(-1)![0]).toMatchObject({ identical: false, action: "keep-both", other: { size: bytes(OTHER_BODY).length } });
  });
});

describe("Remove duplicates", () => {
  it("removes an identical twin from the cloud, keeps its bytes in the history and never touches the composed file", async () => {
    const w = await world({ cloudTwin: BODY });
    await w.cycle();

    const result = await w.worker.resolveNameCollisions("remove-duplicate");
    await w.settle();

    expect(result).toMatchObject({ removed: 1, kept: [], skipped: 0, restored: [] });
    expect([...w.dav.files.keys()]).toEqual([NFC]);
    expect(new TextDecoder().decode(w.dav.files.get(NFC)!.bytes)).toBe(BODY);
    expect(w.dav.log.filter((l) => l.startsWith("DELETE"))).toEqual([`DELETE ${NFD}`]);
    expect(await w.onDisk()).toEqual([NAME]);
    expect(await fs.readFile(path.join(w.root, NFC), "utf8")).toBe(BODY);
    // A recoverable copy: the bytes sit in the composed note's version history.
    const history = await fs.readdir(path.join(w.root, backupDirFor(NFC)));
    expect(history).toHaveLength(1);
    expect(await fs.readFile(path.join(w.root, backupDirFor(NFC), history[0]!), "utf8")).toBe(BODY);
    // Not through the queue: no DELETE waits for the engine or a journal.
    expect(await w.queued()).toEqual([]);
    // The cycle after the resolution takes the card down.
    expect(w.cases.at(-1)).toEqual([]);
  });

  it("leaves a twin whose bytes differ", async () => {
    const w = await world({ cloudTwin: OTHER_BODY });
    await w.cycle();
    const result = await w.worker.resolveNameCollisions("remove-duplicate");
    await w.settle();
    expect(result).toMatchObject({ removed: 0, skipped: 1 });
    expect([...w.dav.files.keys()].sort()).toEqual([NFC, NFD].sort());
    expect(w.dav.log.filter((l) => l.startsWith("DELETE"))).toEqual([]);
  });

  it("compares again right before: a twin changed since the card was drawn is not removed", async () => {
    const w = await world({ cloudTwin: BODY });
    await w.cycle();
    expect(w.cases.at(-1)![0].identical).toBe(true);
    w.dav.files.set(NFD, { bytes: bytes(OTHER_BODY), etag: "e-nfd-2" });
    const result = await w.worker.resolveNameCollisions("remove-duplicate");
    await w.settle();
    expect(result).toMatchObject({ removed: 0, skipped: 1 });
    expect(w.dav.files.has(NFD)).toBe(true);
  });

  it("uploads the composed file again when the store took it along with its twin", async () => {
    const w = await world({ cloudTwin: BODY, looseDelete: true });
    await w.cycle();
    const result = await w.worker.resolveNameCollisions("remove-duplicate");
    expect(result.restored).toEqual([NFC]);
    await w.settle();
    // The cycle after it carried the copy from here up again.
    expect(new TextDecoder().decode(w.dav.files.get(NFC)!.bytes)).toBe(BODY);
    expect(await fs.readFile(path.join(w.root, NFC), "utf8")).toBe(BODY);
  });

  it.skipIf(!keepsBothSpellings)("removes an identical twin on this device into the backups, nothing in the cloud", async () => {
    const w = await world({ localTwin: BODY });
    await w.cycle();
    expect(w.cases.at(-1)![0]).toMatchObject({ where: { here: true, remote: false }, identical: true, action: "remove-duplicate" });

    const result = await w.worker.resolveNameCollisions("remove-duplicate");
    await w.settle();

    expect(result).toMatchObject({ removed: 1, skipped: 0 });
    expect(await w.onDisk()).toEqual([NAME]);
    expect(await fs.readFile(path.join(w.root, NFC), "utf8")).toBe(BODY);
    expect([...w.dav.files.keys()]).toEqual([NFC]);
    expect(w.dav.log.filter((l) => l.startsWith("DELETE"))).toEqual([]);
    // The backup adapter snapshotted the twin before it went. A new name is
    // created composed (ADR 0016), so the snapshot sits in the history of the
    // note that stays.
    const history = await fs.readdir(path.join(w.root, backupDirFor(NFC)));
    const snapshots = await Promise.all(history.filter((h) => h.startsWith(NAME)).map((h) => fs.readFile(path.join(w.root, backupDirFor(NFC), h), "utf8")));
    expect(snapshots).toContain(BODY);
    expect(w.changed).toContain(NFD);
    expect(w.cases.at(-1)).toEqual([]);
  });
});

describe("Keep both", () => {
  const COPY = `Aufgaben/${"Brötchen holen (2).md".normalize("NFC")}`;

  it("makes a differing twin in the cloud a file of its own, which syncs like any other", async () => {
    const w = await world({ cloudTwin: OTHER_BODY });
    await w.cycle();

    const result = await w.worker.resolveNameCollisions("keep-both");
    await w.settle();

    expect(result).toMatchObject({ removed: 1, kept: [COPY], skipped: 0 });
    // Here: the composed note unchanged, the twin's bytes under the new name.
    expect(await fs.readFile(path.join(w.root, NFC), "utf8")).toBe(BODY);
    expect(await fs.readFile(path.join(w.root, COPY), "utf8")).toBe(OTHER_BODY);
    // Cloud: the twin is gone, the copy went up with the cycle that followed.
    expect([...w.dav.files.keys()].sort()).toEqual([COPY, NFC].sort());
    expect(new TextDecoder().decode(w.dav.files.get(COPY)!.bytes)).toBe(OTHER_BODY);
    expect(new TextDecoder().decode(w.dav.files.get(NFC)!.bytes)).toBe(BODY);
    expect(w.changed).toContain(COPY);
    expect(w.cases.at(-1)).toEqual([]);
  });

  it("does not offer to keep an identical twin", async () => {
    const w = await world({ cloudTwin: BODY });
    await w.cycle();
    const result = await w.worker.resolveNameCollisions("keep-both");
    await w.settle();
    expect(result).toMatchObject({ removed: 0, kept: [], skipped: 1 });
    expect(w.dav.files.has(NFD)).toBe(true);
  });

  it("does not write a second copy where a numbered copy already holds the twin's bytes", async () => {
    const w = await world({ cloudTwin: OTHER_BODY });
    await fs.writeFile(path.join(w.root, COPY), OTHER_BODY);
    await w.cycle();
    const result = await w.worker.resolveNameCollisions("keep-both");
    await w.settle();
    expect(result).toMatchObject({ removed: 1, kept: [] });
    expect((await w.onDisk()).filter((n) => n.includes("(3)"))).toEqual([]);
    expect(w.dav.files.has(NFD)).toBe(false);
  });

  it.skipIf(!keepsBothSpellings)("renames a differing twin on this device to a free name and queues it as a new file", async () => {
    const w = await world({ localTwin: OTHER_BODY });
    await w.cycle();
    expect(w.cases.at(-1)![0]).toMatchObject({ where: { here: true, remote: false }, identical: false, action: "keep-both" });

    const result = await w.worker.resolveNameCollisions("keep-both");
    await w.settle();

    expect(result).toMatchObject({ removed: 0, kept: [COPY] });
    expect(await w.onDisk()).toEqual([NAME, "Brötchen holen (2).md".normalize("NFC")].sort());
    expect(await fs.readFile(path.join(w.root, COPY), "utf8")).toBe(OTHER_BODY);
    expect(await fs.readFile(path.join(w.root, NFC), "utf8")).toBe(BODY);
    expect(new TextDecoder().decode(w.dav.files.get(COPY)!.bytes)).toBe(OTHER_BODY);
    expect(w.cases.at(-1)).toEqual([]);
  });
});

describe("where the second spelling came from", () => {
  // The twins in the finding were made before ADR 0016 (2026-09-30): a device
  // whose disk keeps names decomposed (iOS, macOS) uploaded its spelling as a
  // name of its own next to the composed one. Today a note stored decomposed
  // here goes up under its composed identity, into the spelling the cloud has.
  it.skipIf(!keepsBothSpellings)("uploads a note stored decomposed on this disk under its composed name", async () => {
    const w = await world();
    const name = "Übersicht.md".normalize("NFC");
    await fs.writeFile(path.join(w.root, "Aufgaben", name.normalize("NFD")), "neu\n");
    // What the index of such a disk queues: the stored spelling.
    await w.queue.queueWrite(`Aufgaben/${name.normalize("NFD")}`);
    await w.cycle();
    expect(w.dav.log.filter((l) => l.startsWith("PUT"))).toEqual([`PUT Aufgaben/${name}`]);
    expect([...w.dav.files.keys()].some((p) => p !== p.normalize("NFC"))).toBe(false);
    expect(w.cases.at(-1)).toEqual([]);
  });
});

describe("between two full listings", () => {
  it("keeps reporting a twin the cloud holds while change listings name nothing new", async () => {
    const w = await world({ cloudTwin: BODY });
    const target = (w.worker as any).rawTarget as WebDavSyncTarget & { getStartCursor?: () => Promise<string> };
    const pull = target.pull.bind(target);
    target.getStartCursor = async () => "c1";
    target.pull = async (cursor?: string) => (cursor ? { etagMap: new Map(), nextCursor: "c2" } : { ...(await pull()), nextCursor: "c1" });
    await w.cycle();
    expect(w.cases.at(-1)).toHaveLength(1);
    await w.cycle();
    expect((w.worker as any).cursor).toBeDefined();
    expect(w.cases.at(-1)).toHaveLength(1);
  });
});
